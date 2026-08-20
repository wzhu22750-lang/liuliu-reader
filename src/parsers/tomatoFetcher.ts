import { Book, Chapter } from '../types';
import { saveBook, getBookById } from '../db/indexedDB';
import { assertTomatoTextExportable, decodeTomatoText, TomatoDecodeStatus } from './tomatoObfuscation';

export interface TomatoChapterMeta {
  itemId: string;
  title: string;
  index: number;
}

export interface TomatoBookInfo {
  bookId: string;
  title: string;
  author: string;
  coverUrl?: string;
  description?: string;
  totalChapters: number;
  chapters: TomatoChapterMeta[];
}

export interface TomatoChapterContent {
  title: string;
  content: string;
  wordCount?: number;
  fontUrl?: string;
  decodeStatus?: TomatoDecodeStatus;
  decodeMappingId?: string;
  decodeUnknownCount?: number;
}

export interface TomatoFetchProgress {
  bookId: string;
  totalChapters: number;
  completedChapters: number;
  currentChapterTitle: string;
  isComplete: boolean;
  statusText?: string;
  error?: string;
  chaptersData?: { title: string; content: string }[];
}

export interface ParsedUserInput {
  rawInput: string;
  extractedUrl: string | null;
  titleHint?: string;
  platform: 'changdunovel_share' | 'changdunovel_page' | 'fanqie_page' | 'snssdk_page' | 'pure_id' | 'keyword_search';
  bookIdCandidate: string | null;
}

/**
 * 1. 解析用户输入的文本，提取 URL、书名提示及初步分类
 * 无论用户输入的是：
 * - "推荐一部好书《神通者》https://changdunovel.com/t/BTRdctuGVyI/"
 * - "https://changdunovel.com/t/BTRdctuGVyI"
 * - "《神通者》 https://fanqienovel.com/page/7665193065501445145"
 * - "7665193065501445145"
 * - "九品修仙纪"
 */
export function extractUrlAndTitle(input: string): ParsedUserInput {
  const trimmed = input.trim();

  // 提取 URL (排除中文字符与常见中文标点)
  const urlMatch = trimmed.match(/(https?:\/\/[^\s\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]+)/i);
  let extractedUrl = urlMatch ? urlMatch[1] : null;
  if (extractedUrl) {
    // 移除尾部多余标点
    extractedUrl = extractedUrl.replace(/[。，！？、“”‘’（）()<>《》;,]+$/, '');
  }

  // 提取书名号中的提示词
  const titleMatch = trimmed.match(/《([^》]+)》/);
  const titleHint = titleMatch ? titleMatch[1].trim() : undefined;

  // 判断平台与链接类型
  let platform: ParsedUserInput['platform'] = 'keyword_search';
  let bookIdCandidate: string | null = null;

  if (extractedUrl) {
    if (extractedUrl.includes('changdunovel.com/t/') || extractedUrl.includes('zlink.fqnovel.com') || extractedUrl.includes('/t/')) {
      platform = 'changdunovel_share';
    } else if (extractedUrl.includes('changdunovel.com/ug/pages/book-share') || extractedUrl.includes('book_id=')) {
      platform = 'changdunovel_page';
      const m = extractedUrl.match(/[?&]book_id=(\d+)/);
      if (m) bookIdCandidate = m[1];
    } else if (extractedUrl.includes('fanqienovel.com/page/')) {
      platform = 'fanqie_page';
      const m = extractedUrl.match(/\/page\/(\d+)/);
      if (m) bookIdCandidate = m[1];
    } else if (extractedUrl.includes('snssdk.com/page/')) {
      platform = 'snssdk_page';
      const m = extractedUrl.match(/\/page\/(\d+)/);
      if (m) bookIdCandidate = m[1];
    }
  } else if (/^\d{10,25}$/.test(trimmed)) {
    platform = 'pure_id';
    bookIdCandidate = trimmed;
  }

  return {
    rawInput: trimmed,
    extractedUrl,
    titleHint,
    platform,
    bookIdCandidate,
  };
}

/**
 * 2. 统一解析分享链接获取真实 Book ID
 */
export async function resolveNovelShareUrl(rawUrlOrText: string): Promise<string> {
  const parsed = extractUrlAndTitle(rawUrlOrText);

  // 如果已经是确切的数字 ID
  if (parsed.bookIdCandidate && /^\d{10,25}$/.test(parsed.bookIdCandidate)) {
    return parsed.bookIdCandidate;
  }

  // 如果有 URL，请求后端接口解析 302 重定向
  if (parsed.extractedUrl) {
    try {
      const res = await fetch('/api/novel/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: parsed.extractedUrl, rawText: rawUrlOrText }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.bookId) {
          return data.bookId;
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        if (errData.error) {
          throw new Error(errData.error);
        }
      }
    } catch (e: any) {
      console.warn('Share URL resolve request error:', e.message);
      if (e.message && !e.message.includes('Failed to fetch')) {
        throw e;
      }
    }
  }

  // 如果解析不出，但有书名提示，作为搜索标识
  if (parsed.titleHint) {
    return `fanqie_custom_${encodeURIComponent(parsed.titleHint)}`;
  }

  if (parsed.extractedUrl) {
    return `fanqie_custom_${encodeURIComponent(parsed.extractedUrl.slice(-20))}`;
  }

  return `fanqie_custom_${encodeURIComponent(parsed.rawInput.slice(0, 30))}`;
}

/**
 * 3. 获取书籍信息与全本目录
 */
export async function fetchTomatoBookInfo(bookIdOrUrl: string): Promise<TomatoBookInfo> {
  const res = await fetch(`/api/tomato/book-info?bookId=${encodeURIComponent(bookIdOrUrl)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '获取书籍目录失败，请检查链接有效性');
  }
  return res.json();
}

/**
 * 4. 获取单章纯文本正文与字体配置
 */
export async function fetchTomatoChapterContent(
  itemId: string,
  options: { maxAttempts?: number } = {}
): Promise<TomatoChapterContent> {
  const maxAttempts = options.maxAttempts ?? 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`/api/tomato/chapter-content?itemId=${encodeURIComponent(itemId)}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '获取章节正文失败');

      const content = String(payload.content || '').trim();
      if (!content) throw new Error(`章节“${payload.title || itemId}”返回空正文`);
      if (payload.complete === false || payload.hasMore === true || payload.nextCursor) {
        throw new Error(`章节“${payload.title || itemId}”正文仍有未读取分页`);
      }
      if (payload.isPreview === true || payload.preview === true) {
        throw new Error(`章节“${payload.title || itemId}”仅返回预览正文`);
      }

      const decoded = decodeTomatoText(content);
      if (decoded.status === 'partial' || decoded.status === 'unsupported') {
        throw new Error(
          `章节“${payload.title || itemId}”包含 ${decoded.unknownCount} 个未解码字符，已停止导入，避免保存乱码。`
        );
      }
      assertTomatoTextExportable(decoded.content);
      return {
        ...payload,
        content: decoded.content,
        wordCount: decoded.content.length,
        decodeStatus: decoded.status,
        decodeMappingId: decoded.mappingId,
        decodeUnknownCount: decoded.unknownCount,
      };
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      }
    }
  }

  throw lastError || new Error(`章节“${itemId}”获取失败`);
}

/**
 * 5. 组装整书并导出为 .txt 纯文本文件到本地
 */
export function downloadNovelAsTxt(
  title: string,
  author: string,
  chapters: { title: string; content: string }[]
) {
  let fileContent = `书名：${title}\n作者：${author}\n来源：网络小说\n整理导出：溜溜读书\n\n${'='.repeat(36)}\n\n`;

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const decoded = decodeTomatoText(ch.content);
    if (decoded.status === 'partial' || decoded.status === 'unsupported') {
      throw new Error(
        `第 ${i + 1} 章仍包含 ${decoded.unknownCount} 个未解码字符，已阻止导出乱码文件。`
      );
    }
    assertTomatoTextExportable(decoded.content);
    fileContent += `${ch.title}\n\n${decoded.content}\n\n${'-'.repeat(24)}\n\n`;
  }

  const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title} - ${author}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 6. 启动全链路导入并实时更新 IndexedDB 与进度
 */
export async function startTomatoNovelImport(
  urlOrInput: string,
  onProgress?: (progress: TomatoFetchProgress) => void
): Promise<Book> {
  const parsed = extractUrlAndTitle(urlOrInput);
  const emit = (progress: TomatoFetchProgress) => onProgress?.(progress);

  emit({
    bookId: '', totalChapters: 0, completedChapters: 0,
    currentChapterTitle: '正在解析分享链接与书籍信息...',
    statusText: '正在解析分享链接与重定向目标...', isComplete: false,
  });

  const resolvedBookId = await resolveNovelShareUrl(urlOrInput);
  emit({
    bookId: resolvedBookId, totalChapters: 0, completedChapters: 0,
    currentChapterTitle: '正在拉取小说全本目录...',
    statusText: '正在获取书籍目录与最新章节...', isComplete: false,
  });

  const bookInfo = await fetchTomatoBookInfo(resolvedBookId);
  const finalTitle = bookInfo.title && !bookInfo.title.startsWith('番茄小说_')
    ? bookInfo.title : parsed.titleHint || bookInfo.title || '精选网络小说';
  if (!bookInfo.chapters.length) throw new Error('未获取到有效章节目录，已取消导入');

  const now = Date.now();
  const internalBookId = `book_tomato_${now}_${Math.random().toString(36).slice(2, 7)}`;
  const chapters: Chapter[] = [];
  let detectedFontUrl: string | undefined;
  const totalChapters = bookInfo.chapters.length;

  emit({
    bookId: internalBookId, totalChapters, completedChapters: 0,
    currentChapterTitle: '准备获取正文...', statusText: `已获取章节目录，共 ${totalChapters} 章`,
    isComplete: false, chaptersData: [],
  });

  // Strictly sequential requests protect the source and make failure/resume diagnostics deterministic.
  for (let i = 0; i < bookInfo.chapters.length; i++) {
    const meta = bookInfo.chapters[i];
    try {
      const chData = await fetchTomatoChapterContent(meta.itemId);
      if (chData.fontUrl) detectedFontUrl = detectedFontUrl || chData.fontUrl;
      const chapter: Chapter = {
        id: `${internalBookId}_ch_${i}`, index: i,
        title: chData.title || meta.title,
        content: chData.content,
        wordCount: chData.content.length,
        fontUrl: chData.fontUrl,
      };
      if (!chapter.content.trim()) throw new Error('正文为空');
      chapters.push(chapter);
      emit({
        bookId: internalBookId, totalChapters, completedChapters: chapters.length,
        currentChapterTitle: chapter.title,
        statusText: `正在获取正文：${chapters.length} / ${totalChapters} 章`,
        isComplete: false,
        chaptersData: chapters.map((c) => ({ title: c.title, content: c.content })),
      });
      await new Promise((resolve) => setTimeout(resolve, 350));
    } catch (error: any) {
      const message = `第 ${i + 1} 章《${meta.title}》获取失败：${error.message}`;
      emit({
        bookId: internalBookId, totalChapters, completedChapters: chapters.length,
        currentChapterTitle: meta.title, statusText: '导入失败，未写入书架',
        isComplete: false, error: message,
        chaptersData: chapters.map((c) => ({ title: c.title, content: c.content })),
      });
      throw new Error(message);
    }
  }

  const newBook: Book = {
    id: internalBookId, title: finalTitle, author: bookInfo.author || '网络作者',
    coverUrl: bookInfo.coverUrl, fontUrl: detectedFontUrl,
    coverColor: 'from-[#fdfcfa] to-[#f5f1e8]', sourceType: 'tomato', sourceUrl: urlOrInput,
    totalChapters, totalWords: chapters.reduce((sum, c) => sum + c.wordCount, 0), chapters,
    progress: { chapterIndex: 0, chapterTitle: chapters[0]?.title || '第一章', percentage: 0, scrollOffset: 0, lastReadTime: now },
    fetchStatus: { total: totalChapters, completed: totalChapters, isFetching: false, status: 'READY' },
    createdAt: now, updatedAt: now, isArchived: false,
  };

  // Atomic bookshelf commit: no Book is persisted before every chapter passes validation and decoding.
  await saveBook(newBook);
  emit({
    bookId: internalBookId, totalChapters, completedChapters: totalChapters,
    currentChapterTitle: chapters[chapters.length - 1]?.title || '',
    statusText: `《${finalTitle}》导入完成，已自动加入书架`, isComplete: true,
    chaptersData: chapters.map((c) => ({ title: c.title, content: c.content })),
  });
  return newBook;
}

