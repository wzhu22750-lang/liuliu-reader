import test from 'node:test';
import assert from 'node:assert/strict';
import { stripFanqieHeader } from '../src/parsers/fanqieTxt';
import { parseTxtContent } from '../src/parsers/txtParser';
import { validateTxt } from '../server/fanqieTxt.mjs';

const exported = [
  '书籍信息',
  '',
  '书名：测试书',
  '作者：测试作者',
  '章节数：2 章',
  '',
  '【简介】',
  '这是导出文件自带的书籍信息块。',
  '',
  '————————————————————————————————',
  '',
  '第一章 开端',
  '',
  '这是开端的原创测试正文。',
  '',
  '第二章 继续',
  '',
  '这是继续的原创测试正文。',
].join('\n');

test('fanqie export header is stripped before chapter splitting', () => {
  const cleaned = stripFanqieHeader(exported);
  assert.ok(cleaned.startsWith('第一章 开端'));
  assert.ok(!cleaned.includes('书籍信息'));

  const parsed = parseTxtContent(cleaned, '测试书 - 测试作者.txt');
  assert.deepEqual(parsed.chapters.map(chapter => chapter.title), ['第一章 开端', '第二章 继续']);
  assert.equal(parsed.chapters[0].content, '这是开端的原创测试正文。');
});

test('text without a fanqie header is returned unchanged', () => {
  const plain = '第一章 开端\n\n正文。';
  assert.equal(stripFanqieHeader(plain), plain);
  const noDivider = '书籍信息\n\n书名：测试\n\n第一章 开端\n\n正文。';
  assert.equal(stripFanqieHeader(noDivider), noDivider);
});

test('server validation reports ordered headings and missing ones as warnings', () => {
  const bytes = Buffer.from(exported, 'utf8');
  const ok = validateTxt(bytes, [{ title: '第一章 开端' }, { title: '第二章 继续' }], 1);
  assert.equal(ok.verifiedChapters, 2);
  assert.equal(ok.expectedChapters, 2);
  assert.deepEqual(ok.warnings, []);
  assert.match(ok.sha256, /^[0-9a-f]{64}$/);

  const missing = validateTxt(bytes, [{ title: '第三章 缺席' }], 1);
  assert.equal(missing.verifiedChapters, 0);
  assert.match(missing.warnings[0], /缺少章节标题/);

  assert.throws(() => validateTxt(Buffer.from([0xff, 0xfe]), [{ title: '第一章' }]), /UTF-8/);
});
