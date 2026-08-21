import { isTauri, invoke } from '../platform';
import type {
  AIInterpretation,
  AISettings,
  BackupData,
  Bookmark,
  Book,
  Excerpt,
  Highlight,
  ReaderSettings,
} from '../types';
import * as web from './indexedDB';

export {
  DEFAULT_AI_SETTINGS,
  DEFAULT_READER_SETTINGS,
} from './indexedDB';

export async function seedInitialDataIfEmpty(): Promise<void> {
  if (isTauri()) return;
  return web.seedInitialDataIfEmpty();
}

export async function getAllBooks(): Promise<Book[]> {
  if (isTauri()) return invoke('list_books');
  return web.getAllBooks();
}

export async function getBookById(id: string): Promise<Book | null> {
  if (isTauri()) return invoke('get_book', { id });
  return web.getBookById(id);
}

export async function saveBook(book: Book): Promise<void> {
  if (isTauri()) {
    await invoke('save_book', { book });
    return;
  }
  return web.saveBook(book);
}

export async function deleteBook(id: string): Promise<void> {
  if (isTauri()) {
    await invoke('delete_book', { id });
    return;
  }
  return web.deleteBook(id);
}

export async function hideBook(id: string, isArchived = true): Promise<void> {
  if (isTauri()) {
    await invoke('hide_book', { id, isArchived });
    return;
  }
  return web.hideBook(id, isArchived);
}

export const archiveBook = hideBook;

export async function updateBookProgress(
  id: string,
  chapterIndex: number,
  chapterTitle: string,
  percentage: number,
  scrollOffset = 0
): Promise<void> {
  if (isTauri()) {
    await invoke('update_book_progress', {
      id,
      chapterIndex,
      chapterTitle,
      percentage,
      scrollOffset,
    });
    return;
  }
  return web.updateBookProgress(id, chapterIndex, chapterTitle, percentage, scrollOffset);
}

export async function getAllExcerpts(): Promise<Excerpt[]> {
  if (isTauri()) return invoke('list_excerpts');
  return web.getAllExcerpts();
}

export async function addExcerpt(excerpt: Excerpt): Promise<void> {
  if (isTauri()) {
    await invoke('save_excerpt', { excerpt });
    return;
  }
  return web.addExcerpt(excerpt);
}

export async function deleteExcerpt(id: string): Promise<void> {
  if (isTauri()) {
    await invoke('delete_excerpt', { id });
    return;
  }
  return web.deleteExcerpt(id);
}

export async function updateExcerptThought(id: string, thought: string): Promise<void> {
  if (isTauri()) {
    await invoke('update_excerpt_thought', { id, thought });
    return;
  }
  return web.updateExcerptThought(id, thought);
}

export async function getHighlightsByBook(bookId: string): Promise<Highlight[]> {
  if (isTauri()) return invoke('highlights_by_book', { bookId });
  return web.getHighlightsByBook(bookId);
}

export async function addHighlight(highlight: Highlight): Promise<void> {
  if (isTauri()) {
    await invoke('save_highlight', { highlight });
    return;
  }
  return web.addHighlight(highlight);
}

export async function deleteHighlight(id: string): Promise<void> {
  if (isTauri()) {
    await invoke('delete_highlight', { id });
    return;
  }
  return web.deleteHighlight(id);
}

export async function getBookmarksByBook(bookId: string): Promise<Bookmark[]> {
  if (isTauri()) return invoke('bookmarks_by_book', { bookId });
  return web.getBookmarksByBook(bookId);
}

export async function addBookmark(bookmark: Bookmark): Promise<void> {
  if (isTauri()) {
    await invoke('save_bookmark', { bookmark });
    return;
  }
  return web.addBookmark(bookmark);
}

export async function deleteBookmark(id: string): Promise<void> {
  if (isTauri()) {
    await invoke('delete_bookmark', { id });
    return;
  }
  return web.deleteBookmark(id);
}

export async function findCachedAIInterpretation(
  bookId: string,
  chapterIndex: number,
  selectedText: string
): Promise<AIInterpretation | null> {
  if (isTauri()) return invoke('find_ai', { bookId, chapterIndex, selectedText });
  return web.findCachedAIInterpretation(bookId, chapterIndex, selectedText);
}

export async function saveAIInterpretation(item: AIInterpretation): Promise<void> {
  if (isTauri()) {
    await invoke('save_ai', { item });
    return;
  }
  return web.saveAIInterpretation(item);
}

export async function getReaderSettings(): Promise<ReaderSettings> {
  if (isTauri()) return invoke('reader_settings');
  return web.getReaderSettings();
}

export async function saveReaderSettings(settings: ReaderSettings): Promise<void> {
  if (isTauri()) {
    await invoke('save_reader_settings', { settings });
    return;
  }
  return web.saveReaderSettings(settings);
}

export async function getAISettings(): Promise<AISettings> {
  return web.getAISettings();
}

export async function saveAISettings(settings: AISettings): Promise<void> {
  return web.saveAISettings(settings);
}

export async function generateBackup(type: 'full' | 'data-only'): Promise<BackupData> {
  return web.generateBackup(type);
}

export async function restoreBackup(backup: BackupData): Promise<{ success: boolean; message: string }> {
  return web.restoreBackup(backup);
}

export async function importTxtFile(fileName: string, content: string): Promise<Book> {
  if (isTauri()) return invoke('import_txt', { fileName, content });
  throw new Error('Web 端请继续使用本地解析器');
}

export async function exportBookTxt(id: string): Promise<string> {
  if (isTauri()) return invoke('export_book_txt', { id });
  throw new Error('当前环境不支持原生导出');
}
