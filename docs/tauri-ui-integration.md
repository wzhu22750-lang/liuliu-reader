# 溜溜读书 UI 与番茄器 Tauri 核心集成记录

## 当前分支

`codex/liuli-reader-tauri-ui`

## 已确认事实

- 原 APK 是 Tauri v2 + Rust。
- Android native library 是 `libfanqie_novel_downloader_tauri.so`。
- 原生 backend 包含签名、目录、章节解密、下载状态、TXT/EPUB 导出和书架模型。
- 原 APK 的前端 Web 资源以 phf 哈希表内嵌在 `.so` 中，APK 内没有普通的 `assets/index.html`。
- 目前只有 native library 和静态逆向证据，没有原始 Rust/Tauri 工程，因此不能假设任何 Tauri command 名称。

## 本阶段改动

新增 `src/platform/tauriRuntime.ts` 和 `src/platform/fanqieBackend.ts`：

1. 在不引入 `@tauri-apps/api` 的情况下识别 Tauri global bridge。
2. 保留浏览器开发环境运行能力。
3. 将 native payload 与溜溜读书的 `Book` 模型隔离。
4. 集中管理未来恢复出的 Tauri command 映射。
5. 拒绝在 IPC 未验证前猜测 command 名称，避免出现“界面能开但下载链路损坏”的假集成。

## 下一步阻塞点

需要从原始 `.so` 的 Tauri invoke 注册路径恢复实际 command 清单、参数和返回值。当前证据只确认了 Rust backend 的模型字段和内部方法，尚不足以安全填写 `FANQIE_NATIVE_COMMANDS`。

恢复命令后，适配范围应限制在 `src/platform/fanqieBackend.ts`，再由导入弹窗、下载状态和导出流程调用适配层。

## `番茄器/fanqie-apk` 新证据

该目录比先前的 `逆向解密` 目录更有用，原因是它包含一份明确的实现逻辑记录：

- `notes/implementation-logic.md` 明确记录了 Java MainActivity → Wry/Tauri WebView → `__TAURI_INTERNALS__.invoke` / `Ipc.postMessage` → `Rust.ipc` JNI → `AppState::dispatch_runtime` 的路径。
- `apktool_out/lib/arm64-v8a/libfanqie_novel_downloader_tauri.so` 与前一份样本一致，未 strip，仍可读取完整 Rust 符号。
- `nm -C` 已确认 backend 具备：`dispatch`、`dispatch_runtime`、`bookshelf_list`、`history_payload`、`job_list`、`chapter`、`chapter_batch_with_control`、`create_download`、`create_batch_download`、`retry_download`、`save_state`、`write_txt`、`write_epub` 等内部能力。
- `Rust.java` 确认 Android 侧不是普通 Activity 业务实现，而是 native Tauri bridge；因此不应把 UI 逻辑塞进 smali。
- `.so` 字符串确认了 `book_input`、`chapter_start`、`chapter_end`、`overwrite_existing`、`file_format`、`download_preferences`、`bookshelf`、`history` 等请求/状态字段。

### 影响

这份目录把“只知道有 backend”推进到了“知道 WebView 到 Rust 的 IPC 入口，以及 backend 的主要动作集合”。它足以支持下一步恢复 `dispatch_runtime` 的动作名和 JSON payload，而不是继续猜测独立的 `search`、`directory`、`download` Tauri command。

### 仍未确认

目前还不能从这些静态资料直接证明完整的动作字符串和每个动作的精确参数。因此 `FANQIE_NATIVE_COMMANDS` 暂时保持未映射是有意的。下一步应围绕 `dispatch_runtime` 做字符串交叉引用/反汇编，或者在授权 Android 测试环境中抓取原 UI 的 IPC 请求，得到真实 payload 后再接入 React。
