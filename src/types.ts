export type SourceType = 'txt' | 'epub' | 'tomato' | 'demo';

export interface Chapter {
  id: string;
  index: number;
  title: string;
  content: string; // Plain text with \n\n paragraph separators
  wordCount: number;
  fontUrl?: string;
}

export interface BookProgress {
  chapterIndex: number;
  chapterTitle: string;
  percentage: number; // 0 to 100
  scrollOffset?: number;
  lastReadTime: number;
}

export type BookImportStatus = 'IMPORTING' | 'READY' | 'FAILED';

export interface FetchStatus {
  total: number;
  completed: number;
  isFetching: boolean;
  status?: BookImportStatus;
  error?: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  coverUrl?: string;
  coverColor?: string; // Aesthetic gradient or minimal pastel background
  fontUrl?: string; // custom web font woff2 for novel platforms
  sourceType: SourceType;
  sourceUrl?: string;
  totalChapters: number;
  totalWords?: number; // total word count across all chapters
  chapters: Chapter[];
  progress: BookProgress;
  createdAt: number;
  updatedAt: number;
  isArchived?: boolean; // 移出书库/隐去 (true) vs 正常在书架中
  fetchStatus?: FetchStatus; // for streaming/tomato
}

export type HighlightStyle = 'amber' | 'emerald' | 'rose' | 'sky' | 'purple' | 'underline' | 'wavy';

export interface Highlight {
  id: string;
  bookId: string;
  chapterIndex: number;
  chapterTitle: string;
  text: string;
  startOffset: number;
  endOffset: number;
  style: HighlightStyle;
  createdAt: number;
}

export interface Excerpt {
  id: string;
  bookId: string; // Kept so if original book still exists in DB, user can jump back!
  bookTitle: string;
  chapterTitle: string;
  chapterIndex: number;
  text: string;
  thought?: string; // Optional user reflection
  positionOffset?: number;
  createdAt: number;
}

export interface Bookmark {
  id: string;
  bookId: string;
  chapterIndex: number;
  chapterTitle: string;
  snippet: string; // +/- 20 chars
  percentage: number;
  scrollOffset?: number;
  createdAt: number;
}

export interface AIInterpretation {
  id: string;
  bookId: string;
  chapterIndex: number;
  selectedText: string;
  explanation: string;
  spoilerScope: 'current' | 'chapter' | 'book';
  createdAt: number;
}

export interface ReaderSettings {
  fontSize: number; // 14 to 28, default 18
  lineHeight: number; // 1.4 to 2.4, default 1.8
  theme: 'light' | 'sepia' | 'dark' | 'night' | 'ink'; // default 'light'
  renderMode: 'scroll' | 'page'; // default 'scroll' for smooth novel reading
  spoilerScope: 'current' | 'chapter' | 'book'; // default 'current'
  lastHighlightStyle: HighlightStyle;
  autoSnapSentence: boolean; // default true
}

export interface AISettings {
  apiBaseUrl: string; // e.g. https://api.deepseek.com/v1 or custom proxy
  apiKey: string;
  modelName: string; // e.g. deepseek-chat, gemini-3.7-flash, gpt-4o-mini
}

export interface BackupData {
  version: string;
  exportedAt: number;
  type: 'full' | 'data-only';
  books?: Book[];
  excerpts: Excerpt[];
  highlights: Highlight[];
  bookmarks: Bookmark[];
  aiInterpretations: AIInterpretation[];
  readerSettings: ReaderSettings;
}
