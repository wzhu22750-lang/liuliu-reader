import { isIntegratedRuntime, integratedStatus, integratedSearch, integratedBook, integratedDownload, integratedJob, integratedFileText } from '../platform/integratedFanqie';
import { Capacitor } from '@capacitor/core';
import { nativeBookSourceStatus, nativeGetBook, nativeSearchBooks } from '../platform/nativeBookSource';

/**
 * Client for the local Fanqie bridge exposed by the Vite server plugin.
 * Relative URLs keep the app working under a sub-path; a static deploy simply
 * has no /api/fanqie endpoint, which the view reports as "service unavailable".
 */
const BASE = 'api/fanqie';

export interface FanqieDevice {
  serial: string;
  installed: boolean;
  packageName: string;
}

export interface FanqieStatus {
  ok: boolean;
  error: string | null;
  device: FanqieDevice | null;
  backend: string;
  capabilities?: { search: boolean; directory: boolean; download: boolean };
}

export interface FanqieSearchItem {
  book_id: string;
  book_name: string;
  author: string;
  abstract: string;
  cover_url: string;
  word_count: string;
  status: string;
  read_count: string;
}

export interface FanqieChapter {
  item_id: string;
  title: string;
  index: number;
  locked: boolean;
  need_pay: boolean;
}

export interface FanqieBook {
  book_id: string;
  book_name: string;
  author: string;
  cover_url: string;
  abstract: string;
  word_count: string;
  status: string;
  save_dir: string;
  chapters: FanqieChapter[];
  chapterCount: number;
  lockedCount: number;
}

export interface FanqieValidation {
  bytes: number;
  characters: number;
  expectedChapters: number;
  verifiedChapters: number;
  minimumChapterCharacters: number;
  sha256: string;
  warnings: string[];
}

export interface FanqieFile {
  id: string;
  name: string;
  bytes: number;
  validation: FanqieValidation;
}

export interface FanqieJob {
  jobId: string;
  status: string;
  progress: number;
  message: string;
  error: string | null;
  file?: FanqieFile | null;
}

export interface FanqieDownloadTicket {
  jobId: string;
  bookId: string;
  bookName: string;
  author: string;
  start: number;
  end: number;
  chapterCount: number;
  locked: number;
}

export const FANQIE_TERMINAL_STATUSES = new Set([
  'done', 'success', 'completed', 'failed', 'error', 'canceled', 'cancelled', 'partial',
]);

export class FanqieServiceError extends Error {
  readonly offline: boolean;
  constructor(message: string, offline = false) {
    super(message);
    this.name = 'FanqieServiceError';
    this.offline = offline;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (Capacitor.isNativePlatform()) {
    throw new FanqieServiceError('当前 APK 支持搜索和目录查看，完整正文下载尚未接入。', true);
  }
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new FanqieServiceError('本地下载服务未启动：请使用 npm run dev 或 npm start 运行本项目', true);
  }
  const text = await response.text();
  let payload: any = null;
  let parsed = false;
  try {
    payload = text ? JSON.parse(text) : null;
    parsed = true;
  } catch {
    // A static host answers /api/* with index.html or a plain 404 page.
  }
  if (!parsed) {
    throw new FanqieServiceError(`本地下载服务未启用（HTTP ${response.status}）`, true);
  }
  if (!response.ok) {
    const error = new FanqieServiceError(payload?.error || `请求失败（HTTP ${response.status}）`);
    (error as any).payload = payload;
    (error as any).status = response.status;
    throw error;
  }
  return payload as T;
}

export function getFanqieStatus(): Promise<FanqieStatus> {
  return isIntegratedRuntime() ? integratedStatus() : Capacitor.isNativePlatform() ? Promise.resolve(nativeBookSourceStatus()) : request<FanqieStatus>('/status');
}

export function searchFanqie(q: string): Promise<{keyword: string; elapsedMs: number; items: FanqieSearchItem[]}> {
  return isIntegratedRuntime() ? integratedSearch(q) : Capacitor.isNativePlatform() ? nativeSearchBooks(q) : request(`/search?q=${encodeURIComponent(q)}`);
}

export function getFanqieBook(id: string): Promise<FanqieBook> {
  return isIntegratedRuntime() ? integratedBook(id) : Capacitor.isNativePlatform() ? nativeGetBook(id) : request(`/book?id=${encodeURIComponent(id)}`);
}

export function startFanqieDownload(input: {
  bookId: string;
  start: number;
  end: number;
  confirmLocked?: boolean;
}): Promise<FanqieDownloadTicket> {
  if (isIntegratedRuntime()) return integratedDownload(input);
  return request('/download', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(input),
  });
}

export function getFanqieJob(id: string): Promise<FanqieJob> {
  if (isIntegratedRuntime()) return integratedJob(id);
  return request(`/job?id=${encodeURIComponent(id)}`);
}

export async function getFanqieFileText(id: string): Promise<string> {
  if (isIntegratedRuntime()) return integratedFileText(id);
  if (Capacitor.isNativePlatform()) throw new FanqieServiceError('完整正文下载尚未接入，暂无可导入的下载文件');
  let response: Response;
  try {
    response = await fetch(`${BASE}/file?id=${encodeURIComponent(id)}`);
  } catch {
    throw new FanqieServiceError('读取已下载文件失败：本地服务连接中断', true);
  }
  if (!response.ok) {
    let message = `读取文件失败（HTTP ${response.status}）`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch {}
    throw new FanqieServiceError(message);
  }
  return response.text();
}

export function fanqieFileUrl(id: string): string {
  return `${BASE}/file?id=${encodeURIComponent(id)}`;
}
