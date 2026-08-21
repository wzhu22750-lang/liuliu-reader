import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';

const VERSION = '2.4.13';
const ARM64_SHA256 = '39a8ab10b0a88d18454f45c9a6f6f59ebee4546212547f220660b1ce7bd668e6';
const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
const name = `TomatoNovelDownloader-macOS_${arch}-v${VERSION}`;
const url = `https://github.com/zhongbai2333/Tomato-Novel-Downloader/releases/download/v${VERSION}/${name}`;
const target = path.resolve('.local/tnd-provider/bin/tomato-novel-downloader');

await fs.mkdir(path.dirname(target), { recursive: true });
const response = await fetch(url);
if (!response.ok) throw new Error(`下载 TND Provider 失败：HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const digest = createHash('sha256').update(bytes).digest('hex');
if (arch === 'arm64' && digest !== ARM64_SHA256) {
  throw new Error(`TND Provider 校验失败：预期 ${ARM64_SHA256}，实际 ${digest}`);
}
await fs.writeFile(target, bytes, { mode: 0o755 });
await fs.chmod(target, 0o755);
console.log(`TND Provider 已安装：${target}`);
console.log(`版本：${VERSION}`);
console.log(`SHA-256：${digest}`);
