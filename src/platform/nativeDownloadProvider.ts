import { Book, Chapter } from '../types';
import {
  getCachedChapter,
  getDownloadJobByBookId,
  saveCachedChapter,
  saveDownloadJob,
} from '../db/indexedDB';
import { assertTomatoTextExportable, decodeTomatoText } from '../parsers/tomatoObfuscation';
import {
  FANQIE_ACTIONS,
  FanqieNativeChapter,
  invokeFanqieAction,
  isFanqieNativeBackendAvailable,
} from './fanqieBackend';
import { fetchNativeBookInfo, resolveNativeBookId } from './fanqieReaderAdapter';

export type NativeDownloadStatus =
  | 'PREPARING'
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED';

export interface NativeDownloadJobState {
  id: string;
  nativeJobId?: string;
  sourceBookId: string;
  sourceInput: string;
  title: string;
  author: string;
  totalChapters: number;
  completedChapters: number;
  currentChapterTitle: string;
  status: NativeDownloadStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NativeCachedChapter {
  id: string;
  bookId: string;
  itemId: string;
  index: number;
  title: string;
  content: string;
  wordCount: number;
  complete: true;
  provider: 'android-native';
  updatedAt: number;
}

export interface NativeDownloadProgress {
  job: NativeDownloadJobState;
  canPause: boolean;
  canResume: boolean;
  canRetry: boolean;
}

interface NativeJobPayload {
  id?: string;
  job_id?: string;
  status?: string;
  message?: string;
  progress?: number;
  error?: string;
  result?: {
    partial?: boolean;
    missing_chapters?: unknown[];
  };
}

const POLL_INTERVAL_MS = 450;
const activeControls = new Map<string, { pausedLocally: boolean; canceled: boolean }>();
let mostRecentBookId: string | null = null;

function unwrap(value: unknown): Record<string, unknown> {
  let current = value;
  while (current && typeof current === 'object' && !Array.isArray(current)) {
    const record = current as Record<string, unknown>;
    if (['id', 'job_id', 'status', 'book_id', 'content', 'items', 'chapters'].some((key) => key in record)) {
      return record;
    }
    const next = record.data ?? record.payload ?? record.result;
    if (!next || next === current || typeof next !== 'object') return record;
    current = next;
  }
  return {};
}

function normalizeContent(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chapterIdentity(chapter: FanqieNativeChapter, index: number): string {
  const record = chapter as Record<string, unknown>;
  return String(chapter.item_id ?? chapter.chapter_id ?? record.itemId ?? record.chapterId ?? index);
}

export function validateCompleteChapter(title: string, rawContent: string): { content: string; wordCount: number } {
  const normalized = normalizeContent(rawContent);
  if (!normalized) throw new Error(`章节《${title}》正文为空`);
  if (/本章为锁定章节|下载客户端继续阅读|打开番茄小说.*阅读|本章未完/i.test(normalized)) {
    throw new Error(`章节《${title}》仍是锁章预览，已拒绝导入`);
  }
  const decoded = decodeTomatoText(normalized);
  assertTomatoTextExportable(decoded.content);
  const content = decoded.content.trim();
  const wordCount = [...content].filter((character) => !/\s/.test(character)).length;
  if (!wordCount) throw new Error(`章节《${title}》完整性校验失败`);
  return { content, wordCount };
}

export function nativeStatus(value?: string): NativeDownloadStatus {
  switch ((value || '').toLowerCase()) {
    case 'queued': return 'QUEUED';
    case 'running':
    case 'downloading': return 'RUNNING';
    case 'paused': return 'PAUSED';
    case 'done':
    case 'completed': return 'COMPLETED';
    case 'failed':
    case 'error': return 'FAILED';
    case 'canceled':
    case 'cancelled': return 'CANCELED';
    default: return 'RUNNING';
  }
}

async function persist(job: NativeDownloadJobState): Promise<void> {
  job.updatedAt = Date.now();
  await saveDownloadJob(job);
}

function report(job: NativeDownloadJobState, onProgress?: (progress: NativeDownloadProgress) => void) {
  const status = job.status;
  onProgress?.({
    job: { ...job },
    canPause: status === 'QUEUED' || status === 'RUNNING' || status === 'VERIFYING',
    canResume: status === 'PAUSED',
    canRetry: status === 'FAILED',
  });
}

async function waitWhileLocallyPaused(bookId: string, job: NativeDownloadJobState, onProgress?: (progress: NativeDownloadProgress) => void) {
  while (activeControls.get(bookId)?.pausedLocally) {
    job.status = 'PAUSED';
    await persist(job);
    report(job, onProgress);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function createOrResumeNativeJob(job: NativeDownloadJobState): Promise<string> {
  if (job.nativeJobId) {
    if (job.status === 'PAUSED') {
      await invokeFanqieAction(FANQIE_ACTIONS.resumeJob, { job_id: job.nativeJobId });
    } else if (job.status === 'FAILED') {
      await invokeFanqieAction(FANQIE_ACTIONS.retryDownload, { job_id: job.nativeJobId });
    }
    return job.nativeJobId;
  }
  const raw = await invokeFanqieAction<unknown>(FANQIE_ACTIONS.createDownload, {
    book_input: job.sourceBookId,
    book_name: job.title,
    author: job.author,
    file_format: 'txt',
    chapter_start: 0,
    chapter_end: Math.max(0, job.totalChapters - 1),
    overwrite_existing: true,
  });
  const native = unwrap(raw) as NativeJobPayload;
  const nativeJobId = String(native.id ?? native.job_id ?? '');
  if (!nativeJobId) throw new Error('Android 原生下载任务未返回 job_id');
  job.nativeJobId = nativeJobId;
  return nativeJobId;
}

async function waitForNativeJob(job: NativeDownloadJobState, onProgress?: (progress: NativeDownloadProgress) => void): Promise<void> {
  const nativeJobId = await createOrResumeNativeJob(job);
  for (;;) {
    if (activeControls.get(job.sourceBookId)?.canceled) throw new Error('下载已取消');
    await waitWhileLocallyPaused(job.sourceBookId, job, onProgress);
    const raw = await invokeFanqieAction<unknown>(FANQIE_ACTIONS.getJob, { job_id: nativeJobId });
    const native = unwrap(raw) as NativeJobPayload;
    job.status = nativeStatus(native.status);
    const percentage = Math.max(0, Math.min(100, Number(native.progress ?? 0)));
    job.completedChapters = Math.min(job.totalChapters, Math.floor(job.totalChapters * percentage / 100));
    job.currentChapterTitle = native.message || job.currentChapterTitle;
    job.error = native.error;
    await persist(job);
    report(job, onProgress);
    if (job.status === 'COMPLETED') {
      const missing = native.result?.missing_chapters ?? [];
      if (native.result?.partial || missing.length) {
        throw new Error(`Android 原生任务返回不完整结果，缺失 ${missing.length} 章`);
      }
      return;
    }
    if (job.status === 'FAILED') throw new Error(native.error || native.message || 'Android 原生下载任务失败');
    if (job.status === 'CANCELED') throw new Error('Android 原生下载任务已取消');
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function materializeChapters(
  job: NativeDownloadJobState,
  chaptersMeta: FanqieNativeChapter[],
  onProgress?: (progress: NativeDownloadProgress) => void,
): Promise<Chapter[]> {
  const chapters: Chapter[] = [];
  job.status = 'VERIFYING';
  for (let index = 0; index < chaptersMeta.length; index += 1) {
    await waitWhileLocallyPaused(job.sourceBookId, job, onProgress);
    const meta = chaptersMeta[index];
    const itemId = chapterIdentity(meta, index);
    const cacheId = `${job.sourceBookId}:${itemId}`;
    let cached = await getCachedChapter(cacheId) as NativeCachedChapter | null;
    if (!cached?.complete) {
      const raw = await invokeFanqieAction<unknown>(FANQIE_ACTIONS.chapterContent, {
        book_id: job.sourceBookId,
        item_id: itemId,
      });
      const record = unwrap(raw);
      const title = String(record.title ?? record.chapter_title ?? meta.title ?? `第${index + 1}章`);
      const rawContent = String(record.content ?? record.text ?? record.body ?? '');
      const checked = validateCompleteChapter(title, rawContent);
      cached = {
        id: cacheId,
        bookId: job.sourceBookId,
        itemId,
        index,
        title,
        content: checked.content,
        wordCount: checked.wordCount,
        complete: true,
        provider: 'android-native',
        updatedAt: Date.now(),
      };
      await saveCachedChapter(cached);
    }
    chapters.push({
      id: `book_tomato_native_${job.sourceBookId}_ch_${index}`,
      index,
      title: cached.title,
      content: cached.content,
      wordCount: cached.wordCount,
    });
    job.completedChapters = chapters.length;
    job.currentChapterTitle = cached.title;
    await persist(job);
    report(job, onProgress);
  }
  return chapters;
}

export async function downloadNativeFanqieBook(
  input: string,
  titleHint?: string,
  onProgress?: (progress: NativeDownloadProgress) => void,
): Promise<Book> {
  if (!isFanqieNativeBackendAvailable()) throw new Error('Android 原生 Provider 不可用');
  const bookId = await resolveNativeBookId(input, titleHint);
  mostRecentBookId = bookId;
  activeControls.set(bookId, { pausedLocally: false, canceled: false });
  const info = await fetchNativeBookInfo(bookId);
  if (!info.chapters.length) throw new Error('Android 原生 Provider 未返回章节目录');
  const now = Date.now();
  const previous = await getDownloadJobByBookId(bookId) as NativeDownloadJobState | null;
  const reusableCompletedJob = previous?.status === 'COMPLETED' && previous.totalChapters === info.chapters.length;
  const job: NativeDownloadJobState = previous
    ? {
        ...previous,
        nativeJobId: reusableCompletedJob ? previous.nativeJobId : (previous.status === 'COMPLETED' ? undefined : previous.nativeJobId),
        sourceInput: input,
        title: info.title,
        author: info.author,
        totalChapters: info.chapters.length,
        error: undefined,
      }
    : {
        id: `native_import_${bookId}`,
        sourceBookId: bookId,
        sourceInput: input,
        title: info.title || titleHint || '精选网络小说',
        author: info.author || '未知作者',
        totalChapters: info.chapters.length,
        completedChapters: 0,
        currentChapterTitle: '正在创建 Android 后台任务',
        status: 'PREPARING',
        createdAt: now,
        updatedAt: now,
      };
  await persist(job);
  report(job, onProgress);
  try {
    if (!reusableCompletedJob) await waitForNativeJob(job, onProgress);
    const chapters = await materializeChapters(job, info.chapters, onProgress);
    if (chapters.length !== info.chapters.length) throw new Error('章节缓存数量与目录不一致');
    job.status = 'COMPLETED';
    job.completedChapters = chapters.length;
    job.currentChapterTitle = chapters.at(-1)?.title || '';
    await persist(job);
    report(job, onProgress);
    const internalId = `book_tomato_native_${bookId}`;
    return {
      id: internalId,
      title: info.title || titleHint || '精选网络小说',
      author: info.author || '未知作者',
      coverUrl: info.coverUrl,
      coverColor: 'from-[#fdfcfa] to-[#f5f1e8]',
      sourceType: 'tomato',
      sourceUrl: input,
      totalChapters: chapters.length,
      totalWords: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
      chapters: chapters.map((chapter, index) => ({ ...chapter, id: `${internalId}_ch_${index}` })),
      progress: { chapterIndex: 0, chapterTitle: chapters[0]?.title || '第一章', percentage: 0, scrollOffset: 0, lastReadTime: now },
      fetchStatus: { total: chapters.length, completed: chapters.length, isFetching: false, status: 'READY' },
      createdAt: now,
      updatedAt: Date.now(),
      isArchived: false,
    };
  } catch (error) {
    job.status = activeControls.get(bookId)?.canceled ? 'CANCELED' : 'FAILED';
    job.error = error instanceof Error ? error.message : String(error);
    await persist(job);
    report(job, onProgress);
    throw error;
  }
}

async function controlMostRecent(action: 'pause' | 'resume' | 'retry' | 'cancel'): Promise<void> {
  if (!mostRecentBookId) throw new Error('当前没有 Android 下载任务');
  const job = await getDownloadJobByBookId(mostRecentBookId) as NativeDownloadJobState | null;
  if (!job) throw new Error('未找到 Android 下载任务状态');
  const control = activeControls.get(mostRecentBookId) ?? { pausedLocally: false, canceled: false };
  activeControls.set(mostRecentBookId, control);
  if (action === 'pause') control.pausedLocally = true;
  if (action === 'resume') control.pausedLocally = false;
  if (action === 'cancel') control.canceled = true;
  if (job.nativeJobId && job.status !== 'VERIFYING' && job.status !== 'COMPLETED') {
    const nativeAction = action === 'pause' ? FANQIE_ACTIONS.pauseJob
      : action === 'resume' ? FANQIE_ACTIONS.resumeJob
      : action === 'retry' ? FANQIE_ACTIONS.retryDownload
      : FANQIE_ACTIONS.cancelJob;
    await invokeFanqieAction(nativeAction, { job_id: job.nativeJobId });
  }
  job.status = action === 'pause' ? 'PAUSED' : action === 'cancel' ? 'CANCELED' : 'RUNNING';
  job.error = undefined;
  await persist(job);
}

export const pauseNativeDownload = () => controlMostRecent('pause');
export const resumeNativeDownload = () => controlMostRecent('resume');
export const retryNativeDownload = () => controlMostRecent('retry');
export const cancelNativeDownload = () => controlMostRecent('cancel');
