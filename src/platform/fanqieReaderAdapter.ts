import { Book, Chapter } from '../types';
import {
  FANQIE_ACTIONS,
  FanqieNativeChapter,
  FanqieNativeDirectory,
  invokeFanqieAction,
  isFanqieNativeBackendAvailable,
} from './fanqieBackend';

export interface FanqieSearchItem {
  bookId: string;
  title: string;
  author: string;
  coverUrl?: string;
  description?: string;
}

function unwrap(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  for (const key of ['data', 'result', 'payload', 'book', 'detail']) {
    if (record[key] && typeof record[key] === 'object') return unwrap(record[key]);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  const unwrapped = unwrap(value);
  return unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped)
    ? unwrapped as Record<string, unknown>
    : {};
}

function asString(...values: unknown[]): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim()) as string | undefined;
}

function asNumber(...values: unknown[]): number | undefined {
  return values.find((value) => typeof value === 'number' && Number.isFinite(value)) as number | undefined;
}

function getBookId(record: Record<string, unknown>): string | undefined {
  return asString(record.book_id, record.bookId, record.id, record.bookIdStr);
}

function getChapterList(value: unknown): FanqieNativeChapter[] {
  const record = asRecord(value);
  const candidates = [record.chapters, record.items, record.chapter_list, record.chapterList];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as FanqieNativeChapter[];
  }
  return [];
}

export function nativeBackendUnavailableError(): Error {
  return new Error('当前不是番茄器 Android/Tauri 环境，请使用浏览器导入接口。');
}

export async function searchFanqieBooks(query: string): Promise<FanqieSearchItem[]> {
  if (!isFanqieNativeBackendAvailable()) throw nativeBackendUnavailableError();
  const raw = await invokeFanqieAction<unknown>(FANQIE_ACTIONS.search, { q: query, query, keyword: query });
  const unwrapped = unwrap(raw);
  const list = Array.isArray(unwrapped)
    ? unwrapped
    : (asRecord(unwrapped).books || asRecord(unwrapped).items || asRecord(unwrapped).results || []);
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const record = asRecord(item);
    return {
      bookId: getBookId(record) || '',
      title: asString(record.title, record.book_name, record.name) || '未命名作品',
      author: asString(record.author, record.author_name) || '未知作者',
      coverUrl: asString(record.cover_url, record.coverUrl, record.cover),
      description: asString(record.description, record.intro, record.abstract),
    };
  }).filter((item) => item.bookId);
}

export async function resolveNativeBookId(input: string, titleHint?: string): Promise<string> {
  if (/^\d{10,25}$/.test(input)) return input;
  const query = titleHint || input;
  const results = await searchFanqieBooks(query);
  if (!results.length) throw new Error(`未找到作品“${query}”`);
  return results[0].bookId;
}

export async function fetchNativeBookInfo(bookId: string): Promise<{
  bookId: string;
  title: string;
  author: string;
  coverUrl?: string;
  description?: string;
  chapters: FanqieNativeChapter[];
}> {
  if (!isFanqieNativeBackendAvailable()) throw nativeBackendUnavailableError();
  const raw = await invokeFanqieAction<unknown>(FANQIE_ACTIONS.bookDetail, {
    book_id: bookId,
    bookId,
  });
  const record = asRecord(raw);
  const id = getBookId(record) || bookId;
  return {
    bookId: id,
    title: asString(record.title, record.book_name, record.name) || `番茄小说_${id}`,
    author: asString(record.author, record.author_name) || '未知作者',
    coverUrl: asString(record.cover_url, record.coverUrl, record.cover),
    description: asString(record.description, record.intro, record.abstract),
    chapters: getChapterList(raw),
  };
}

export async function fetchNativeChapterContent(bookId: string, chapter: FanqieNativeChapter): Promise<{
  title: string;
  content: string;
  wordCount?: number;
}> {
  if (!isFanqieNativeBackendAvailable()) throw nativeBackendUnavailableError();
  const itemId = asString(chapter.item_id, chapter.chapter_id, (chapter as Record<string, unknown>).itemId, (chapter as Record<string, unknown>).chapterId) || '';
  const index = asNumber(chapter.index) ?? 0;
  const raw = await invokeFanqieAction<unknown>(FANQIE_ACTIONS.chapterContent, {
    book_id: bookId,
    bookId,
    item_id: itemId,
    itemId,
    chapter_index: index,
    index,
  });
  const record = asRecord(raw);
  const content = asString(record.content, record.text, record.body) || '';
  if (!content.trim()) throw new Error(`章节“${chapter.title || itemId}”返回空正文`);
  return {
    title: asString(record.title, record.chapter_title) || chapter.title || `第${index + 1}章`,
    content,
    wordCount: asNumber(record.word_count, record.wordCount) || content.length,
  };
}

export async function importNativeFanqieBook(
  input: string,
  titleHint?: string,
  onProgress?: (completed: number, total: number, title: string) => void,
): Promise<Book> {
  const bookId = await resolveNativeBookId(input, titleHint);
  const info = await fetchNativeBookInfo(bookId);
  if (!info.chapters.length) throw new Error('原生番茄器没有返回有效章节目录');
  const now = Date.now();
  const internalId = `book_tomato_native_${now}_${Math.random().toString(36).slice(2, 7)}`;
  const chapters: Chapter[] = [];
  for (let i = 0; i < info.chapters.length; i += 1) {
    const chapter = await fetchNativeChapterContent(bookId, info.chapters[i]);
    chapters.push({
      id: `${internalId}_ch_${i}`,
      index: i,
      title: chapter.title,
      content: chapter.content,
      wordCount: chapter.wordCount || chapter.content.length,
    });
    onProgress?.(chapters.length, info.chapters.length, chapter.title);
  }
  const title = info.title || titleHint || '精选网络小说';
  return {
    id: internalId,
    title,
    author: info.author,
    coverUrl: info.coverUrl,
    coverColor: 'from-[#fdfcfa] to-[#f5f1e8]',
    sourceType: 'tomato',
    sourceUrl: input,
    totalChapters: chapters.length,
    totalWords: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    chapters,
    progress: { chapterIndex: 0, chapterTitle: chapters[0]?.title || '第一章', percentage: 0, scrollOffset: 0, lastReadTime: now },
    fetchStatus: { total: chapters.length, completed: chapters.length, isFetching: false, status: 'READY' },
    createdAt: now,
    updatedAt: now,
    isArchived: false,
  };
}
