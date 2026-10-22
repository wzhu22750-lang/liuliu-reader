import assert from 'node:assert/strict';
import test from 'node:test';
import { integratedBook, integratedDownload, integratedFileText, integratedJob, integratedPendingJobs, integratedStatus } from '../src/platform/integratedFanqie';
const saved = new Map<string, string>();
const store = { get length() { return saved.size; }, key: (index: number) => [...saved.keys()][index], getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) };
Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
let locked = false, status = 'completed', contents = '', creates = 0, partialResult = false, engineRestarted = false;
const seen: string[] = [];
const events = new EventTarget();
Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
  __TAURI__: { core: { invoke: async (command: string, args: any) => {
    assert.equal(command, 'dispatch'); seen.push(args.action);
    if (args.action === 'bootstrap') return { jobs: engineRestarted ? [] : [{ id: 'job-1', status, progress: 100, output_path: '/managed/book.txt', result: { partial: partialResult, missing_chapters: partialResult ? ['456'] : [] } }] };
    if (args.action === 'book_detail') return { book_id: '123', book_name: '测试书', author: '作者', chapters: [{ item_id: '456', title: '第一章 开始', locked }] };
    if (args.action === 'create_download') { creates++; assert.equal(args.payload.save_dir, '/managed'); return { id: 'job-1' }; }
    throw new Error(`Unexpected action ${args.action}`);
  } } },
  LiuliReaderFiles: { bookPageAsync: (bookId: string, requestId: string) => {
    const html = 'window.__INITIAL_STATE__=' + JSON.stringify({ page: { bookId: '123', bookName: '测试书', author: '作者', chapterListWithVolume: [[{ itemId: '456', title: '第一章 开始', isChapterLock: locked }]] } });
    events.dispatchEvent(new CustomEvent('liuli-book-page', { detail: { id: requestId, result: { html } } }));
  }, createDownloadDirectory: () => JSON.stringify({ path: '/managed' }), downloadDirectory: () => JSON.stringify({ path: '/managed' }), readText: () => JSON.stringify({ text: contents }) },
} });

test('in-app engine dispatch, restricted range refusal, persisted jobs and partial export rejection', async () => {
  assert.equal((await integratedStatus()).capabilities?.download, true);
  locked = true;
  await assert.rejects(integratedDownload({ bookId: '123', start: 1, end: 1 }), /受限/);
  assert.equal(creates, 0);
  locked = false;
  await assert.rejects(integratedDownload({ bookId: '123', start: 0, end: 1 }), /范围/);
  const ticket = await integratedDownload({ bookId: '123', start: 1, end: 1 });
  assert.equal(integratedPendingJobs().length, 1);
  contents = '第一章 开始\n试读结束';
  const partial = await integratedJob(ticket.jobId);
  assert.equal(partial.status, 'partial'); assert.equal(partial.file, undefined);
  assert.throws(() => integratedFileText(ticket.jobId), /尚未通过/);
  status = 'running';
  assert.equal((await integratedJob(ticket.jobId)).file, undefined);
  status = 'completed'; contents = '第一章 开始\n' + '测试章节正文。'.repeat(40);
  partialResult = true;
  assert.equal((await integratedJob(ticket.jobId)).status, 'partial');
  partialResult = false;
  const complete = await integratedJob(ticket.jobId);
  assert.equal(complete.file?.validation.verifiedChapters, 1);
  assert.equal(integratedFileText(ticket.jobId), contents);
  engineRestarted = true;
  assert.equal((await integratedJob(ticket.jobId)).file?.validation.verifiedChapters, 1);
  assert.ok(seen.includes('create_download'));
  await assert.rejects(integratedBook('bad'), /ID/);
});
