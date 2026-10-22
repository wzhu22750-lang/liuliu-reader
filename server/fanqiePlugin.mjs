/**
 * Vite middleware exposing the local Fanqie bridge as /api/fanqie/*.
 * Works for both `vite` (dev) and `vite preview`; a static deploy has no such API.
 */
import {randomUUID} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {Bridge} from './fanqieBridge.mjs';
import {validateTxt} from './fanqieTxt.mjs';

const PREFIX = '/api/fanqie';
const FILE_ID = /^job-[a-z0-9-]+$/i;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

const firstLine = error => String(error?.message || error).split('\n')[0].replace(/^Error:\s*/, '').slice(0, 1200);

export function fanqiePlugin() {
  const bridge = new Bridge();
  const jobs = new Map();
  let root = process.cwd();
  let cacheDir = resolve(root, '.local', 'fanqie-downloads');

  function cleanupStaging(record) {
    if (!record.tempDir || record.cleaned) return;
    record.cleaned = true;
    try {
      bridge.rmdir(record.tempDir);
    } catch {
      // Leaving a temp directory behind is harmless; it is namespaced and never user data.
    }
  }

  async function pullCompletedJob(jobId, record, job) {
    if (record.file) return record.file;
    if (!record.pulling) {
      record.pulling = (async () => {
        const location = job.output_path || job.result?.output_path;
        if (!location) throw new Error('任务完成但没有输出路径');
        const bytes = await bridge.pullFile(location);
        const validation = validateTxt(bytes, record.chapters);
        mkdirSync(cacheDir, {recursive: true});
        const name = location.split('/').pop() || `${record.bookName}.txt`;
        writeFileSync(join(cacheDir, `${jobId}.txt`), bytes);
        record.file = {id: jobId, name: name.endsWith('.txt') ? name : `${name}.txt`, bytes: bytes.length, validation};
        cleanupStaging(record);
      })().finally(() => { record.pulling = null; });
    }
    await record.pulling;
    return record.file;
  }

  async function handle(req, res, url) {
    const route = url.pathname.slice(PREFIX.length);

    if (route === '/status' && req.method === 'GET') {
      const status = bridge.deviceStatus();
      return sendJson(res, 200, {
        ok: !status.error,
        error: status.error || null,
        device: status.error ? null : {
          serial: status.serial,
          installed: Boolean(status.installed),
          packageName: status.packageName,
        },
        backend: 'fanqie-apk-bridge',
      });
    }

    if (route === '/search' && req.method === 'GET') {
      const keyword = String(url.searchParams.get('q') || '').trim();
      if (!keyword) return sendJson(res, 400, {error: '请输入书名关键词'});
      const result = await bridge.search(keyword);
      return sendJson(res, 200, {keyword, elapsedMs: result.elapsedMs, items: result.items});
    }

    if (route === '/book' && req.method === 'GET') {
      const bookId = String(url.searchParams.get('id') || '').trim();
      if (!bookId) return sendJson(res, 400, {error: '缺少书籍 ID'});
      const detail = await bridge.book(bookId);
      return sendJson(res, 200, {
        ...detail,
        chapterCount: detail.chapters.length,
        lockedCount: detail.chapters.filter(chapter => chapter.locked || chapter.need_pay).length,
      });
    }

    if (route === '/download' && req.method === 'POST') {
      const body = await readBody(req);
      const bookId = String(body.bookId || '').trim();
      if (!bookId) return sendJson(res, 400, {error: '缺少书籍 ID'});

      const detail = await bridge.book(bookId);
      const total = detail.chapters.length;
      const start = Math.max(1, Number.parseInt(body.start, 10) || 1);
      const end = Math.min(total, Number.parseInt(body.end, 10) || total);
      if (!(start >= 1 && end >= start && end <= total)) {
        return sendJson(res, 400, {error: `章节范围无效：应在 1–${total} 之间`});
      }
      const selected = detail.chapters.slice(start - 1, end);
      const locked = selected.filter(chapter => chapter.locked || chapter.need_pay).length;
      if (locked > 0 && body.confirmLocked !== true) {
        return sendJson(res, 409, {
          error: `所选范围含 ${locked} 个受限目录项，未创建任务`,
          locked,
          total: selected.length,
          hint: '受限项可能由来源或应用本身拒绝提供正文；确认后仍可尝试，结果会如实报告。',
        });
      }

      // Every job writes into its own staging directory: the APK names the file from
      // book title/author and would otherwise clobber a same-named user download.
      const appInfo = await bridge.appInfo();
      const baseDir = String(appInfo.default_download_path || '');
      if (!baseDir.startsWith('/')) {
        throw new Error('番茄器的默认下载目录不是应用目录，请先在 APK 设置里恢复默认目录');
      }
      const tempDir = `${baseDir.replace(/\/+$/, '')}/.liuli-${randomUUID().slice(0, 12)}`;
      bridge.mkdir(tempDir);

      let created;
      try {
        created = await bridge.createDownload({bookId, start, end, saveDir: tempDir});
      } catch (error) {
        cleanupStaging({tempDir});
        throw error;
      }

      jobs.set(created.jobId, {
        chapters: selected,
        bookName: detail.book_name,
        file: null,
        pulling: null,
        tempDir,
        cleaned: false,
      });
      return sendJson(res, 200, {
        jobId: created.jobId,
        bookId,
        bookName: detail.book_name,
        author: detail.author,
        start,
        end,
        chapterCount: selected.length,
        locked,
      });
    }

    if (route === '/job' && req.method === 'GET') {
      const jobId = String(url.searchParams.get('id') || '').trim();
      if (!jobId) return sendJson(res, 400, {error: '缺少任务 ID'});
      const record = jobs.get(jobId);
      if (!record) return sendJson(res, 404, {error: '未知任务，请重新创建下载'});

      const job = await bridge.job(jobId);
      if (!job) return sendJson(res, 404, {error: '应用内找不到该任务（可能已被清理）'});

      const payload = {
        jobId,
        status: job.status,
        progress: job.progress,
        message: job.message,
        error: job.error || null,
        file: record.file,
      };
      if (/^(done|success|completed)$/i.test(String(job.status)) && !record.file) {
        try {
          payload.file = await pullCompletedJob(jobId, record, job);
        } catch (error) {
          payload.error = firstLine(error);
          cleanupStaging(record);
        }
      } else if (record.tempDir && !record.file && /^(failed|error|canceled|cancelled|partial)$/i.test(String(job.status))) {
        cleanupStaging(record);
      }
      return sendJson(res, 200, payload);
    }

    if (route === '/file' && req.method === 'GET') {
      const id = String(url.searchParams.get('id') || '');
      if (!FILE_ID.test(id)) return sendJson(res, 400, {error: '文件 ID 无效'});
      const path = join(cacheDir, `${id}.txt`);
      let body;
      try {
        body = readFileSync(path);
      } catch {
        return sendJson(res, 404, {error: '文件不存在或已被清理'});
      }
      const record = jobs.get(id);
      const name = record?.file?.name || `${id}.txt`;
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
      res.setHeader('content-length', body.length);
      return res.end(body);
    }

    return sendJson(res, 404, {error: '未知接口'});
  }

  const middleware = (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith(`${PREFIX}/`)) return next();
    handle(req, res, url).catch(error => {
      if (!res.writableEnded) sendJson(res, 500, {error: firstLine(error)});
    });
  };

  const attach = server => {
    server.middlewares.use(middleware);
    server.httpServer?.on('close', () => bridge.reset());
  };

  return {
    name: 'liuli-fanqie-bridge',
    configResolved(config) {
      root = config.root;
      cacheDir = resolve(root, '.local', 'fanqie-downloads');
    },
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
