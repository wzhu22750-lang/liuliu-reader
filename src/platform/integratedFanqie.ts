import type { FanqieBook, FanqieDownloadTicket, FanqieFile, FanqieJob, FanqieStatus } from '../api/fanqie';
import { parseNativeBookPage } from '../parsers/nativeBookMetadata';
import { validateNativeExport } from '../parsers/nativeExport';

type Invoke = <T = any>(command: string, args: Record<string, unknown>) => Promise<T>;
type Runtime = Window & {
  __TAURI__?: { core?: { invoke?: Invoke } };
  __TAURI_INTERNALS__?: { invoke?: Invoke };
  LiuliReaderFiles?: { downloadDirectory(): string; createDownloadDirectory(): string; bookPageAsync(bookId: string, requestId: string): void; readText(path: string): string };
};
const runtime = (): Runtime => window as Runtime;
export const isIntegratedRuntime = (): boolean => typeof window !== 'undefined' &&
  Boolean(runtime().__TAURI__?.core?.invoke || runtime().__TAURI_INTERNALS__?.invoke);

export async function dispatchEngine<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const invoke = runtime().__TAURI__?.core?.invoke || runtime().__TAURI_INTERNALS__?.invoke;
  if (!invoke) throw new Error('番茄器引擎尚未就绪，请重新打开应用');
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([invoke<T>('dispatch', { action, payload }), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('引擎响应超时，请稍后重试')), 180_000);
    })]);
  } catch (error: any) {
    let detail = error;
    if (typeof error === 'string') { try { detail = JSON.parse(error); } catch { detail = { message: error }; } }
    throw new Error(detail?.message || detail?.error || '番茄器调用失败');
  } finally { clearTimeout(timer!); }
}

function readBridge(method: 'downloadDirectory' | 'createDownloadDirectory' | 'readText', path?: string) {
  const bridge = runtime().LiuliReaderFiles;
  if (!bridge) throw new Error('本机文件桥未就绪，请安装整合版 APK');
  const value = JSON.parse(method === 'readText' ? bridge.readText(path!) : bridge[method]());
  if (value.error) throw new Error(value.error);
  return value;
}

export async function integratedStatus(): Promise<FanqieStatus> {
  await dispatchEngine('bootstrap');
  readBridge('downloadDirectory');
  return { ok: true, error: null, device: null, backend: 'android-integrated-engine',
    capabilities: { search: true, directory: true, download: true } };
}

export async function integratedSearch(keyword: string) {
  const q = keyword.trim();
  if (!q || q.length > 100) throw new Error('请输入 1–100 字的书名或关键词');
  const started = Date.now();
  const value = await dispatchEngine('search', { q });
  if (!Array.isArray(value.items)) throw new Error('引擎未返回有效搜索结果');
  return { keyword: q, elapsedMs: Date.now() - started, items: value.items.map((item: any) => ({
    book_id: String(item.book_id), book_name: String(item.book_name || item.title || ''), author: String(item.author || ''),
    abstract: String(item.abstract || item.description || ''), cover_url: String(item.cover_url || ''),
    word_count: String(item.word_count || ''), status: String(item.status || ''), read_count: String(item.read_count || ''),
  })) };
}

function readPublicBookPage(bookId: string): Promise<{ html?: string; error?: string }> {
  const bridge = runtime().LiuliReaderFiles;
  if (!bridge) return Promise.reject(new Error('本机目录校验桥未就绪'));
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('liuli-book-page', listener); };
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.id !== requestId) return;
      cleanup(); resolve(detail.result);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('目录状态校验超时，请稍后重试')); }, 40_000);
    window.addEventListener('liuli-book-page', listener);
    try { bridge.bookPageAsync(bookId, requestId); } catch (error) { cleanup(); reject(error); }
  });
}

export async function integratedBook(id: string): Promise<FanqieBook> {
  if (!/^\d{1,30}$/.test(id)) throw new Error('书籍 ID 无效');
  const value = await dispatchEngine('book_detail', { book_id: id, include_chapters: true });
  if (String(value.book_id) !== id || !Array.isArray(value.chapters) || !value.chapters.length) throw new Error('引擎未返回完整目录');
  // The original native directory omits access flags; verify them against the public page.
  const bridge = runtime().LiuliReaderFiles;
  if (!bridge) throw new Error('本机目录校验桥未就绪');
  const response = await readPublicBookPage(id);
  if (response.error) throw new Error(response.error);
  const book = parseNativeBookPage(response.html || '', id);
  if (value.chapters.length !== book.chapters.length || value.chapters.some((chapter: any, index: number) =>
    String(chapter.item_id) !== book.chapters[index].item_id || String(chapter.title).trim() !== book.chapters[index].title)) {
    throw new Error('引擎目录与公开目录不一致，暂不创建下载任务');
  }
  return book;
}

type SavedJob = { ticket: FanqieDownloadTicket; book: FanqieBook; nativeSnapshot?: any };
const JOB_PREFIX = 'liuli:integrated-job:';
const files = new Map<string, { file: FanqieFile; text: string }>();
const watchedJobs = new Set<string>();
const terminal = /^(done|success|completed|partial|failed|error|canceled|cancelled)$/i;

async function readJobSnapshot(jobId: string, saved: SavedJob): Promise<any> {
  const payload = await dispatchEngine('bootstrap');
  const live = (payload.jobs || []).find((value: any) => String(value.id) === jobId);
  if (live) {
    saved.nativeSnapshot = live;
    if (localStorage.getItem(JOB_PREFIX + jobId)) localStorage.setItem(JOB_PREFIX + jobId, JSON.stringify(saved));
    return live;
  }
  // Completed native jobs disappear after an engine restart; retain the observed result and file path.
  if (saved.nativeSnapshot && terminal.test(String(saved.nativeSnapshot.status))) return saved.nativeSnapshot;
  throw new Error('引擎任务已中断，请重新下载；已有文件不会删除');
}

function watchJob(jobId: string) {
  if (typeof document === 'undefined' || watchedJobs.has(jobId)) return;
  watchedJobs.add(jobId);
  const tick = async () => {
    const raw = localStorage.getItem(JOB_PREFIX + jobId);
    if (!raw) { watchedJobs.delete(jobId); return; }
    try {
      const job = await readJobSnapshot(jobId, JSON.parse(raw));
      if (terminal.test(String(job.status))) { watchedJobs.delete(jobId); return; }
    } catch { watchedJobs.delete(jobId); return; }
    window.setTimeout(() => void tick(), 1500);
  };
  void tick();
}


export async function integratedDownload(input: { bookId: string; start: number; end: number }): Promise<FanqieDownloadTicket> {
  const book = await integratedBook(input.bookId);
  if (!Number.isInteger(input.start) || !Number.isInteger(input.end) || input.start < 1 || input.end < input.start || input.end > book.chapterCount) throw new Error('章节范围无效');
  const selected = book.chapters.slice(input.start - 1, input.end);
  const restricted = selected.filter(chapter => chapter.locked || chapter.need_pay).length;
  if (restricted) throw new Error(`选定范围有 ${restricted} 个受限章节，请选择可获取的章节范围`);
  const save_dir = readBridge('createDownloadDirectory').path;
  const created = await dispatchEngine('create_download', { book_id: book.book_id, book_input: book.book_id,
    book_name: book.book_name, author: book.author, save_dir, file_format: 'txt', overwrite_existing: false,
    chapter_start: input.start, chapter_end: input.end });
  const jobId = created.id || created.job_id || created.job?.id;
  if (!jobId) throw new Error('下载引擎未返回任务 ID');
  const ticket = { jobId: String(jobId), bookId: book.book_id, bookName: book.book_name, author: book.author,
    start: input.start, end: input.end, chapterCount: selected.length, locked: 0 };
  localStorage.setItem(JOB_PREFIX + ticket.jobId, JSON.stringify({ ticket, book } satisfies SavedJob));
  watchJob(ticket.jobId);
  return ticket;
}

export function integratedPendingJobs(): SavedJob[] {
  const result: SavedJob[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)!;
    if (!key.startsWith(JOB_PREFIX)) continue;
    try { const value = JSON.parse(localStorage.getItem(key)!); if (value?.ticket?.jobId && value?.book?.chapters) result.push(value); } catch { /* Ignore corrupt local metadata. */ }
  }
  return result;
}

export function integratedForgetJob(jobId: string) { localStorage.removeItem(JOB_PREFIX + jobId); files.delete(jobId); }
export async function integratedCancelJob(jobId: string) { await dispatchEngine('cancel_job', { job_id: jobId }); }

export async function integratedJob(jobId: string): Promise<FanqieJob> {
  const raw = localStorage.getItem(JOB_PREFIX + jobId);
  if (!raw) throw new Error('本机任务记录不存在');
  const saved = JSON.parse(raw) as SavedJob;
  const { ticket, book } = saved;
  const job = await readJobSnapshot(jobId, saved);
  const result: FanqieJob = { jobId, status: String(job.status), progress: Number(job.progress) || 0,
    message: String(job.message || ''), error: job.error ? String(job.error) : null };
  if (/^(done|success|completed)$/i.test(result.status)) {
    try {
      if (job.error || job.result?.partial === true || (Array.isArray(job.result?.missing_chapters) && job.result.missing_chapters.length > 0) || Number(job.result?.failed_chapters || job.result?.failed_count || 0) > 0) throw new Error(job.error || '部分章节下载失败');
      const path = job.output_path || job.result?.output_path;
      if (!path) throw new Error('下载结束但没有生成正文文件');
      if (!files.has(jobId)) {
        const text = readBridge('readText', path).text;
        const validation = await validateNativeExport(text, book.chapters.slice(ticket.start - 1, ticket.end));
        files.set(jobId, { text, file: { id: jobId, name: `${book.book_name}.txt`, bytes: validation.bytes, validation } });
      }
      result.file = files.get(jobId)!.file;
    } catch (error: any) { result.status = 'partial'; result.error = error.message; result.message = '正文未通过检查，未自动入库'; }
  }
  return result;
}

export function integratedFileText(id: string): string {
  const value = files.get(id);
  if (!value) throw new Error('正文尚未通过检查，请重新读取下载任务');
  return value.text;
}
