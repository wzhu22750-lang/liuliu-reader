/**
 * Runtime boundary for the Android Tauri build.
 *
 * The APK uses Tauri's global bridge (`withGlobalTauri: true`). Keeping this
 * lookup dependency-free lets the browser development build continue to work
 * without installing `@tauri-apps/api`, while the Android shell can provide
 * the native invoke implementation at runtime.
 */
export interface TauriInvoke {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface TauriGlobal {
  core?: {
    invoke?: TauriInvoke;
  };
  invoke?: TauriInvoke;
}

export function getTauriGlobal(): TauriGlobal | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as Window & { __TAURI__?: TauriGlobal }).__TAURI__;
  return candidate ?? null;
}

export function getTauriInvoke(): TauriInvoke | null {
  const tauri = getTauriGlobal();
  return tauri?.core?.invoke ?? tauri?.invoke ?? null;
}

export function isTauriRuntime(): boolean {
  return getTauriInvoke() !== null;
}

export async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error(`当前运行环境没有 Tauri bridge，无法调用 ${command}`);
  }
  return (await invoke(command, args)) as T;
}
