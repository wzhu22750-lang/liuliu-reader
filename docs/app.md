# App 实现（Tauri 2）

分支：`app实现`

## 目标结构

```text
Tauri 2
├── Web 前端：现有溜溜读书 UI
└── Rust
    ├── 领域层（书架 / 导入任务 / 摘抄）
    ├── FanqieClient（搜索、目录、免费章、明文 Provider）
    ├── 下载器（整本成功才写入 SQLite）
    ├── 解码器（HTML → 纯文本 + 完整性检查）
    ├── SQLite
    └── 文件系统导出
```

## 运行

```bash
npm install
npm run tauri:dev
```

网页模式仍然可用：

```bash
npm run dev
```

## Fanqie 书源边界

Rust `FanqieClient` 实现：

- 书名搜索（公开搜索页 / INITIAL_STATE）
- 分享链接与 book_id 解析
- `fanqienovel.com/page/{id}` 目录
- 网页 Reader 免费章
- `FANQIE_CONTENT_API_ENDPOINTS` 明文 Provider（已解密 JSON）

**不实现**官方 App 的设备注册、Ladon/Argus 签名、`registerkey` AES 解密。锁定预览不会写入书架。完整付费/锁章正文需要你自己的授权明文服务。

## Android

当前分支已按 Tauri 2 的 `bundle.android.minSdkVersion = 24` 预留。出 APK 还需安装 Android SDK，并执行：

```bash
npm run tauri -- android init
npm run tauri -- android build
```
