import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNativeExport, validateNativeExport } from '../src/parsers/nativeExport';
const chapters = [{ item_id: '11', title: '第一章 开始', index: 0, locked: false, need_pay: false },
  { item_id: '12', title: '第二章 继续', index: 1, locked: false, need_pay: false }];
const body = '这是用于验证文件结构的测试文字。'.repeat(12);

test('validates ordered exported TXT, excluding the metadata header', async () => {
  const text = `书籍信息\n介绍中提到第二章 继续\n────────\n第一章 开始\n${body}\n第二章 继续\n${body}`;
  const result = await validateNativeExport(text, chapters);
  assert.equal(result.verifiedChapters, 2);
  assert.equal(result.bytes, new TextEncoder().encode(text).length);
  assert.equal(result.sha256.length, 64);
});

test('rejects a missing title even when it appears inside prose', async () => {
  await assert.rejects(validateNativeExport(`第一章 开始\n${body}故事中提到第二章 继续，但没有这个章节。`, chapters), /缺少章节/);
});

test('rejects missing, reordered, short and restricted chapter bodies', async () => {
  await assert.rejects(validateNativeExport(`第二章 继续\n${body}\n第一章 开始\n${body}`, chapters), /缺少章节/);
  await assert.rejects(validateNativeExport(`第一章 开始\n短文\n第二章 继续\n${body}`, chapters), /过短/);
  await assert.rejects(validateNativeExport(`第一章 开始\n${body}试读结束\n第二章 继续\n${body}`, chapters), /试读/);
});

 test('splits by exact directory titles, including nonstandard headings', () => {
  const directory = chapters.map((chapter, index) => ({ ...chapter, title: index === 0 ? '序' : '八' }));
  const parsed = parseNativeExport(`序\n${body}\n八\n${body}`, directory, '书', '作者');
  assert.equal(parsed.chapters.length, 2);
  assert.deepEqual(parsed.chapters.map(chapter => chapter.title), ['序', '八']);
  assert.equal(parsed.chapters[1].content, body);
});

test('preserves short copyright front matter without weakening ordinary chapter checks', async () => {
  const directory = [{ ...chapters[0], title: '版权信息' }, chapters[1]];
  const result = await validateNativeExport(`版权信息\n作者：鲁迅\n第二章 继续\n${body}`, directory);
  assert.equal(result.verifiedChapters, 2);
  assert.match(result.warnings[0], /附属信息较短/);
  await assert.rejects(validateNativeExport(`版权信息\n第二章 继续\n${body}`, directory), /过短/);
});
