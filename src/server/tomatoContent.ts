export interface ChapterSnapshot {
  itemId: string;
  bookId?: string;
  title: string;
  content: string;
  expectedWordCount?: number;
  isChapterLock: boolean;
  needPay: boolean;
  fontUrl?: string;
}

export interface ChapterCompleteness {
  complete: boolean;
  isPreview: boolean;
  actualWordCount: number;
  expectedWordCount?: number;
  reason?: string;
}

export interface ProviderChapter {
  itemId: string;
  title?: string;
  content: string;
  provider: string;
}

export function normalizeNovelContent(value: unknown): string {
  if (typeof value === 'string') {
    return value
      .replace(/<p\b[^>]*>/gi, '')
      .replace(/<\/p\s*>/gi, '\n\n')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&amp;/gi, '&')
      .replace(/<[^>]+>/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeNovelContent).filter(Boolean).join('\n\n');
  }
  return '';
}

export function extractInitialState(html: string): any {
  const marker = 'window.__INITIAL_STATE__=';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new Error('页面缺少 INITIAL_STATE');

  const source = html.slice(markerIndex + marker.length).trimStart();
  if (!source.startsWith('{')) throw new Error('INITIAL_STATE 不是 JSON 对象');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(0, index + 1));
    }
  }
  throw new Error('INITIAL_STATE JSON 不完整');
}

export function assessChapterCompleteness(snapshot: ChapterSnapshot): ChapterCompleteness {
  const actualWordCount = Array.from(snapshot.content).length;
  const expectedWordCount = snapshot.expectedWordCount && snapshot.expectedWordCount > 0
    ? snapshot.expectedWordCount
    : undefined;

  if (!snapshot.content.trim()) {
    return { complete: false, isPreview: false, actualWordCount, expectedWordCount, reason: '正文为空' };
  }
  if (snapshot.isChapterLock) {
    return { complete: false, isPreview: true, actualWordCount, expectedWordCount, reason: '网页章节已锁定，仅返回预览' };
  }
  if (expectedWordCount && actualWordCount < expectedWordCount * 0.85) {
    return {
      complete: false,
      isPreview: true,
      actualWordCount,
      expectedWordCount,
      reason: `正文仅 ${actualWordCount} 字，元数据声明约 ${expectedWordCount} 字`,
    };
  }
  return { complete: true, isPreview: false, actualWordCount, expectedWordCount };
}

function contentFromObject(value: any): string {
  return normalizeNovelContent(
    value?.content ?? value?.origin_content ?? value?.text ?? value?.paragraphs ?? value?.sections ?? value?.content_list
  );
}

export function parseProviderPayload(payload: any, itemId: string, provider: string): ProviderChapter | null {
  const root = payload?.data ?? payload;
  const candidates: any[] = [];
  if (root && typeof root === 'object') {
    if (root[itemId]) candidates.push(root[itemId]);
    candidates.push(root);
    for (const key of ['items', 'item_list', 'chapters', 'results']) {
      if (Array.isArray(root[key])) candidates.push(...root[key]);
    }
  }
  if (Array.isArray(root)) candidates.push(...root);

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const candidateId = String(candidate.item_id ?? candidate.itemId ?? candidate.id ?? itemId);
    if (candidateId !== itemId && candidates.length > 1) continue;
    const content = contentFromObject(candidate);
    if (!content || content === 'Invalid') continue;
    return {
      itemId,
      title: candidate.title ?? candidate.chapter_title ?? candidate.origin_chapter_title,
      content,
      provider,
    };
  }
  return null;
}

export function configuredContentEndpoints(raw = process.env.FANQIE_CONTENT_API_ENDPOINTS || ''): string[] {
  return raw
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function buildProviderUrl(endpoint: string, bookId: string | undefined, itemId: string): string {
  let url = endpoint
    .replaceAll('{item_id}', encodeURIComponent(itemId))
    .replaceAll('{item_ids}', encodeURIComponent(itemId))
    .replaceAll('{book_id}', encodeURIComponent(bookId || ''));
  if (url !== endpoint) return url;

  const parsed = new URL(url);
  if (/batch_full|batch_chapter/.test(parsed.pathname)) parsed.searchParams.set('item_ids', itemId);
  else parsed.searchParams.set('item_id', itemId);
  if (bookId) parsed.searchParams.set('book_id', bookId);
  return parsed.toString();
}
