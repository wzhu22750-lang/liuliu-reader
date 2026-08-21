import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface TndSidecarChapter {
  itemId: string;
  title: string;
  content: string;
  provider: string;
}

const DEFAULT_PORT = 18429;
let child: ChildProcess | null = null;
let startPromise: Promise<void> | null = null;
let workQueue: Promise<unknown> = Promise.resolve();

process.once('exit', () => {
  if (child && child.exitCode == null) child.kill('SIGTERM');
});

function paths() {
  const root = path.resolve(process.env.TND_PROVIDER_ROOT || path.join(process.cwd(), '.local/tnd-provider'));
  return {
    root,
    binary: path.resolve(process.env.TND_PROVIDER_BIN || path.join(root, 'bin/tomato-novel-downloader')),
    data: path.join(root, 'data'),
    library: path.join(root, 'library'),
    log: path.join(root, 'sidecar.log'),
  };
}

function port() {
  return Number(process.env.TND_PROVIDER_PORT || DEFAULT_PORT);
}

function baseUrl() {
  return `http://127.0.0.1:${port()}`;
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`TND sidecar HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function healthy() {
  try {
    const status = await requestJson(`${baseUrl()}/api/status`);
    return Boolean(status?.version);
  } catch {
    return false;
  }
}

async function configureSidecar() {
  const cfg = await requestJson(`${baseUrl()}/api/config/full`);
  Object.assign(cfg, {
    novel_format: 'txt',
    bulk_files: true,
    auto_clear_dump: false,
    auto_open_downloaded_files: false,
    save_path: paths().library,
    use_official_api: true,
    ask_format_after_download: false,
    max_workers: 1,
    max_retries: Math.max(3, Number(cfg.max_retries || 3)),
  });
  await requestJson(`${baseUrl()}/api/config/full`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cfg),
  });
}

async function startSidecar() {
  if (await healthy()) {
    await configureSidecar();
    return;
  }
  const resolved = paths();
  if (!fs.existsSync(resolved.binary)) {
    throw new Error(
      `本地 TND Provider 未安装：${resolved.binary}。请运行 npm run provider:install。`
    );
  }
  await mkdir(resolved.data, { recursive: true });
  await mkdir(resolved.library, { recursive: true });
  const log = fs.openSync(resolved.log, 'a');
  child = spawn(resolved.binary, ['--server', '--data-dir', resolved.data], {
    cwd: process.cwd(),
    env: { ...process.env, TOMATO_WEB_ADDR: `127.0.0.1:${port()}` },
    stdio: ['ignore', log, log],
  });
  child.once('exit', () => {
    child = null;
    startPromise = null;
    fs.closeSync(log);
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await healthy()) {
      await configureSidecar();
      return;
    }
    if (child.exitCode != null) throw new Error(`TND sidecar 启动失败，退出码 ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`TND sidecar 在 30 秒内未就绪，日志：${resolved.log}`);
}

async function ensureSidecar() {
  if (!startPromise) startPromise = startSidecar().catch((error) => {
    startPromise = null;
    throw error;
  });
  await startPromise;
}

async function readCachedChapter(bookId: string, itemId: string): Promise<TndSidecarChapter | null> {
  const journal = path.join(paths().library, bookId, 'downloaded_chapters.jsonl');
  try {
    const text = await readFile(journal, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (String(row.id) !== itemId || !String(row.content || '').trim()) continue;
      return {
        itemId,
        title: String(row.title || ''),
        content: String(row.content),
        provider: 'tnd-sidecar-v2.4.13',
      };
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return null;
}

async function waitForNoActiveJob() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const jobs = await requestJson(`${baseUrl()}/api/jobs?all=true`);
    const active = (jobs.items || []).some((job: any) => ['queued', 'running', 'waiting_book_name', 'waiting_format'].includes(String(job.state).toLowerCase()));
    if (!active) return;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error('等待现有 TND 下载任务超时');
}

async function createRangeJob(bookId: string, chapterPosition: number) {
  await waitForNoActiveJob();
  return requestJson(`${baseUrl()}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ book_id: bookId, range_start: chapterPosition, range_end: chapterPosition }),
  });
}

async function waitForJob(jobId: number) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const jobs = await requestJson(`${baseUrl()}/api/jobs?id=${jobId}&all=true`);
    const job = jobs.items?.[0];
    if (!job) throw new Error(`TND 任务 ${jobId} 不存在`);
    const state = String(job.state || '').toLowerCase();
    if (state === 'done') return;
    if (state === 'failed' || state === 'cancelled') {
      throw new Error(job.message || `TND 任务 ${jobId} ${state}`);
    }
    if (state === 'waiting_book_name' && job.book_name_options?.[0]?.value) {
      await requestJson(`${baseUrl()}/api/jobs/${jobId}/book_name`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: job.book_name_options[0].value }),
      });
    }
    if (state === 'waiting_format') {
      await requestJson(`${baseUrl()}/api/jobs/${jobId}/format`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: 'txt' }),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`TND 任务 ${jobId} 下载超时`);
}

async function fetchUnqueued(bookId: string, itemId: string, chapterIndex: number) {
  if (!/^\d{10,25}$/.test(bookId) || !/^\d{10,25}$/.test(itemId)) throw new Error('TND Provider 收到无效 ID');
  if (!Number.isInteger(chapterIndex) || chapterIndex < 0) throw new Error('TND Provider 缺少有效 chapterIndex');
  await ensureSidecar();
  const cached = await readCachedChapter(bookId, itemId);
  if (cached) return cached;

  const job = await createRangeJob(bookId, chapterIndex + 1);
  await waitForJob(Number(job.id));
  const downloaded = await readCachedChapter(bookId, itemId);
  if (!downloaded) throw new Error(`TND 下载完成但缓存中缺少章节 ${itemId}`);
  return downloaded;
}

export async function fetchTndSidecarChapter(bookId: string, itemId: string, chapterIndex: number) {
  const run = workQueue.then(() => fetchUnqueued(bookId, itemId, chapterIndex));
  workQueue = run.catch(() => undefined);
  return run;
}
