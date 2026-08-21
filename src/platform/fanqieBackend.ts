import { invokeTauri, isTauriRuntime } from './tauriRuntime';

/**
 * Data contracts observed in the original APK's Rust model strings.
 * These are deliberately kept separate from the reader's local Book model;
 * the adapter is the only place where native payloads should be normalized.
 */
export interface FanqieNativeChapter {
  item_id?: string;
  chapter_id?: string;
  title?: string;
  index?: number;
  content?: string;
  word_count?: number;
}

export interface FanqieNativeDirectory {
  book_id: string;
  title?: string;
  author?: string;
  cover_url?: string;
  description?: string;
  chapters?: FanqieNativeChapter[];
  items?: FanqieNativeChapter[];
}

export interface FanqieDispatchEnvelope {
  /** Action discriminator used by AppState::dispatch_runtime. */
  action: string;
  /** Action-specific payload; exact fields are recovered per action. */
  payload?: Record<string, unknown>;
  /** Optional persisted state passed by the original frontend. */
  state?: Record<string, unknown>;
}

export const FANQIE_ACTIONS = {
  search: 'search',
  getJob: 'get_job',
  history: 'history',
  previewBatch: 'preview_batch',
  clearHistory: 'clear_history',
  bookshelfAdd: 'bookshelf_add',
  retryDownload: 'retry_download',
  removeHistory: 'remove_history',
  pickDirectory: 'pick_directory',
  bookshelfList: 'bookshelf_list',
  clearBookCache: 'clear_book_cache',
  chapterContent: 'chapter_content',
  createDownload: 'create_download',
  bootstrap: 'bootstrap',
  listJobs: 'list_jobs',
  pauseJob: 'pause_job',
  openPath: 'open_path',
  resumeJob: 'resume_job',
  cancelJob: 'cancel_job',
  bookDetail: 'book_detail',
  createBatchDownload: 'create_batch_download',
  startUpdate: 'start_update',
  browseDirectories: 'browse_directories',
  bookshelfProgress: 'bookshelf_progress',
  getUpdateStatus: 'get_update_status',
  getMobileStatus: 'get_mobile_status',
  saveDownloadPreferences: 'save_download_preferences',
} as const;

export type FanqieAction = (typeof FANQIE_ACTIONS)[keyof typeof FANQIE_ACTIONS];

export interface FanqieNativeProgress {
  job_id?: string;
  status?: string;
  completed?: number;
  total?: number;
  error?: string;
}

/**
 * Native command names are intentionally not guessed here. The extracted APK
 * exposes the Rust backend and model fields, but not a reliable public command
 * manifest. Once command registration is recovered, only this adapter needs to
 * change; the Liuli Reader UI stays independent of the IPC naming.
 */
export const FANQIE_NATIVE_COMMANDS = {
  // The APK's embedded Tauri command list contains `dispatch`; its Rust
  // implementation routes into AppState::dispatch_runtime.
  dispatch: 'dispatch',
  search: null,
  directory: null,
  chapter: null,
  batchDownload: null,
  downloadProgress: null,
  export: null,
} as const;

export async function invokeFanqieDispatch<T>(envelope: FanqieDispatchEnvelope): Promise<T> {
  const command = FANQIE_NATIVE_COMMANDS.dispatch;
  if (!command) {
    throw new Error('番茄器 dispatch command 不可用');
  }
  return invokeTauri<T>(command, envelope as unknown as Record<string, unknown>);
}

export function createFanqieActionRequest(
  action: FanqieAction,
  payload?: Record<string, unknown>,
  state?: Record<string, unknown>,
): FanqieDispatchEnvelope {
  return { action, ...(payload ? { payload } : {}), ...(state ? { state } : {}) };
}

export function invokeFanqieAction<T>(
  action: FanqieAction,
  payload?: Record<string, unknown>,
  state?: Record<string, unknown>,
): Promise<T> {
  return invokeFanqieDispatch(createFanqieActionRequest(action, payload, state));
}

export function isFanqieNativeBackendAvailable(): boolean {
  return isTauriRuntime() && Object.values(FANQIE_NATIVE_COMMANDS).some(Boolean);
}

export async function invokeFanqieNative<T>(
  command: keyof typeof FANQIE_NATIVE_COMMANDS,
  args?: Record<string, unknown>,
): Promise<T> {
  const nativeCommand = FANQIE_NATIVE_COMMANDS[command];
  if (!nativeCommand) {
    throw new Error(`番茄器原生命令尚未完成映射：${command}`);
  }
  return invokeTauri<T>(nativeCommand, args);
}
