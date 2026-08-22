# 番茄小说完整正文获取：GitHub 实现调查与本项目迁移说明

调查日期：2026-08-21

## 调查对象

### zhongbai2333/Tomato-Novel-Downloader

- GitHub：https://github.com/zhongbai2333/Tomato-Novel-Downloader
- 约 3500 Star，Rust，持续维护。
- 目录优先通过官方 API，失败时使用网页目录回退。
- 正文使用官方加密接口或可配置第三方 `batch_full` Provider。
- 批量响应采用 `data[chapter_id].content` 数据结构。
- 对批量响应逐个检查 chapter_id；缺失章节进入延后队列。
- 重试时先缩小批次，最后逐章重试，不会把缺失正文当成成功。
- 官方 API 核心依赖是私有仓库，公开仓没有可直接移植的签名和解密完整实现。

### POf-L/Fanqie-novel-Downloader

- GitHub：https://github.com/POf-L/Fanqie-novel-Downloader
- 约 1700 Star，持续维护。
- 发布程序支持官方正文与 API Provider 列表，但公开仓主要是发布和维护脚本，核心正文实现未公开。
- Issues 显示 Provider 失效或官方接口变化时会返回空正文，项目不会通过网页分页补齐。

### linzj/fanqie-dl

- GitHub：https://github.com/linzj/fanqie-dl
- 展示了当前 Android API 的完整技术链：
  - 设备注册并持久化 device_id 和 iid。
  - 请求 `reading/bookapi/directory/all_items/v1` 获取目录。
  - 请求 `reading/reader/full/v1` 获取正文。
  - 请求签名头包含 X-Helios 和 X-Medusa。
  - 通过 `reading/crypt/registerkey` 获取动态正文密钥。
  - 根据 crypt_status 进行 AES 解密。
  - 根据 compress_status 进行解压。
  - 最后把 XHTML 转为纯文本。
- 这说明当前完整正文并不是网页正文的下一页，也不是 cursor 问题。

### zymelaii/ubook-rs

- GitHub：https://github.com/zymelaii/ubook-rs
- 较早实现使用 `book/directory/list/v1` 获取目录，使用 `book/reader/full/v1` 获取单章。
- 请求同时携带 group_id 和 item_id。
- 当前实测旧接口返回 HTTP 200 和空响应，说明它已经不能作为可靠正文来源。

## 真实链接验证

测试链接：

https://changdunovel.com/t/BTRdctuGVyI/

解析结果：

- book_id：7665193065501445145
- 书名：神通者
- 作者：天蚕土豆
- 当前目录：38 个目录项

网页 Reader 实测：

| 目录位置 | 标题 | chapterWordNumber | 网页纯文本长度 | isChapterLock |
| --- | --- | ---: | ---: | --- |
| 1 | 第0章 新书感言 | 1112 | 1112 | false |
| 10 | 第9章 陆鸣带来的一点小震撼 | 3000 | 3000 | false |
| 11 | 第10章 神通前四境 | 3233 | 169 | true |
| 20 | 第19章 火莲元炁 | 3048 | 169 | true |
| 38 | 第37章 局势逆转 | 2110 | 176 | true |

结论：

1. 第 10 个目录项之后只有开头，不是分页遗漏。
2. 网页响应没有 has_more、cursor、next_token 或下一页正文。
3. 第 11 个目录项开始 `isChapterLock` 为 true。
4. 网页 `content` 是明确的预览片段。
5. 正确流程必须切换正文 Provider，不能继续对网页接口添加 page 或 cursor。

## 本项目已经迁移的必要逻辑

1. 使用 `chapterWordNumber` 和 `isChapterLock` 判断完整性，不再使用固定字符阈值。
2. 网页 Reader 只负责完整免费正文及章节元数据。
3. 锁定预览不会被保存、导出或加入书架。
4. 支持可配置的明文正文 Provider 池。
5. 支持成熟项目常见的 `data[chapter_id].content`、数组和单章响应结构。
6. Provider 返回后再次与网页 chapterWordNumber 对比，防止 Provider 也只返回片段。
7. 删除把旧接口误判为分页接口并循环 page/cursor 的逻辑。
8. 不再使用 demo 正文替代真实请求失败。
9. 所有章节成功后才原子写入书架。

## 未直接复制的部分

没有复制第三方项目的完整代码、私有 API 地址、令牌、请求签名器或加密密钥。

官方 Android 正文链路涉及动态签名、设备身份和内容密钥。公开高星项目也把核心实现保存在私有依赖中。若要接入完整正文，应该配置用户有权使用的明文 Provider，或接入获得授权的服务；不应把不明来源的公共 Provider 硬编码进客户端。

## 2026-08-22 Android 原生迁移

旧的 localhost sidecar 方案仅作为历史调研结论，不再属于当前运行架构。Android APK 现在通过自身的 Tauri/Rust native backend 创建后台下载任务，逐章使用 native cache，并在全部章节校验完成后原子导入书架。前端不再启动桌面二进制，也不连接本机端口。
