/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Book } from './types';
import { Library } from './components/Library';
import { Reader } from './components/Reader';
import { ExcerptsView } from './components/ExcerptsView';
import { getBookById } from './db/store';

export default function App() {
  const [currentView, setCurrentView] = useState<'library' | 'reader' | 'excerpts'>('library');
  const [activeBook, setActiveBook] = useState<Book | null>(null);

  const handleOpenBook = (book: Book) => {
    setActiveBook(book);
    setCurrentView('reader');
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
    <div id="reader-ai-root" className="min-h-screen bg-[#f5f4ee] text-[#141413]">
      {currentView === 'library' && (
        <Library
          onOpenBook={handleOpenBook}
          onOpenExcerpts={() => setCurrentView('excerpts')}
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
        />
      )}

      {currentView === 'excerpts' && (
        <div className="min-h-screen bg-[#f5f4ee] text-[#141413]">
          <ExcerptsView
            onOpenBookToChapter={handleOpenBookToChapter}
            onBackToLibrary={() => setCurrentView('library')}
          />
        </div>
      )}
    </div>
  );
}

