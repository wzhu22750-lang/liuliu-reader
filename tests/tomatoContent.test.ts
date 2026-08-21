import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessChapterCompleteness,
  buildProviderUrl,
  extractInitialState,
  normalizeNovelContent,
  parseProviderPayload,
} from '../src/server/tomatoContent';

test('extractInitialState handles braces inside JSON strings', () => {
  const state = extractInitialState('<script>window.__INITIAL_STATE__={"page":{"text":"a } b","ok":true}};</script>');
  assert.equal(state.page.text, 'a } b');
  assert.equal(state.page.ok, true);
});

test('normalizes XHTML while preserving paragraphs', () => {
  assert.equal(normalizeNovelContent('<p>第一段</p><p>第二段&amp;内容</p>'), '第一段\n\n第二段&内容');
});

test('uses chapter metadata rather than a fixed minimum length', () => {
  const result = assessChapterCompleteness({
    itemId: '11', title: '第十一章', content: '预览'.repeat(85),
    expectedWordCount: 3200, isChapterLock: true, needPay: false,
  });
  assert.equal(result.complete, false);
  assert.equal(result.isPreview, true);
  assert.match(result.reason || '', /预览/);
});

test('parses mature batch_full chapter-id map responses', () => {
  const result = parseProviderPayload({ data: { '123': { title: '章节', content: '<p>完整正文</p>' } } }, '123', 'mock');
  assert.deepEqual(result, { itemId: '123', title: '章节', content: '完整正文', provider: 'mock' });
});

test('builds configurable batch provider URLs', () => {
  const url = buildProviderUrl('https://example.test/reading/reader/batch_full/v', '456', '123');
  assert.match(url, /item_ids=123/);
  assert.match(url, /book_id=456/);
});
