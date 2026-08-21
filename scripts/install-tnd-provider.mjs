import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';

const VERSION = '2.4.13';
const PLATFORM_ASSETS = {
  'darwin-arm64': ['TomatoNovelDownloader-macOS_arm64-v2.4.13', '39a8ab10b0a88d18454f45c9a6f6f59ebee4546212547f220660b1ce7bd668e6'],
  'darwin-x64': ['TomatoNovelDownloader-macOS_amd64-v2.4.13', '06ef58c5ae8fe1f0dfdd08eb8e542f26942caa74ce66a211b3eb1c4c79a897c8'],
  'linux-arm64': ['TomatoNovelDownloader-Linux_arm64-v2.4.13', '0aa50d344097139c03fa936ef90b78fd14d38629489f3b375c2e121f83c9af09'],
  'linux-x64': ['TomatoNovelDownloader-Linux_amd64-v2.4.13', '13bb3c33b4cdecd6fd457d337bf5793de655fda4f704ca2d95232c4036e39c9b'],
};

const platformKey = `${process.platform}-${process.arch}`;
const asset = PLATFORM_ASSETS[platformKey];
if (!asset) throw new Error(`当前平台暂不支持自动安装 TND Provider：${platformKey}`);
const [name, expected] = asset;
const url = `https://github.com/zhongbai2333/Tomato-Novel-Downloader/releases/download/v${VERSION}/${name}`;
const target = path.resolve('.local/tnd-provider/bin/tomato-novel-downloader');

await fs.mkdir(path.dirname(target), { recursive: true });
const response = await fetch(url);
if (!response.ok) throw new Error(`下载 TND Provider 失败：HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const digest = createHash('sha256').update(bytes).digest('hex');
if (digest !== expected) {
  throw new Error(`TND Provider 校验失败：预期 ${expected}，实际 ${digest}`);
}
await fs.writeFile(target, bytes, { mode: 0o755 });
await fs.chmod(target, 0o755);
console.log(`TND Provider 已安装：${target}`);
console.log(`版本：${VERSION}`);
console.log(`SHA-256：${digest}`);
