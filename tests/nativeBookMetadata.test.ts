import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNativeBookPage, parseNativeSearchResponse } from '../src/parsers/nativeBookMetadata';

const bookId = '1234567890123456789';
const makePage = (page: Record<string, unknown>) => `<html><script>window.__INITIAL_STATE__ = ${JSON.stringify({page})};window.after=true;</script></html>`;
const page = {
  bookId, bookName: '原创目录验证', author: '测试作者', wordNumber: 120,
  chapterListWithVolume: [[
    {itemId: '1001', title: '第一章 花括号 } 与 "引号"', isChapterLock: false, needPay: 0},
    {itemId: '1002', title: '第二章 受限章节', isChapterLock: true, needPay: 0},
    {itemId: '1003', title: '第三章 付费章节', isChapterLock: false, needPay: 1},
  ]],
};

test('native search normalizes actual SDK response shape and excludes invalid identities', () => {
  const result = parseNativeSearchResponse({code: 0, data: {ret_data: [
    {book_id: bookId, title: '<em>原创</em> &amp; 小说', author: '作者', creation_status: '0', thumb_url: 'https://example.com/cover.png'},
    {book_id: 'javascript:invalid', title: '错误 ID'},
    {book_id: '12', title: ''},
  ]}});
  assert.equal(result.length, 1);
  assert.equal(result[0].book_id, bookId);
  assert.equal(result[0].book_name, '原创 & 小说');
  assert.equal(result[0].status, '已完结');
});

test('empty search results are valid, upstream errors and malformed payloads fail', () => {
  assert.deepEqual(parseNativeSearchResponse({code: 0, data: {ret_data: []}}), []);
  for (const value of [null, '', {}, {code: 1, data: {ret_data: []}}, {code: 0, data: {}}]) {
    assert.throws(() => parseNativeSearchResponse(value), /有效结果/);
  }
});

test('native directory parses JSON without executing scripts and preserves source restriction flags', () => {
  const result = parseNativeBookPage(makePage(page), bookId);
  assert.equal(result.book_name, '原创目录验证');
  assert.equal(result.chapterCount, 3);
  assert.equal(result.lockedCount, 2);
  assert.deepEqual(result.chapters.map(item => item.item_id), ['1001', '1002', '1003']);
  assert.equal(result.chapters[0].title, '第一章 花括号 } 与 "引号"');
  assert.equal(result.chapters[2].need_pay, true);
  assert.equal('content' in result.chapters[0], false);
});

test('book identity mismatch, missing chapters, duplicates and malformed JSON fail closed', () => {
  assert.throws(() => parseNativeBookPage(makePage(page), '999'), /公开目录/);
  assert.throws(() => parseNativeBookPage(makePage({...page, chapterListWithVolume: [[]]}), bookId), /不完整/);
  assert.throws(() => parseNativeBookPage(makePage({...page, chapterListWithVolume: [[page.chapterListWithVolume[0][0], page.chapterListWithVolume[0][0]]]}), bookId), /重复章节/);
  assert.throws(() => parseNativeBookPage('window.__INITIAL_STATE__={"page":', bookId), /不完整/);
  assert.throws(() => parseNativeBookPage('window.__INITIAL_STATE__={page:1};', bookId), /格式无效/);
  assert.throws(() => parseNativeBookPage('<html>challenge</html>', bookId), /稍后重试/);
});
