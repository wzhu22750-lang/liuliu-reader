import type { FanqieBook, FanqieSearchItem } from '../api/fanqie';

const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const clean = (value: unknown): string => text(value).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const flag = (value: unknown): boolean => value === true || value === 1 || value === '1';
const validId = (value: unknown): boolean => /^\d{1,30}$/.test(text(value));

export function parseNativeSearchResponse(value: unknown): FanqieSearchItem[] {
  if (!record(value) || value.code !== 0 || !record(value.data) || !Array.isArray(value.data.ret_data)) {
    throw new Error('搜索服务未返回有效结果，请稍后重试');
  }
  return value.data.ret_data.filter(item => record(item) && validId(item.book_id) && clean(item.title)).map(item => ({
    book_id: text(item.book_id), book_name: clean(item.title), author: clean(item.author),
    abstract: clean(item.abstract), cover_url: typeof item.thumb_url === 'string' && item.thumb_url.startsWith('https://') ? item.thumb_url : '',
    word_count: text(item.word_count ?? item.word_number), status: text(item.creation_status) === '0' ? '已完结' : text(item.creation_status) === '1' ? '连载中' : '',
    read_count: text(item.toutiao_click_rate),
  }));
}

// Parse the page's JSON assignment as data; never execute a source-site script.
export function parseNativeBookPage(html: string, expectedId: string): FanqieBook {
  if (!validId(expectedId) || html.length > 4_000_000) throw new Error('书籍信息无效');
  const marker = /window\.__INITIAL_STATE__\s*=\s*/.exec(html);
  if (!marker) throw new Error('暂时无法读取书籍目录，请稍后重试');
  const start = marker.index + marker[0].length;
  let depth = 0, quoted = false, escaped = false, end = -1;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) { end = index + 1; break; }
  }
  if (end < 0) throw new Error('书籍目录数据不完整');
  let state: unknown;
  try { state = JSON.parse(html.slice(start, end)); } catch { throw new Error('书籍目录格式无效'); }
  const page = record(state) && record(state.page) ? state.page : null;
  if (!page || text(page.bookId) !== expectedId || !clean(page.bookName) || !Array.isArray(page.chapterListWithVolume)) {
    throw new Error('未找到该书的公开目录');
  }
  const rawChapters = page.chapterListWithVolume.flat();
  if (rawChapters.length === 0 || rawChapters.length > 100_000 || rawChapters.some(item => !record(item) || !validId(item.itemId) || !clean(item.title))) {
    throw new Error('书籍目录不完整，未加载');
  }
  const seen = new Set<string>();
  const chapters = rawChapters.map((item, index) => {
    const id = text(item.itemId);
    if (seen.has(id)) throw new Error('书籍目录包含重复章节');
    seen.add(id);
    return { item_id: id, title: clean(item.title), index,
      locked: flag(item.isChapterLock) || flag(item.needPay) || flag(item.isPaidPublication) || flag(item.isPaidStory),
      need_pay: flag(item.needPay) || flag(item.isPaidPublication) || flag(item.isPaidStory) };
  });
  return { book_id: expectedId, book_name: clean(page.bookName), author: clean(page.author),
    cover_url: typeof page.thumbUrl === 'string' && page.thumbUrl.startsWith('https://') ? page.thumbUrl : '',
    abstract: clean(page.abstract), word_count: text(page.wordNumber), status: text(page.creationStatus) === '0' ? '已完结' : '连载中',
    save_dir: '', chapters, chapterCount: chapters.length, lockedCount: chapters.filter(chapter => chapter.locked).length };
}
