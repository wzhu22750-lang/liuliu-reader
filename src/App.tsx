/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Book, ReaderSettings } from './types';
import { Library } from './components/Library';
import { Reader } from './components/Reader';
import { ExcerptsView } from './components/ExcerptsView';
<<<<<<< HEAD
import { getBookById } from './db/store';
=======
import { SettingsModal } from './components/SettingsModal';
import { getBookById, getReaderSettings, saveReaderSettings } from './db/indexedDB';
>>>>>>> codex/UI-design

export default function App() {
  const [currentView, setCurrentView] = useState<'library' | 'reader' | 'excerpts' | 'settings'>('library');
  const [settingsOrigin, setSettingsOrigin] = useState<'library' | 'excerpts'>('library');
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [theme, setTheme] = useState<ReaderSettings['theme']>('claude');

  useEffect(() => {
    getReaderSettings().then((settings) => setTheme(settings.theme));
  }, []);

  const handleThemeChange = async (nextTheme: ReaderSettings['theme']) => {
    setTheme(nextTheme);
    const current = await getReaderSettings();
    await saveReaderSettings({ ...current, theme: nextTheme });
  };

  const handleOpenBook = (book: Book) => {
    setActiveBook(book);
    setCurrentView('reader');
  };

  const handleOpenSettings = (origin: 'library' | 'excerpts') => {
    setSettingsOrigin(origin);
    setCurrentView('settings');
  };

  const handleOpenBookToChapter = async (bookId: string, chapterIndex: number) => {
    const book = await getBookById(bookId);
    if (book) {
      const updatedBook: Book = {
        ...book,
        progress: {
          ...book.progress,
          chapterIndex,
          chapterTitle: book.chapters[chapterIndex]?.title || book.progress?.chapterTitle || '第一章',
          percentage: Math.min(100, Math.round(((chapterIndex + 1) / Math.max(1, book.chapters.length)) * 100)),
          lastReadTime: Date.now(),
          scrollOffset: 0,
        },
      };
      setActiveBook(updatedBook);
      setCurrentView('reader');
    }
  };

  return (
    <div id="reader-ai-root" data-theme={theme} className={theme === 'ink' ? 'min-h-screen bg-white text-[#111111]' : 'min-h-screen bg-[#f5f4ee] text-[#141413]'}>
      {currentView === 'library' && (
        <Library
          onOpenBook={handleOpenBook}
          onOpenExcerpts={() => setCurrentView('excerpts')}
          theme={theme}
          onThemeChange={handleThemeChange}
        />
      )}

      {currentView === 'reader' && activeBook && (
        <Reader
          book={activeBook}
          onBack={() => {
            setActiveBook(null);
            setCurrentView('library');
          }}
          onOpenExcerpts={() => setCurrentView('excerpts')}
          theme={theme}
          onThemeChange={handleThemeChange}
        />
      )}

      {currentView === 'excerpts' && (
        <div className={theme === 'ink' ? 'min-h-screen bg-white text-[#111111]' : 'min-h-screen bg-[#f5f4ee] text-[#141413]'}>
          <ExcerptsView
            onOpenBookToChapter={handleOpenBookToChapter}
            onBackToLibrary={() => setCurrentView('library')}
            onOpenSettings={() => handleOpenSettings('excerpts')}
            theme={theme}
          />
        </div>
      )}

      {currentView === 'settings' && (
        <SettingsModal
          onClose={() => setCurrentView(settingsOrigin)}
          theme={theme}
          onThemeChange={handleThemeChange}
        />
      )}
    </div>
  );
}

