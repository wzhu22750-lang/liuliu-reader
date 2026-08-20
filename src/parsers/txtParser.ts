import { Chapter, Book } from '../types';

export interface SplitRule {
  id: string;
  name: string;
  pattern: RegExp;
  description: string;
}

export const COMMON_SPLIT_RULES: SplitRule[] = [
  {
    id: 'standard_chinese',
    name: '标准中文章节 (第X章/回/节/卷)',
    pattern: /^\s*(第[0-9一二三四五六七八九十百千万]+[章回节卷集幕部篇]|楔子|序[言章]|尾声|番外|后记|引子|前言)[\s\S]{0,35}$/m,
    description: '匹配如“第一章 潜龙在渊”、“第二回 风云际会”、“楔子”等',
  },
  {
    id: 'numbered',
    name: '数字编号 (01. / 1、 / Chapter)',
    pattern: /^\s*(Chapter\s+[0-9]+|[0-9]{1,4}[\.、\s]|第\s*[0-9]+\s*节)[\s\S]{0,35}$/im,
    description: '匹配如“Chapter 1”、“01. 出发”、“1、序幕”等',
  },
  {
    id: 'loose',
    name: '宽松通用规则',
    pattern: /^\s*([第卷][0-9一二三四五六七八九十百千万]+.*|Chapter\s+[0-9]+.*|[0-9]{1,4}[\.、\s\t]+.*|楔子.*|序.*|尾声.*|番外.*)$/im,
    description: '包含常见网文标题、分卷及附录',
  },
];

export interface TxtParseResult {
  title: string;
  author: string;
  chapters: Chapter[];
  totalWords: number;
}

export function parseTxtContent(
  rawText: string,
  fileName: string,
  customRegex?: RegExp
): TxtParseResult {
  // Extract book title from filename
  const cleanFileName = fileName.replace(/\.[^/.]+$/, '').trim();
  let title = cleanFileName;
  let author = '佚名';

  // Check if filename is like "《书名》作者：某某" or "书名-作者"
  const authorMatch = cleanFileName.match(/(?:《([^》]+)》|([^-—_]+))[\s-_—]+(?:作者[:：])?([^-—_]+)/);
  if (authorMatch) {
    title = (authorMatch[1] || authorMatch[2]).trim();
    author = (authorMatch[3] || '佚名').trim();
  }

  const lines = rawText.split(/\r?\n/);
  const regex = customRegex || COMMON_SPLIT_RULES[0].pattern;

  const chapters: Chapter[] = [];
  let currentTitle = '序章 / 前言';
  let currentParagraphs: string[] = [];
  let chapterIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check if this line is a chapter title
    if (line.length <= 45 && regex.test(line)) {
      // Save preceding chapter if it has content
      if (currentParagraphs.length > 0) {
        const content = currentParagraphs.join('\n\n');
        chapters.push({
          id: `ch_${chapterIndex}`,
          index: chapterIndex,
          title: currentTitle,
          content,
          wordCount: content.replace(/\s+/g, '').length,
        });
        chapterIndex++;
        currentParagraphs = [];
      }
      currentTitle = line;
    } else {
      currentParagraphs.push(line);
    }
  }

  // Push remaining content
  if (currentParagraphs.length > 0) {
    const content = currentParagraphs.join('\n\n');
    chapters.push({
      id: `ch_${chapterIndex}`,
      index: chapterIndex,
      title: currentTitle,
      content,
      wordCount: content.replace(/\s+/g, '').length,
    });
  }

  // If no chapters were matched (or just 1 giant chapter), try fallback split
  if (chapters.length <= 1 && rawText.length > 3000) {
    // Try numbered rule or loose rule
    const looseRegex = COMMON_SPLIT_RULES[2].pattern;
    const fallbackChapters = trySplitWithRegex(lines, looseRegex);
    if (fallbackChapters.length > 1) {
      return {
        title,
        author,
        chapters: fallbackChapters,
        totalWords: fallbackChapters.reduce((acc, c) => acc + c.wordCount, 0),
      };
    }
  }

  // If still single chapter, give it a clean title
  if (chapters.length === 1 && chapters[0].title === '序章 / 前言') {
    chapters[0].title = '全文阅读';
  }

  const totalWords = chapters.reduce((acc, c) => acc + c.wordCount, 0);

  return {
    title,
    author,
    chapters,
    totalWords,
  };
}

function trySplitWithRegex(lines: string[], regex: RegExp): Chapter[] {
  const chapters: Chapter[] = [];
  let currentTitle = '第一部分';
  let currentParagraphs: string[] = [];
  let chapterIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.length <= 45 && regex.test(line)) {
      if (currentParagraphs.length > 0) {
        const content = currentParagraphs.join('\n\n');
        chapters.push({
          id: `ch_${chapterIndex}`,
          index: chapterIndex,
          title: currentTitle,
          content,
          wordCount: content.replace(/\s+/g, '').length,
        });
        chapterIndex++;
        currentParagraphs = [];
      }
      currentTitle = line;
    } else {
      currentParagraphs.push(line);
    }
  }

  if (currentParagraphs.length > 0) {
    const content = currentParagraphs.join('\n\n');
    chapters.push({
      id: `ch_${chapterIndex}`,
      index: chapterIndex,
      title: currentTitle,
      content,
      wordCount: content.replace(/\s+/g, '').length,
    });
  }

  return chapters;
}

export function createBookFromTxt(
  parseResult: TxtParseResult,
  customTitle?: string,
  customAuthor?: string
): Book {
  const title = customTitle || parseResult.title;
  const author = customAuthor || parseResult.author;
  const now = Date.now();

  const colors = [
    'from-amber-600 to-amber-800',
    'from-emerald-600 to-teal-800',
    'from-sky-600 to-indigo-800',
    'from-rose-600 to-red-800',
    'from-violet-600 to-purple-900',
    'from-slate-700 to-stone-900',
  ];
  const coverColor = colors[Math.abs(title.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % colors.length];

  return {
    id: `book_txt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    author,
    coverColor,
    sourceType: 'txt',
    totalChapters: parseResult.chapters.length,
    chapters: parseResult.chapters,
    progress: {
      chapterIndex: 0,
      chapterTitle: parseResult.chapters[0]?.title || '开始阅读',
      percentage: 0,
      scrollOffset: 0,
      lastReadTime: now,
    },
    createdAt: now,
    updatedAt: now,
    isArchived: false,
  };
}
