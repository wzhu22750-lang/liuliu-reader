/**
 * Structural checks for the TXT exported by the APK.
 * Everything here is read-only: no repair, no silent fallback.
 */
import {createHash} from 'node:crypto';

/**
 * @param {Buffer} bytes
 * @param {{title: string}[]} chapters
 * @param {number} [minimumChars]
 */
export function validateTxt(bytes, chapters, minimumChars = 100) {
  let text;
  try {
    text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    throw new Error('导出文件不是合法 UTF-8 文本');
  }
  if (!text.trim()) throw new Error('导出文件为空');

  const headers = chapters.map(chapter => String(chapter.title || '').trim());
  const warnings = [];
  const lengths = [];
  let cursor = 0;

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    if (!header) {
      warnings.push(`第 ${i + 1} 个目录项标题为空`);
      continue;
    }
    const at = text.indexOf(header, cursor);
    if (at < 0) {
      warnings.push(`正文缺少章节标题：${header}`);
      continue;
    }
    const next = i + 1 < headers.length ? text.indexOf(headers[i + 1], at + header.length) : -1;
    const body = text.slice(at + header.length, next < 0 ? text.length : next).trim();
    const chars = [...body.replace(/\s/gu, '')].length;
    if (/下载失败|获取失败|未获取到正文|章节内容为空|请登录后阅读|订阅后阅读|购买本章/u.test(body)) {
      warnings.push(`章节正文含失败/受限标记：${header}`);
    }
    if (chars < minimumChars) warnings.push(`章节正文偏短（${chars} 字）：${header}`);
    lengths.push(chars);
    cursor = at + header.length;
  }

  return {
    bytes: bytes.length,
    characters: [...text].length,
    expectedChapters: chapters.length,
    verifiedChapters: lengths.length,
    minimumChapterCharacters: lengths.length ? Math.min(...lengths) : 0,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    warnings,
  };
}
