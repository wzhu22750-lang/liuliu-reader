> 更新：本项目已新增复用原番茄器引擎的整合 APK 路线，见 `integrated-apk.md`。本文“已落地到当前 APK”仅指原 Capacitor 版本。

# 手机找书：引擎候选与接口验证

验证日期：2026-10-22。以下结果区分源码检查、编译检查、真实 HTTP 和 Android 界面验证。

## 已落地到当前 APK

Android 通过 Capacitor 原生 HTTP 查询书籍，不依赖电脑端 Vite、ADB 桥接或另一个下载器。

- 可独立检索书名/作者，展示简介与书籍元数据。
- 可读取来源站点公开的章节目录，并保留受限与付费标记。
- 当前手机端没有完整正文下载能力；目录页不显示下载入库操作，也不会把预览或空正文写入书架。
- 电脑端原有 Vite/ADB 桥接保留，Android 与电脑按运行环境选择不同实现。

实现文件：

| 文件 | 内容 |
|---|---|
| `src/platform/nativeBookSource.ts` | Android HTTP 请求与原生能力声明 |
| `src/parsers/nativeBookMetadata.ts` | 搜索结构归一化、公开目录 JSON 解析与限制标记 |
| `src/api/fanqie.ts` | Android / 电脑 API 路由分流 |
| `src/components/FanqieImportView.tsx` | 手机搜索、详情和目录展示；按能力显示下载入口 |
| `tests/nativeBookMetadata.test.ts` | 返回格式、书籍身份、章节顺序、重复项和限制标记回归 |

## 真实验证

1. 桌面普通 HTTP 请求，不提交登录令牌、设备注册参数或生成签名：
   - 网页作者搜索接口返回 HTTP 200，但响应体为空，判为不可用。
   - `api.fanqiesdk.com` 的小说搜索接口返回 HTTP 200、业务 `code=0`，包含真实结果。
   - 官方作品页面可读取结构化目录数据。
2. 在当前 Android APK 的原生 HTTP 层查询“三体”，实际返回 10 条结果。
3. 在新 APK 的找书界面输入“神通者”，实际展示 10 条检索结果，选中后加载 163 个目录项，其中 153 项由来源标记为受限。界面没有下载入库按钮。
4. 当前目录结构由 JSON 解析器读取，不执行来源页面脚本。书籍 ID 不一致、重复章节、目录为空、JSON 损坏均会失败。

目录数量、接口可达性和搜索结果会随来源更新。这些是本次观察结果，不是稳定性承诺。接口位于来源方域名，并不等于来源方正式对外提供有保障的开放 SDK。

## 路线一：公开引擎源码

### ch6vip/fqapp

- 仓库：https://github.com/ch6vip/fqapp
- 检查提交：`ed7976913ff79f4b50eaa1ea6fc002993a007ef6`。
- 与 POf-L 的发布仓不同，该仓实际包含 `rust/`、`rust/src/api/mod.rs`、HTTP/请求分发层和 Android 构建脚本。
- `rust/Cargo.toml` 的 crate 为 `fqapi_core`，声明 `cdylib`、`staticlib` 和 `rlib`。
- 仓库许可证文件为 GPL-3.0；本轮未将其源码或二进制合入当前应用，也未改变当前项目许可证。
- 执行 `cargo check --locked --lib`，本机 aarch64-apple-darwin 检查通过，耗时 35.49 秒。
- 这证明检查提交中的 Rust 库可在本机完成编译检查，尚不证明其可用作当前 Capacitor APK 的 Android SDK。
- 上游使用 Flutter Rust Bridge。接入现有 Capacitor 需要独立的 JNI/C ABI 适配、初始化/取消/超时/生命周期处理，并继续验证 Android 库构建和真实内容来源。
- 正文路线包含设备身份、签名和内容处理链路。本轮没有执行这些真实流程，没有验证受限章节全文，也没有把它作为可用正文源。

主要依据：

- https://github.com/ch6vip/fqapp/blob/ed7976913ff79f4b50eaa1ea6fc002993a007ef6/rust/Cargo.toml
- https://github.com/ch6vip/fqapp/blob/ed7976913ff79f4b50eaa1ea6fc002993a007ef6/DEVELOPMENT.md
- https://github.com/ch6vip/fqapp/blob/ed7976913ff79f4b50eaa1ea6fc002993a007ef6/LICENSE

### 其他候选

| 仓库 | 固定提交 | 本次源码观察 | 结论 |
|---|---|---|---|
| zhongbai2333/Tomato-Novel-Downloader | `75f0dd327d7fd55ee646564a4da4d028139c591c` | 默认 `official-api` 依赖相邻目录中的 `Tomato-Novel-Official-API`；另有强制第三方正文的构建模式 | 公开主体不能独立证明正文内核可用 |
| linzj/fanqie-dl | `7c3c57fabde56c4856ee8ebd797311e61feddc4a` | Rust CLI，包含签名研究、设备和模拟执行相关代码，依赖本地 dynarmic 子工程 | 本轮未验证为可直接嵌入 Android 的 SDK |
| xiaozhe7772222/fanqie-downloader | `cabcf46ac158628ab6c2c7a000c803af6e943745` | MIT Python 实现，章节读取网页 `reader` 的初始状态；正文非空即返回成功 | 不能据此保证返回完整章节；不采用为全文源 |

对应来源：

- https://github.com/zhongbai2333/Tomato-Novel-Downloader
- https://github.com/linzj/fanqie-dl
- https://github.com/xiaozhe7772222/fanqie-downloader

## 路线二：独立数据接口

本轮已验证并在 Android 接入的是元数据接口：

```text
GET https://api.fanqiesdk.com/api/novel/channel/homepage/search/search/v1/
    q=<关键词>&offset=0&aid=13&app_name=news_article

GET https://fanqienovel.com/page/<book_id>
```

搜索只消费 `code=0` 的 `data.ret_data`，目录要求作品身份匹配且章节 ID 唯一。不将 HTML 页面、空响应或业务错误视为成功。

完整正文接口尚未确定。下一阶段需要独立验证有权访问的正文来源：真实章节数、标题顺序、每章完整性、受限状态、失败与重试、进程重启恢复，以及全部验证完成后再写入书架。搜索成功不作为全文成功的证据。

## 构建与验证

```sh
npm run lint
npm test
npm run apk
```

当前 APK 使用 `com.liuli.reader` 应用 ID，版本名 1.1、版本号 2；保留本地 TXT/EPUB 阅读、书签、摘抄和 JSON 备份功能。Android 模拟器验证不代替真机验证。
