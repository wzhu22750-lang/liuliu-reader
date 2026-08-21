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
