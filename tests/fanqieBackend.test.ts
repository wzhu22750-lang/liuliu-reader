import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FANQIE_ACTIONS,
  createFanqieActionRequest,
} from '../src/platform/fanqieBackend';

test('Fanqie action requests use the recovered dispatch envelope', () => {
  assert.equal(FANQIE_ACTIONS.search, 'search');
  assert.deepEqual(
    createFanqieActionRequest(FANQIE_ACTIONS.chapterContent, { book_id: 'book-1', item_id: 'item-1' }),
    {
      action: 'chapter_content',
      payload: { book_id: 'book-1', item_id: 'item-1' },
    },
  );
});

import {
  fetchNativeBookInfo,
  fetchNativeChapterContent,
  searchFanqieBooks,
} from '../src/platform/fanqieReaderAdapter';

test('native reader adapter normalizes wrapped search and detail responses', async () => {
  const original = (globalThis as { window?: unknown }).window;
  const calls: Array<{ command: string; args: unknown }> = [];
  (globalThis as { window?: unknown }).window = {
    __TAURI__: {
      core: {
        invoke: async (command: string, args?: unknown) => {
          calls.push({ command, args });
          const action = (args as { action: string }).action;
          if (action === 'search') return { data: { items: [{ book_id: 'b1', title: '测试书', author: '作者' }] } };
          return { result: { book: { book_id: 'b1', title: '测试书', author: '作者', chapters: [{ item_id: 'c1', title: '第一章', index: 0 }] } } };
        },
      },
    },
  };
  try {
    assert.deepEqual(await searchFanqieBooks('测试书'), [{ bookId: 'b1', title: '测试书', author: '作者', coverUrl: undefined, description: undefined }]);
    const info = await fetchNativeBookInfo('b1');
    assert.equal(info.chapters[0].item_id, 'c1');
    assert.equal(calls.length, 2);
  } finally {
    (globalThis as { window?: unknown }).window = original;
  }
});

test('native reader adapter normalizes chapter content', async () => {
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    __TAURI__: {
      invoke: async (_command: string, args?: unknown) => {
        assert.equal((args as { action: string }).action, 'chapter_content');
        return { data: { title: '第一章', content: '正文内容', word_count: 4 } };
      },
    },
  };
  try {
    const chapter = await fetchNativeChapterContent('b1', { item_id: 'c1', title: '第一章', index: 0 });
    assert.deepEqual(chapter, { title: '第一章', content: '正文内容', wordCount: 4 });
  } finally {
    (globalThis as { window?: unknown }).window = original;
  }
});
