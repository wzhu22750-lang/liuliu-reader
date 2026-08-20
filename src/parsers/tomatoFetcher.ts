import { Book, Chapter } from '../types';
import { saveBook, getBookById } from '../db/indexedDB';

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
  itemId: string
): Promise<{ title: string; content: string; wordCount?: number; fontUrl?: string }> {
  const res = await fetch(`/api/tomato/chapter-content?itemId=${encodeURIComponent(itemId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '获取章节正文失败');
  }
  return res.json();
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
    fileContent += `${ch.title}\n\n${ch.content}\n\n${'-'.repeat(24)}\n\n`;
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

  if (onProgress) {
    onProgress({
      bookId: '',
      totalChapters: 0,
      completedChapters: 0,
      currentChapterTitle: '正在解析分享链接与书籍信息...',
      statusText: '正在解析分享链接与重定向目标...',
      isComplete: false,
    });
  }

  // 1. 深度解析得到准确的 Book ID
  const resolvedBookId = await resolveNovelShareUrl(urlOrInput);

  if (onProgress) {
    onProgress({
      bookId: resolvedBookId,
      totalChapters: 0,
      completedChapters: 0,
      currentChapterTitle: '正在拉取小说全本目录...',
      statusText: '正在获取书籍目录与最新章节...',
      isComplete: false,
    });
  }

  // 2. 获取全书元数据与目录
  const bookInfo = await fetchTomatoBookInfo(resolvedBookId);

  // 如果用户输入带有《书名》，但服务端返回了默认名，优先使用用户书名
  const finalTitle =
    bookInfo.title && !bookInfo.title.startsWith('番茄小说_')
      ? bookInfo.title
      : parsed.titleHint || bookInfo.title || '精选网络小说';

  const now = Date.now();
  const internalBookId = `book_tomato_${now}_${Math.random().toString(36).slice(2, 7)}`;

  // 3. 先拉取前 1~2 章，保证秒开阅读
  const initialChaptersMeta = bookInfo.chapters.slice(0, 1);
  const initialChapters: Chapter[] = [];
  let detectedFontUrl: string | undefined = undefined;

  for (let i = 0; i < initialChaptersMeta.length; i++) {
    const meta = initialChaptersMeta[i];
    let chData: { title: string; content: string; wordCount?: number; fontUrl?: string };
    try {
      chData = await fetchTomatoChapterContent(meta.itemId);
      if (chData.fontUrl) {
        detectedFontUrl = chData.fontUrl;
      }
    } catch {
      chData = {
        title: meta.title,
        content: `【${meta.title}】\n\n章节正在后台就绪中，即将为您呈现完整正文……`,
        wordCount: 100,
      };
    }

    initialChapters.push({
      id: `${internalBookId}_ch_${i}`,
      index: i,
      title: chData.title || meta.title,
      content: chData.content,
      wordCount: chData.wordCount || chData.content.length,
      fontUrl: chData.fontUrl,
    });
  }

  const totalChapters = bookInfo.totalChapters || bookInfo.chapters.length;

  const newBook: Book = {
    id: internalBookId,
    title: finalTitle,
    author: bookInfo.author || '网络作者',
    coverUrl: bookInfo.coverUrl,
    fontUrl: detectedFontUrl,
    coverColor: 'from-[#fdfcfa] to-[#f5f1e8]',
    sourceType: 'tomato',
    sourceUrl: urlOrInput,
    totalChapters: totalChapters,
    chapters: initialChapters,
    progress: {
      chapterIndex: 0,
      chapterTitle: initialChapters[0]?.title || '第一章',
      percentage: 0,
      scrollOffset: 0,
      lastReadTime: now,
    },
    fetchStatus: {
      total: totalChapters,
      completed: initialChapters.length,
      isFetching: initialChapters.length < totalChapters,
    },
    createdAt: now,
    updatedAt: now,
    isArchived: false,
  };

  await saveBook(newBook);

  if (onProgress) {
    onProgress({
      bookId: internalBookId,
      totalChapters,
      completedChapters: initialChapters.length,
      currentChapterTitle: initialChapters[0]?.title || '第一章',
      statusText: '第一章已就绪，可立即开始阅读',
      isComplete: initialChapters.length >= totalChapters,
      chaptersData: initialChapters.map((c) => ({ title: c.title, content: c.content })),
    });
  }

  // 4. 启动后台异步流水线拉取后续章节并持久化
  if (initialChapters.length < totalChapters) {
    runBackgroundChapterPipeline(internalBookId, bookInfo.chapters, initialChapters, onProgress);
  }

  return newBook;
}

/**
 * 异步后台流水线拉取并写入 IndexedDB
 */
async function runBackgroundChapterPipeline(
  bookId: string,
  chaptersMeta: TomatoChapterMeta[],
  currentLoadedChapters: Chapter[],
  onProgress?: (progress: TomatoFetchProgress) => void
) {
  const accumulatedChapters: { title: string; content: string }[] = currentLoadedChapters.map((c) => ({
    title: c.title,
    content: c.content,
  }));

  for (let i = currentLoadedChapters.length; i < chaptersMeta.length; i++) {
    const meta = chaptersMeta[i];
    try {
      const chData = await fetchTomatoChapterContent(meta.itemId);
      const book = await getBookById(bookId);
      if (!book) break; // 用户可能已从书架删除

      const newChapter: Chapter = {
        id: `${bookId}_ch_${i}`,
        index: i,
        title: chData.title || meta.title,
        content: chData.content,
        wordCount: chData.wordCount || chData.content.length,
        fontUrl: chData.fontUrl,
      };

      if (chData.fontUrl && !book.fontUrl) {
        book.fontUrl = chData.fontUrl;
      }

      book.chapters.push(newChapter);
      book.totalChapters = chaptersMeta.length;
      book.fetchStatus = {
        total: chaptersMeta.length,
        completed: book.chapters.length,
        isFetching: book.chapters.length < chaptersMeta.length,
      };
      book.updatedAt = Date.now();

      await saveBook(book);

      accumulatedChapters.push({ title: newChapter.title, content: newChapter.content });

      if (onProgress) {
        onProgress({
          bookId,
          totalChapters: chaptersMeta.length,
          completedChapters: book.chapters.length,
          currentChapterTitle: newChapter.title,
          statusText: `正在下载: ${newChapter.title}`,
          isComplete: book.chapters.length >= chaptersMeta.length,
          chaptersData: accumulatedChapters,
        });
      }

      // 控制轻微请求间隔
      await new Promise((r) => setTimeout(r, 350));
    } catch (err: any) {
      console.warn(`Chapter ${i} fetch error:`, err.message);
    }
  }
}

