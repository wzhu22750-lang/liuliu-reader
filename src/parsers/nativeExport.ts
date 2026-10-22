import type { FanqieChapter, FanqieValidation } from '../api/fanqie';
import type { TxtParseResult } from './txtParser';
import { stripFanqieHeader } from './fanqieTxt';

function splitExport(raw: string, chapters: FanqieChapter[]) {
  if (!chapters.length || !raw.trim()) throw new Error('下载内容或目录为空');
  const text = stripFanqieHeader(raw).replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const headers = chapters.map(chapter => chapter.title.trim());
  const positions: number[] = [];
  let cursor = 0;
  for (const header of headers) {
    let found = -1;
    for (let index = cursor; index < lines.length; index++) {
      if (lines[index].trim() === header) { found = index; break; }
    }
    if (found < 0) throw new Error(`正文缺少章节或顺序不符：${header}`);
    positions.push(found);
    cursor = found + 1;
  }
  return positions.map((at, index) => ({ title: headers[index], content: lines.slice(at + 1, positions[index + 1] ?? lines.length).join('\n').trim() }));
}

/** Use the verified directory itself, preserving short/nonstandard titles without regex heuristics. */
export function parseNativeExport(raw: string, chapters: FanqieChapter[], title: string, author: string): TxtParseResult {
  const parsed = splitExport(raw, chapters).map((chapter, index) => ({ ...chapter, id: `ch_${index}`, index, wordCount: chapter.content.replace(/\s/gu, '').length }));
  return { title, author, chapters: parsed, totalWords: parsed.reduce((total, chapter) => total + chapter.wordCount, 0) };
}

/** Structural validation only: matching titles and length cannot prove an unmarked preview is complete. */
export async function validateNativeExport(raw: string, chapters: FanqieChapter[]): Promise<FanqieValidation> {
  const parsed = splitExport(raw, chapters);
  const warnings: string[] = [];
  const lengths = parsed.map(({ title, content: body }) => {
    if (/下载失败|获取失败|未获取到正文|章节内容为空|请登录后阅读|订阅后阅读|购买本章|仅供试读|试读结束|解锁本章/u.test(body)) {
      throw new Error(`章节正文含失败、受限或试读标记：${title}`);
    }
    const count = [...body.replace(/\s/gu, '')].length;
    const frontMatter = /^(版权信息|版权页|书籍信息|出版信息|作者简介)$/u.test(title);
    if (count === 0 || (count < 100 && !frontMatter)) throw new Error(`章节正文过短，未自动入库：${title}（${count} 字）`);
    if (count < 100) warnings.push(`附属信息较短：${title}（${count} 字），已保留`);
    return count;
  });
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return { bytes: bytes.length, characters: [...raw].length, expectedChapters: chapters.length,
    verifiedChapters: parsed.length, minimumChapterCharacters: Math.min(...lengths),
    sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''), warnings };
}
