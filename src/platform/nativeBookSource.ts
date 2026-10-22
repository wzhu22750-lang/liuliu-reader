import { CapacitorHttp } from '@capacitor/core';
import type { FanqieBook, FanqieSearchItem, FanqieStatus } from '../api/fanqie';
import { parseNativeBookPage, parseNativeSearchResponse } from '../parsers/nativeBookMetadata';

export const nativeBookSourceStatus = (): FanqieStatus => ({
  ok: true, error: null, device: null, backend: 'android-public-api',
  capabilities: { search: true, directory: true, download: false },
});

export async function nativeSearchBooks(keyword: string): Promise<{keyword: string; elapsedMs: number; items: FanqieSearchItem[]}> {
  const query = keyword.trim();
  if (!query || query.length > 100) throw new Error('请输入 1–100 字的书名或关键词');
  const started = Date.now();
  const response = await CapacitorHttp.get({
    url: 'https://api.fanqiesdk.com/api/novel/channel/homepage/search/search/v1/',
    params: { q: query, offset: '0', aid: '13', app_name: 'news_article' },
    responseType: 'json', connectTimeout: 15000, readTimeout: 20000,
  });
  if (response.status !== 200) throw new Error(`搜索服务暂时不可用（HTTP ${response.status}）`);
  let payload: unknown = response.data;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { throw new Error('搜索服务返回了无效数据'); }
  }
  return { keyword: query, elapsedMs: Date.now() - started, items: parseNativeSearchResponse(payload) };
}

export async function nativeGetBook(id: string): Promise<FanqieBook> {
  if (!/^\d{1,30}$/.test(id)) throw new Error('书籍 ID 无效');
  const response = await CapacitorHttp.get({
    url: `https://fanqienovel.com/page/${id}`,
    headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0' },
    responseType: 'text', connectTimeout: 15000, readTimeout: 20000,
  });
  if (response.status !== 200 || typeof response.data !== 'string') throw new Error('暂时无法读取书籍详情');
  return parseNativeBookPage(response.data, id);
}
