import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeStatus, validateCompleteChapter } from '../src/platform/nativeDownloadProvider';

test('native job states map to reader download states', () => {
  assert.equal(nativeStatus('queued'), 'QUEUED');
  assert.equal(nativeStatus('running'), 'RUNNING');
  assert.equal(nativeStatus('paused'), 'PAUSED');
  assert.equal(nativeStatus('done'), 'COMPLETED');
  assert.equal(nativeStatus('failed'), 'FAILED');
});

test('native chapter validation normalizes HTML and accepts complete text', () => {
  const result = validateCompleteChapter('第一章', '<p>第一段</p><p>第二段</p>');
  assert.equal(result.content, '第一段\n\n第二段');
  assert.equal(result.wordCount, 6);
});

test('native chapter validation rejects locked previews', () => {
  assert.throws(
    () => validateCompleteChapter('锁章', '本章为锁定章节，请打开番茄小说继续阅读'),
    /锁章预览/,
  );
});
