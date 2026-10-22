/**
 * ADB + WebView CDP bridge to the installed Fanqie downloader APK.
 * Reuses the APK's own frontend handlers; no keys, no signature reimplementation.
 */
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const PACKAGE = 'com.pofl.fanqienoveldownloader';
const APP_PAGE = 'http://tauri.localhost/';

const shellQuote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;

export class Bridge {
  constructor({serial = process.env.FANQIE_SERIAL || null, packageName = PACKAGE} = {}) {
    this.serial = serial;
    this.packageName = packageName;
    this.cdp = null;
    this.forwardPort = null;
    this.connected = false;
    this.connecting = null;
    this.chain = Promise.resolve();
    this.bootstrapped = false;
  }

  adb(args, extra = {}) {
    return execFileSync('adb', [...(this.serial ? ['-s', this.serial] : []), ...args], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 64 * 1024 * 1024,
      ...extra,
    });
  }

  /** Cheap, side-effect-free probe: no app start, no CDP connection. */
  deviceStatus() {
    let devices = [];
    try {
      devices = execFileSync('adb', ['devices'], {encoding: 'utf8'})
        .split('\n').slice(1).filter(l => /\tdevice$/.test(l.trim())).map(l => l.split('\t')[0]);
    } catch {
      return {adb: false, devices: [], serial: this.serial, error: 'adb 不可用'};
    }
    if (!this.serial && devices.length === 1) this.serial = devices[0];
    if (!this.serial && devices.length > 1) {
      return {adb: true, devices, serial: null, error: `检测到多台设备，请设置环境变量 FANQIE_SERIAL（${devices.join(', ')}）`};
    }
    if (!this.serial) return {adb: true, devices, serial: null, error: '没有已连接的 Android 设备或模拟器'};
    let installed = false;
    try {
      installed = /package:/.test(this.adb(['shell', 'pm', 'path', this.packageName]));
    } catch {}
    return {adb: true, devices, serial: this.serial, installed, packageName: this.packageName};
  }

  async connect() {
    const status = this.deviceStatus();
    if (status.error) throw new Error(status.error);
    if (!status.installed) throw new Error(`设备 ${this.serial} 上未安装 ${this.packageName}`);

    this.adb(['shell', 'am', 'start', '-n', this.packageName + '/.MainActivity']);
    let socket = null;
    for (let i = 0; i < 30 && !socket; i++) {
      const pid = this.adb(['shell', 'pidof', this.packageName]).trim().split(' ')[0];
      if (pid) {
        const unix = this.adb(['shell', 'cat', '/proc/net/unix']);
        socket = unix.split('\n').map(l => l.trim().split(/\s+/).at(-1))
          .find(s => s === '@webview_devtools_remote_' + pid) || null;
      }
      if (!socket) await delay(1000);
    }
    if (!socket) throw new Error('应用 WebView 未暴露调试端口（应用可能刚启动，请重试）');

    this.forwardPort = this.adb(['forward', 'tcp:0', 'localabstract:' + socket.slice(1)]).trim();

    let target = null;
    for (let i = 0; i < 30 && !target; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${this.forwardPort}/json/list`)).json();
        target = targets.find(p => p.type === 'page' && p.url === APP_PAGE);
      } catch {}
      if (!target) await delay(1000);
    }
    if (!target) throw new Error('未找到应用的 Tauri 页面，请稍后重试');

    const url = new URL(target.webSocketDebuggerUrl);
    url.hostname = '127.0.0.1';
    url.port = this.forwardPort;
    this.cdp = new Cdp(url.toString());
    this.connected = true;

    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) {
      try {
        ready = await this.rawEval(`Boolean(window.__TAURI__?.core?.invoke
          && typeof handleSearch==='function'
          && typeof loadBookDetail==='function'
          && typeof createDownloadRequest==='function'
          && typeof state!=='undefined' && state.app)`);
      } catch {}
      if (!ready) await delay(1000);
    }
    if (!ready) {
      this.reset();
      throw new Error('应用前端未完成初始化，请稍后重试');
    }
    this.bootstrapped = true;
  }

  reset() {
    try { this.cdp?.close(); } catch {}
    if (this.forwardPort) {
      try { this.adb(['forward', '--remove', 'tcp:' + this.forwardPort]); } catch {}
    }
    this.cdp = null;
    this.forwardPort = null;
    this.connected = false;
    this.bootstrapped = false;
  }

  async ensure() {
    if (this.connected && this.cdp) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.connect().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  rawEval(expression, timeout = 120000) {
    return this.cdp.evaluate(expression, timeout);
  }

  /** Serialize frontend state mutations (search/detail/download) and polling. */
  run(fn) {
    const p = this.chain.then(fn, fn);
    this.chain = p.then(() => {}, () => {});
    return p;
  }

  async eval(expression, timeout = 120000) {
    await this.ensure();
    try {
      return await this.run(() => this.rawEval(expression, timeout));
    } catch (error) {
      // One transparent reconnect for dropped WebView sessions.
      if (/disconnected|timed out|not found|WebSocket/i.test(String(error.message))) {
        this.reset();
        await this.ensure();
        return this.run(() => this.rawEval(expression, timeout));
      }
      throw error;
    }
  }

  async appInfo() {
    return this.eval(`({default_download_path: state.app?.default_download_path || ''})`, 60000);
  }

  /** Create a per-job staging directory so downloads never touch the user's own files. */
  mkdir(devicePath) {
    this.adb(['shell', `mkdir -p ${shellQuote(devicePath)}`]);
  }

  /** Remove only the staged directory created by this bridge (guarded by the caller). */
  rmdir(devicePath) {
    this.adb(['shell', `rm -rf ${shellQuote(devicePath)}`]);
  }

  async search(keyword) {
    const payload = await this.eval(`(async()=>{
      const started = Date.now();
      await handleSearch(${JSON.stringify(String(keyword))});
      return {
        elapsedMs: Date.now() - started,
        items: (state.searchResults || []).map(b => ({
          book_id: b.book_id, book_name: b.book_name, author: b.author,
          abstract: b.abstract || b.description || '', cover_url: b.cover_url || '',
          word_count: b.word_count || '', status: b.status || '', read_count: b.read_count || ''
        }))
      };
    })()`, 150000);
    return payload;
  }

  async book(bookId) {
    return this.eval(`(async()=>{
      const id = ${JSON.stringify(String(bookId))};
      await loadBookDetail(id);
      const d = state.currentDetail;
      if (!d || String(d.book_id) !== id || !d.chapters?.length) {
        throw new Error('目录加载失败：' + (d?.book_id ? '书籍 ID 不一致' : '未返回目录'));
      }
      return {
        book_id: d.book_id, book_name: d.book_name, author: d.author,
        cover_url: d.cover_url || '', abstract: d.abstract || d.description || '',
        word_count: d.word_count || '', status: d.status || '',
        chapters: d.chapters.map(c => ({
          item_id: c.item_id, title: c.title, index: c.index,
          locked: Boolean(c.locked), need_pay: Boolean(c.need_pay)
        })),
        save_dir: state.detailForm.save_dir
      };
    })()`, 180000);
  }

  async createDownload({bookId, start, end, saveDir, overwrite = false}) {
    return this.eval(`(async()=>{
      const id = ${JSON.stringify(String(bookId))};
      if (!state.currentDetail || String(state.currentDetail.book_id) !== id) {
        await loadBookDetail(id);
      }
      const d = state.currentDetail;
      if (!d || String(d.book_id) !== id) throw new Error('书籍详情未就绪');
      Object.assign(state.detailForm, {
        save_dir: ${JSON.stringify(saveDir || '')} || state.app?.default_download_path || '',
        file_format: 'txt',
        chapter_start: ${JSON.stringify(String(start || ''))},
        chapter_end: ${JSON.stringify(String(end || ''))}
      });
      renderBookDetail();
      const created = await createDownloadRequest(Boolean(${JSON.stringify(Boolean(overwrite))}));
      const jobId = created?.id || created?.job_id || created?.job?.id;
      if (!jobId) throw new Error('create_download 未返回任务 ID');
      return {jobId, created};
    })()`, 180000);
  }

  async job(jobId) {
    return this.eval(`(async()=>{
      const payload = await api('bootstrap');
      const j = (payload.jobs || []).find(x => x.id === ${JSON.stringify(String(jobId))});
      if (!j) return null;
      return {id:j.id, status:j.status, progress:j.progress, message:j.message, error:j.error,
        output_path:j.output_path, result:j.result};
    })()`, 60000);
  }

  async pullFile(devicePath) {
    const bytes = this.adb(['exec-out', `cat ${shellQuote(devicePath)}`], {encoding: null, maxBuffer: 512 * 1024 * 1024});
    if (!bytes?.length) throw new Error('从设备读取导出文件时得到空内容');
    return Buffer.from(bytes);
  }
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((ok, no) => {
      this.ws.addEventListener('open', ok, {once: true});
      this.ws.addEventListener('error', () => no(new Error('WebView CDP 连接失败')), {once: true});
    });
    this.ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    });
    this.ws.addEventListener('close', () => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('WebView 连接已断开'));
      }
      this.pending.clear();
    });
  }

  async evaluate(expression, timeout = 120000) {
    await this.ready;
    const id = ++this.id;
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('WebView 执行超时'));
      }, timeout + 3000);
      this.pending.set(id, {resolve, reject, timer});
      this.ws.send(JSON.stringify({id, method: 'Runtime.evaluate',
        params: {expression, awaitPromise: true, returnByValue: true, timeout}}));
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}
