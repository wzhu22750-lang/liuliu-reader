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
