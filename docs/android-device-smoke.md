# 原番茄器 Android 设备冒烟记录

日期：2026-08-22

## 设备

- ADB serial：`10AEA93FFM002T5`
- 型号：`V2359A`
- 包名：`com.pofl.fanqienoveldownloader`
- APK version：`2026.7.26-709`

## 已验证

1. 设备已被 ADB 识别为 `device`。
2. 原 APK 已安装并成功启动。
3. 首页搜索框可输入文本。
4. 使用测试关键词 `ababc` 后，搜索返回 19 条结果。
5. 点击搜索结果可进入详情页。
6. 详情页显示书名、作者、书籍 ID、字数、章节数和简介。
7. 详情页存在并可识别以下核心控件：
   - `startDownloadButton`
   - `addToBookshelfButton`
   - `readOnlineButton`
   - `clearBookCacheButton`
   - `chapterStartInput`
   - `chapterEndInput`
   - TXT / EPUB 导出选项

## 结论

原 APK 的真实 Android/WebView 运行链路可用，搜索和书籍详情已经在真机上跑通。下一步可以在同一设备上验证：

```text
详情 → 单章/批量下载 → 任务列表 → 章节正文 → TXT/EPUB 导出
```

当前没有把原 APK 的文件覆盖或改包；该记录只对应原始安装包的冒烟验证。
