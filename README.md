# 溜溜读书

基于 React、TypeScript 和 Vite 的本地优先阅读器。应用在浏览器中解析本地电子书，并通过 IndexedDB 保存阅读数据，可部署到静态站点托管服务。

## 保留功能

- 墨水屏风格书架、本地书名和作者搜索、书籍管理。
- 本地 TXT 导入、章节拆分预览、自定义书名与作者。
- 本地 EPUB 导入、元信息与章节目录解析。
- 章节导航、阅读进度、字号、行距、滚动与翻页模式。
- 划线、高亮、书签、摘抄与个人笔记。
- 完整 JSON 备份、轻量数据备份及本地恢复。
- AI 解读面板与历史缓存展示。当前版本未接入 AI 服务，界面会显示相应提示。
- 可选「在线找书」：检索书名、选择章节范围、下载 TXT 并自动拆分入库。

在线找书按运行环境选择实现：

- **整合版 APK（本次交付）**：内置原番茄器的 Tauri/Rust 引擎，搜索、目录、下载与阅读均在同一应用完成，不需要电脑、ADB 或另装番茄器。构建命令为 `npm run apk:integrated`，详细边界和验收见 `docs/integrated-apk.md`。
- **Capacitor APK（原有版本）**：通过 Capacitor 原生 HTTP 直接查询书名、作者、简介和公开目录，不需要电脑或 ADB。当前未接入完整正文下载，目录页会明确说明，且不显示下载入库操作。
- **电脑开发/预览**：由 Vite 服务通过 `adb` 桥接 Android 上已安装的番茄器 APK，调用该 APK 的检索与导出能力。
- **纯静态网页**：未配置服务时会提示服务不可用，其余本地阅读功能不受影响。

## 开发与验证

需要 Node.js 20.19+ 或 22.12+，使用 npm 管理依赖。

```sh
npm ci
npm run dev
```

开发地址默认为 `http://localhost:3000`。

```sh
npm run lint
npm test
npm run build
npm start
```

`npm run build` 生成 `dist/` 静态文件；`npm start` 用 Vite 预览构建结果。部署时将 `dist/` 上传到静态站点托管服务即可，无需 API 服务、数据库服务或环境密钥。静态部署不包含在线找书能力。

## 电脑端在线找书（可选）

以下条件仅适用于电脑端 ADB 桥接实现：

1. 用 `npm run dev` 或 `npm start` 启动，而不是只打开静态文件；
2. 本机 `adb` 能访问一台 Android 设备或模拟器；
3. 设备上已安装包名为 `com.pofl.fanqienoveldownloader` 的番茄器 APK；
4. `adb exec-out cat` 能读取该应用自己的外部下载目录。模拟器实测可用；部分真机对 `Android/data` 有额外限制。

启动设备与安装 APK：

```sh
~/Library/Android/sdk/emulator/emulator -avd diary -no-window -no-audio &
adb wait-for-device
adb install -r /path/to/番茄器.apk
```

使用流程：书架右上角云朵图标（或「导入」菜单 → 在线找书）→ 输入书名 → 选择结果 →
填写起止目录项 → 下载并入库。完成后可直接开始阅读，或另外下载原始 TXT。

实现位置：

| 路径 | 作用 |
|---|---|
| `server/fanqiePlugin.mjs` | Vite 中间件，提供 `/api/fanqie/status|search|book|download|job|file` |
| `server/fanqieBridge.mjs` | adb + WebView CDP，调用 APK 前端函数并拉取导出文件 |
| `server/fanqieTxt.mjs` | 导出 TXT 的结构校验（标题顺序、字数、哈希） |
| `src/api/fanqie.ts` | 前端 API 客户端 |
| `src/components/FanqieImportView.tsx` | 全屏「在线找书」界面 |
| `src/parsers/fanqieTxt.ts` | 去掉导出文件自带的「书籍信息」块，避免生成假序章 |
| `.local/fanqie-downloads/` | 已下载的 TXT 缓存（已 gitignore） |

边界说明：

- 导出文件会按所选目录逐项检查标题是否按序出现、正文是否为空、是否含失败/受限标记，
  并记录字数与 SHA-256；提示显示在完成页，不会被静默忽略。
- 目录被来源标记为受限时，创建任务前需要二次确认；工具不绕过访问限制，失败会如实报告。
- 每个任务在 APK 默认下载目录下的独立临时子目录中生成 TXT，拉回本机并通过校验后立即删除该子目录；不会覆盖你在应用里已有的同名文件。
- 在线找书需要设备保持连接。开发服务器用 `--host 0.0.0.0` 时，同网段设备也能调用该接口；
  如不需要，启动时改为仅监听本机。
- 仅用于个人已获授权的阅读与备份，请遵守来源站点条款与当地版权法规。

## 目录

```text
src/
  api/          在线找书 API 客户端
  components/   书架、阅读器、设置、摘抄、在线找书与交互面板
  db/           IndexedDB 与本地备份
  parsers/      TXT、EPUB 解析与演示书籍
  App.tsx       页面切换
  types.ts      前端数据类型
  index.css     阅读器样式
server/         本机 adb/CDP 桥接与 Vite 中间件
tests/          本地导入与导出校验回归测试
```

书籍和阅读记录保存在当前浏览器、当前站点的本地存储中。清理浏览器数据前请导出备份；迁移到其他域名或端口时可用 JSON 备份恢复。界面字体仍通过 Google Fonts 加载。

## Android APK

当前单 APK 整合版使用 `npm run apk:integrated`，输出项目根目录的 `溜溜读书-整合版.apk`。下方 `npm run apk` 保留为原 Capacitor 版本构建方式，不含内置下载引擎。

项目通过 Capacitor 将 `dist/` 内置到 Android 应用，不需要电脑上的开发服务器即可打开书架和阅读本地电子书。

```sh
npm ci
npm run apk
```

构建要求：JDK 21、Android SDK 36。SDK 路径可通过 `ANDROID_HOME` 指定。脚本会构建前端、同步 Android 资源，在临时 ASCII 路径中编译，并将 `溜溜读书-debug.apk` 放在项目根目录。该 APK 使用本机 Android debug 签名，供直接安装测试。

- 应用名称：溜溜读书。
- 应用 ID：`com.liuli.reader`。
- 最低系统：Android 7.0（API 24）。
- TXT、EPUB、JSON 备份恢复通过系统文件选择器导入。
- JSON 备份导出通过系统“保存文件”窗口选择位置，无需申请全盘存储权限。
- Android 在线找书支持手机独立检索与目录查看；整本正文下载尚未接入。桌面 ADB 下载服务保留在电脑端。

Android 源码位于 `android/`，运行 `npm run android:sync` 可重新同步前端资源。

Android 原生找书实现位于 `src/platform/nativeBookSource.ts`，元数据解析位于 `src/parsers/nativeBookMetadata.ts`。当前接口属于实测可达的站点接口，不代表来源方承诺提供稳定的公开 SDK。若接口行为变化，客户端会显示失败，不会以模拟结果替代。

引擎候选与验证范围见 `docs/native-book-source-findings.md`。
