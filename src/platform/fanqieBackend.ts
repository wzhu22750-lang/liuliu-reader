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
  search: null,
  directory: null,
  chapter: null,
  batchDownload: null,
  downloadProgress: null,
  export: null,
} as const;

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
