import {
  Book,
  Excerpt,
  Highlight,
  Bookmark,
  AIInterpretation,
  ReaderSettings,
  AISettings,
  BackupData,
} from '../types';
import { DEMO_BOOKS } from '../parsers/demoBooks';

const DB_NAME = 'ReaderAIDatabase';
const DB_VERSION = 1;

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontSize: 18,
  lineHeight: 1.8,
  theme: 'claude',
  renderMode: 'scroll',
  spoilerScope: 'current',
  lastHighlightStyle: 'amber',
  autoSnapSentence: true,
};

export const DEFAULT_AI_SETTINGS: AISettings = {
  apiBaseUrl: '',
  apiKey: '',
  modelName: 'gemini-3.7-flash',
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains('books')) {
        const bookStore = db.createObjectStore('books', { keyPath: 'id' });
        bookStore.createIndex('title', 'title', { unique: false });
        bookStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('excerpts')) {
        const excerptStore = db.createObjectStore('excerpts', { keyPath: 'id' });
        excerptStore.createIndex('bookId', 'bookId', { unique: false });
        excerptStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('highlights')) {
        const highlightStore = db.createObjectStore('highlights', { keyPath: 'id' });
        highlightStore.createIndex('bookId', 'bookId', { unique: false });
        highlightStore.createIndex('chapterIndex', 'chapterIndex', { unique: false });
      }

      if (!db.objectStoreNames.contains('bookmarks')) {
        const bookmarkStore = db.createObjectStore('bookmarks', { keyPath: 'id' });
        bookmarkStore.createIndex('bookId', 'bookId', { unique: false });
      }

      if (!db.objectStoreNames.contains('ai_cache')) {
        const aiStore = db.createObjectStore('ai_cache', { keyPath: 'id' });
        aiStore.createIndex('lookupKey', ['bookId', 'chapterIndex'], { unique: false });
      }

      if (!db.objectStoreNames.contains('app_settings')) {
        db.createObjectStore('app_settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------------- INITIAL SEEDING ----------------
export async function seedInitialDataIfEmpty(): Promise<void> {
  const books = await getAllBooks();
  if (books.length === 0) {
    for (const demoBook of DEMO_BOOKS) {
      await saveBook(demoBook);
    }
    // Also seed sample excerpt & highlight
    const sampleExcerpt: Excerpt = {
      id: 'exc_sample_1',
      bookId: 'demo_escape_freedom',
      bookTitle: '逃避自由',
      chapterTitle: '第一章 自由——一个心理学问题吗？',
      chapterIndex: 0,
      text: '自由尽管给现代人带来了独立与理性，但也使他孤立并由此感到焦虑与无能为力。',
      thought: '弗洛姆揭示了现代性焦虑的心理学本质：当外在束缚瓦解后，孤独感成为个体必须面对的终极命题。',
      createdAt: Date.now() - 3600000 * 2,
    };
    await addExcerpt(sampleExcerpt);

    const sampleHighlight: Highlight = {
      id: 'hl_sample_1',
      bookId: 'demo_escape_freedom',
      chapterIndex: 0,
      chapterTitle: '第一章 自由——一个心理学问题吗？',
      text: '自由尽管给现代人带来了独立与理性，但也使他孤立并由此感到焦虑与无能为力。',
      startOffset: 200,
      endOffset: 240,
      style: 'amber',
      createdAt: Date.now() - 3600000 * 2,
    };
    await addHighlight(sampleHighlight);
  }
}

// ---------------- BOOK OPERATIONS ----------------
export async function getAllBooks(): Promise<Book[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readonly');
    const store = tx.objectStore('books');
    const request = store.getAll();
    request.onsuccess = () => {
      const books = (request.result as Book[]) || [];
      // Filter out archived if needed, but sort by last read / updatedAt desc
      books.sort((a, b) => (b.progress?.lastReadTime || b.updatedAt) - (a.progress?.lastReadTime || a.updatedAt));
      resolve(books);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getBookById(id: string): Promise<Book | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readonly');
    const store = tx.objectStore('books');
    const request = store.get(id);
    request.onsuccess = () => resolve((request.result as Book) || null);
    request.onerror = () => reject(request.error);
  });
}

export async function findBookByTitle(title: string): Promise<Book | null> {
  const books = await getAllBooks();
  return books.find((b) => b.title.trim().toLowerCase() === title.trim().toLowerCase()) || null;
}

export async function saveBook(book: Book): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const request = store.put(book);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// 移出书库 (Archive / Hide) - Preserves book and reading data
export async function archiveBook(id: string, isArchived = true): Promise<void> {
  const book = await getBookById(id);
  if (!book) return;
  book.isArchived = isArchived;
  book.updatedAt = Date.now();
  await saveBook(book);
}

export const hideBook = archiveBook;

// 彻底删除书籍 (Physical Delete) - Removes book & associated highlights, BUT permanently retains excerpts!
export async function deleteBookPermanently(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['books', 'highlights', 'bookmarks', 'ai_cache'], 'readwrite');
    
    // 1. Delete Book
    tx.objectStore('books').delete(id);

    // 2. Delete Highlights
    const hlStore = tx.objectStore('highlights');
    const hlIndex = hlStore.index('bookId');
    const hlReq = hlIndex.getAllKeys(id);
    hlReq.onsuccess = () => {
      for (const key of hlReq.result) {
        hlStore.delete(key);
      }
    };

    // 3. Delete Bookmarks
    const bmStore = tx.objectStore('bookmarks');
    const bmIndex = bmStore.index('bookId');
    const bmReq = bmIndex.getAllKeys(id);
    bmReq.onsuccess = () => {
      for (const key of bmReq.result) {
        bmStore.delete(key);
      }
    };

    // NOTE: Excerpts are explicitly NOT deleted per PRD:
    // "彻底删除：物理删除书籍文件与高亮，摘抄本中的纯文本依然独立保留。"

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const deleteBook = deleteBookPermanently;


export async function updateBookProgress(
  id: string,
  chapterIndex: number,
  chapterTitle: string,
  percentage: number,
  scrollOffset = 0
): Promise<void> {
  const book = await getBookById(id);
  if (!book) return;
  book.progress = {
    chapterIndex,
    chapterTitle,
    percentage: Math.min(100, Math.max(0, Math.round(percentage))),
    scrollOffset,
    lastReadTime: Date.now(),
  };
  book.updatedAt = Date.now();
  await saveBook(book);
}

// ---------------- EXCERPT OPERATIONS (摘抄本) ----------------
export async function getAllExcerpts(): Promise<Excerpt[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('excerpts', 'readonly');
    const store = tx.objectStore('excerpts');
    const request = store.getAll();
    request.onsuccess = () => {
      const list = (request.result as Excerpt[]) || [];
      list.sort((a, b) => b.createdAt - a.createdAt);
      resolve(list);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function addExcerpt(excerpt: Excerpt): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('excerpts', 'readwrite');
    const store = tx.objectStore('excerpts');
    const request = store.put(excerpt);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteExcerpt(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('excerpts', 'readwrite');
    const store = tx.objectStore('excerpts');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function updateExcerptThought(id: string, thought: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('excerpts', 'readwrite');
    const store = tx.objectStore('excerpts');
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result as Excerpt;
      if (item) {
        item.thought = thought;
        store.put(item);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------- HIGHLIGHT OPERATIONS ----------------
export async function getHighlightsByBook(bookId: string): Promise<Highlight[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('highlights', 'readonly');
    const store = tx.objectStore('highlights');
    const index = store.index('bookId');
    const request = index.getAll(bookId);
    request.onsuccess = () => resolve((request.result as Highlight[]) || []);
    request.onerror = () => reject(request.error);
  });
}

export async function addHighlight(highlight: Highlight): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('highlights', 'readwrite');
    const store = tx.objectStore('highlights');
    const request = store.put(highlight);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteHighlight(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('highlights', 'readwrite');
    const store = tx.objectStore('highlights');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ---------------- BOOKMARK OPERATIONS ----------------
export async function getBookmarksByBook(bookId: string): Promise<Bookmark[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('bookmarks', 'readonly');
    const store = tx.objectStore('bookmarks');
    const index = store.index('bookId');
    const request = index.getAll(bookId);
    request.onsuccess = () => {
      const list = (request.result as Bookmark[]) || [];
      list.sort((a, b) => b.createdAt - a.createdAt);
      resolve(list);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function addBookmark(bookmark: Bookmark): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('bookmarks', 'readwrite');
    const store = tx.objectStore('bookmarks');
    const request = store.put(bookmark);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteBookmark(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('bookmarks', 'readwrite');
    const store = tx.objectStore('bookmarks');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ---------------- AI INTERPRETATION CACHE ----------------
export async function findCachedAIInterpretation(
  bookId: string,
  chapterIndex: number,
  selectedText: string
): Promise<AIInterpretation | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('ai_cache', 'readonly');
    const store = tx.objectStore('ai_cache');
    const request = store.getAll();
    request.onsuccess = () => {
      const list = (request.result as AIInterpretation[]) || [];
      const match = list.find(
        (item) =>
          item.bookId === bookId &&
          item.chapterIndex === chapterIndex &&
          item.selectedText.trim() === selectedText.trim()
      );
      resolve(match || null);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveAIInterpretation(item: AIInterpretation): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('ai_cache', 'readwrite');
    const store = tx.objectStore('ai_cache');
    const request = store.put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ---------------- SETTINGS ----------------
export async function getReaderSettings(): Promise<ReaderSettings> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('app_settings', 'readonly');
    const store = tx.objectStore('app_settings');
    const request = store.get('reader_settings');
    request.onsuccess = () => {
      const settings = { ...DEFAULT_READER_SETTINGS, ...(request.result?.value || {}) } as ReaderSettings & { theme?: string };
      // Old theme identifiers are intentionally retired. Existing readers safely land on Claude style.
      if (settings.theme !== 'ink' && settings.theme !== 'claude') {
        settings.theme = 'claude';
      }
      resolve(settings as ReaderSettings);
    };
    request.onerror = () => resolve(DEFAULT_READER_SETTINGS);
  });
}

export async function saveReaderSettings(settings: ReaderSettings): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('app_settings', 'readwrite');
    const store = tx.objectStore('app_settings');
    const request = store.put({ key: 'reader_settings', value: settings });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getAISettings(): Promise<AISettings> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('app_settings', 'readonly');
    const store = tx.objectStore('app_settings');
    const request = store.get('ai_settings');
    request.onsuccess = () => {
      resolve({ ...DEFAULT_AI_SETTINGS, ...(request.result?.value || {}) });
    };
    request.onerror = () => resolve(DEFAULT_AI_SETTINGS);
  });
}

export async function saveAISettings(settings: AISettings): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('app_settings', 'readwrite');
    const store = tx.objectStore('app_settings');
    const request = store.put({ key: 'ai_settings', value: settings });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ---------------- BACKUP & RESTORE ----------------
export async function generateBackup(type: 'full' | 'data-only'): Promise<BackupData> {
  const [books, excerpts, highlights, bookmarks, readerSettings] = await Promise.all([
    type === 'full' ? getAllBooks() : Promise.resolve([]),
    getAllExcerpts(),
    type === 'full' ? getAllHighlights() : Promise.resolve([]),
    type === 'full' ? getAllBookmarks() : Promise.resolve([]),
    getReaderSettings(),
  ]);

  const db = await openDB();
  const aiCache: AIInterpretation[] = await new Promise((resolve) => {
    const tx = db.transaction('ai_cache', 'readonly');
    const req = tx.objectStore('ai_cache').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });

  return {
    version: '1.0.0',
    exportedAt: Date.now(),
    type,
    books: type === 'full' ? books : undefined,
    excerpts,
    highlights,
    bookmarks,
    aiInterpretations: aiCache,
    readerSettings,
  };
}

async function getAllHighlights(): Promise<Highlight[]> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('highlights', 'readonly');
    const req = tx.objectStore('highlights').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function getAllBookmarks(): Promise<Bookmark[]> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('bookmarks', 'readonly');
    const req = tx.objectStore('bookmarks').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

export async function restoreBackup(backup: BackupData): Promise<{ success: boolean; message: string }> {
  if (!backup || !backup.version) {
    throw new Error('无效的备份文件格式');
  }

  const db = await openDB();
  const tx = db.transaction(['books', 'excerpts', 'highlights', 'bookmarks', 'ai_cache', 'app_settings'], 'readwrite');

  if (backup.books && backup.books.length > 0) {
    const bookStore = tx.objectStore('books');
    for (const book of backup.books) {
      bookStore.put(book);
    }
  }

  if (backup.excerpts && backup.excerpts.length > 0) {
    const excerptStore = tx.objectStore('excerpts');
    for (const exc of backup.excerpts) {
      excerptStore.put(exc);
    }
  }

  if (backup.highlights && backup.highlights.length > 0) {
    const hlStore = tx.objectStore('highlights');
    for (const hl of backup.highlights) {
      hlStore.put(hl);
    }
  }

  if (backup.bookmarks && backup.bookmarks.length > 0) {
    const bmStore = tx.objectStore('bookmarks');
    for (const bm of backup.bookmarks) {
      bmStore.put(bm);
    }
  }

  if (backup.aiInterpretations && backup.aiInterpretations.length > 0) {
    const aiStore = tx.objectStore('ai_cache');
    for (const ai of backup.aiInterpretations) {
      aiStore.put(ai);
    }
  }

  if (backup.readerSettings) {
    tx.objectStore('app_settings').put({ key: 'reader_settings', value: backup.readerSettings });
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve({ success: true, message: '备份已成功恢复！' });
    tx.onerror = () => reject(tx.error);
  });
}
