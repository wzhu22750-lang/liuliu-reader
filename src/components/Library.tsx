import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Plus,
  Settings as SettingsIcon,
  BookMarked,
  MoreVertical,
  RotateCcw,
  Trash2,
  FileText,
  Sparkles,
  Search,
  LayoutGrid,
  List as ListIcon,
  DownloadCloud,
  CheckCircle2,
  Library as LibraryIcon,
} from 'lucide-react';
import { Book } from '../types';
import {
  getAllBooks,
  saveBook,
  deleteBook,
  hideBook,
  updateBookProgress,
  seedInitialDataIfEmpty,
} from '../db/indexedDB';
import { parseTxtContent, TxtParseResult } from '../parsers/txtParser';
import { parseEpubFile, createBookFromEpub } from '../parsers/epubParser';
import { TxtSplitPreviewModal } from './TxtSplitPreviewModal';
import { TomatoImportModal } from './TomatoImportModal';
import { SettingsModal } from './SettingsModal';

interface Props {
  onOpenBook: (book: Book) => void;
  onOpenExcerpts: () => void;
}

export const Library: React.FC<Props> = ({ onOpenBook, onOpenExcerpts }) => {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Modals
  const [showImportMenu, setShowImportMenu] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showTomatoModal, setShowTomatoModal] = useState<boolean>(false);
  const [txtModalData, setTxtModalData] = useState<{
    rawText: string;
    fileName: string;
    initialResult: TxtParseResult;
  } | null>(null);

  // Active book action menu popup
  const [activeMenuBookId, setActiveMenuBookId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const loadBooks = async () => {
    setLoading(true);
    await seedInitialDataIfEmpty();
    const list = await getAllBooks();
    setBooks(list);
    setLoading(false);
  };

  useEffect(() => {
    loadBooks();
  }, []);

  // Handle TXT File Input
  const handleTxtFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const rawText = ev.target?.result as string;
      const initial = parseTxtContent(rawText, file.name);
      setTxtModalData({
        rawText,
        fileName: file.name,
        initialResult: initial,
      });
      setShowImportMenu(false);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Confirm TXT Import
  const handleConfirmTxtImport = async (
    result: TxtParseResult,
    customTitle: string,
    customAuthor: string
  ) => {
    const newBook: Book = {
      id: `book_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: customTitle || result.title,
      author: customAuthor || result.author,
      sourceType: 'txt',
      totalChapters: result.chapters.length,
      chapters: result.chapters,
      progress: {
        chapterIndex: 0,
        chapterTitle: result.chapters[0]?.title || '第一章',
        percentage: 0,
        lastReadTime: Date.now(),
        scrollOffset: 0,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveBook(newBook);
    setTxtModalData(null);
    await loadBooks();
    showToast(`《${newBook.title}》已导入书架`);
  };

  // Handle EPUB File Input
  const handleEpubFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setShowImportMenu(false);
    try {
      showToast('正在解析 EPUB 电子书...');
      const arrayBuffer = await file.arrayBuffer();
      const parseResult = await parseEpubFile(arrayBuffer, file.name);
      const newBook = createBookFromEpub(parseResult);
      await saveBook(newBook);
      await loadBooks();
      showToast(`《${newBook.title}》已成功入库`);
    } catch (err: any) {
      alert('EPUB 解析失败：' + err.message);
    }
    e.target.value = '';
  };

  // Reset Book Progress to Start
  const handleResetProgress = async (book: Book) => {
    await updateBookProgress(
      book.id,
      0,
      book.chapters[0]?.title || '第一章',
      0,
      0
    );
    setActiveMenuBookId(null);
    await loadBooks();
    showToast(`《${book.title}》已重置阅读进度`);
  };

  // Delete Book completely (Excerpts remain permanent!)
  const handleDeleteBook = async (book: Book) => {
    if (
      confirm(
        `确定要彻底删除《${book.title}》吗？\n\n注意：您在此书中的所有独立摘抄本资产将永久保留，不受影响。`
      )
    ) {
      await deleteBook(book.id);
      setActiveMenuBookId(null);
      await loadBooks();
      showToast(`《${book.title}》已从书库彻底删除（摘抄已永久保留）`);
    }
  };

  const filteredBooks = books.filter(
    (b) =>
      b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.author.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Milk-white Minimalist Cover Theme helper
  const getCoverTheme = (id: string) => {
    const themes = [
      {
        bg: 'from-[#fdfcfa] to-[#f5f1e8]',
        border: 'border-[#e8e2d6]',
        spine: 'border-l-[#da7756]',
        innerBorder: 'border-[#ebe5d9]',
        tagBg: 'bg-[#eee8dd] text-stone-600 border-[#ded7cb]',
      },
      {
        bg: 'from-[#faf9f6] to-[#f2ece2]',
        border: 'border-[#e4ded2]',
        spine: 'border-l-[#c97d5d]',
        innerBorder: 'border-[#e8e1d4]',
        tagBg: 'bg-[#eae3d6] text-stone-600 border-[#dbd3c5]',
      },
      {
        bg: 'from-[#fcfbfa] to-[#f4efe5]',
        border: 'border-[#e6dfd3]',
        spine: 'border-l-[#b07d62]',
        innerBorder: 'border-[#eae3d6]',
        tagBg: 'bg-[#ebe5d9] text-stone-600 border-[#ddd6c8]',
      },
      {
        bg: 'from-[#f9f8f4] to-[#ece5d9]',
        border: 'border-[#e2dcce]',
        spine: 'border-l-[#da7756]',
        innerBorder: 'border-[#e4dcce]',
        tagBg: 'bg-[#e7dfd1] text-stone-600 border-[#d8cfbf]',
      },
    ];
    let sum = 0;
    for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
    return themes[sum % themes.length];
  };

  return (
    <div className="min-h-screen bg-[#f5f4ee] text-[#141413] transition-colors duration-200">
      {/* Toast */}
      {toastMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-[#141413] text-[#f5f4ee] rounded-full text-xs shadow-lg backdrop-blur-xs flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-150">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#da7756]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-20 bg-[#f5f4ee]/95 backdrop-blur-md border-b border-[#e8e6df]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Logo & Tab Switcher */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2.5 select-none">
              <div className="w-8 h-8 rounded-xl bg-[#da7756] text-white flex items-center justify-center shadow-xs font-serif font-bold text-sm">
                溜
              </div>
              <span className="font-bold tracking-tight text-base sm:text-lg text-[#141413] font-serif">
                溜溜读书
              </span>
            </div>

            {/* Navigation Tabs */}
            <div className="hidden sm:flex items-center gap-1 bg-[#e8e6df]/70 p-1 rounded-xl text-xs font-medium">
              <button
                type="button"
                className="px-3.5 py-1.5 rounded-lg bg-white text-[#141413] shadow-xs flex items-center gap-1.5"
              >
                <LibraryIcon className="w-3.5 h-3.5 text-[#da7756]" />
                <span>书架 ({books.length})</span>
              </button>

              <button
                type="button"
                onClick={onOpenExcerpts}
                className="px-3.5 py-1.5 rounded-lg text-stone-600 hover:text-[#141413] transition flex items-center gap-1.5"
              >
                <BookMarked className="w-3.5 h-3.5 text-[#da7756]" />
                <span>摘抄本</span>
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {/* Mobile Excerpts Button */}
            <button
              type="button"
              onClick={onOpenExcerpts}
              className="sm:hidden p-2 rounded-xl bg-stone-200/60 text-[#141413]"
              title="摘抄本"
            >
              <BookMarked className="w-4 h-4 text-[#da7756]" />
            </button>

            {/* Import Dropdown Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowImportMenu(!showImportMenu)}
                className="px-3.5 py-2 rounded-xl bg-[#da7756] hover:bg-[#c86341] text-white text-xs font-medium shadow-xs transition flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>导入书籍</span>
              </button>

              {/* Import Menu Popup */}
              {showImportMenu && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setShowImportMenu(false)}
                  />
                  <div className="absolute right-0 mt-2 z-30 w-56 bg-white rounded-2xl shadow-xl border border-[#e8e6df] py-1.5 text-xs font-medium text-[#141413] animate-in fade-in zoom-in-95">
                    {/* TXT File */}
                    <label className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-[#f5f4ee] cursor-pointer transition">
                      <FileText className="w-4 h-4 text-[#da7756]" />
                      <div>
                        <div className="font-semibold">本地 TXT 电子书</div>
                        <div className="text-[10px] text-stone-500">智能目录拆分与章节预览</div>
                      </div>
                      <input
                        type="file"
                        accept=".txt,text/plain"
                        onChange={handleTxtFileUpload}
                        className="hidden"
                      />
                    </label>

                    {/* EPUB File */}
                    <label className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-[#f5f4ee] cursor-pointer transition">
                      <BookOpen className="w-4 h-4 text-emerald-700" />
                      <div>
                        <div className="font-semibold">本地 EPUB 电子书</div>
                        <div className="text-[10px] text-stone-500">纯净正文提取与目录结构</div>
                      </div>
                      <input
                        type="file"
                        accept=".epub,application/epub+zip"
                        onChange={handleEpubFileUpload}
                        className="hidden"
                      />
                    </label>

                    {/* Tomato Link */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowImportMenu(false);
                        setShowTomatoModal(true);
                      }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-[#f5f4ee] text-left transition"
                    >
                      <Sparkles className="w-4 h-4 text-[#da7756]" />
                      <div>
                        <div className="font-semibold">番茄 / 网络小说链接</div>
                        <div className="text-[10px] text-stone-500">支持流式边下边读</div>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Settings */}
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-xl text-stone-700 hover:bg-[#e8e6df]/70 transition"
              title="设置与数据中心"
            >
              <SettingsIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Library Main Body */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Search & Layout Toggle Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-stone-400" />
            <input
              type="text"
              placeholder="搜索书名或作者..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-[#e8e6df] bg-white focus:outline-hidden focus:ring-2 focus:ring-[#da7756]/40 text-[#141413]"
            />
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-3 text-xs text-stone-500">
            <span>共 {filteredBooks.length} 本书</span>

            <div className="flex items-center bg-[#e8e6df]/70 p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md transition ${
                  viewMode === 'grid'
                    ? 'bg-white text-[#141413] shadow-xs'
                    : 'text-stone-500'
                }`}
                title="网格视图"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-md transition ${
                  viewMode === 'list'
                    ? 'bg-white text-[#141413] shadow-xs'
                    : 'text-stone-500'
                }`}
                title="列表视图"
              >
                <ListIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Books List / Grid */}
        {loading ? (
          <div className="py-20 text-center text-xs text-stone-400 animate-pulse font-mono">
            正在载入本地书库...
          </div>
        ) : filteredBooks.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-center space-y-3 bg-white/60 rounded-3xl border border-dashed border-[#e8e6df]">
            <div className="p-4 rounded-2xl bg-[#da7756]/10 text-[#da7756]">
              <BookOpen className="w-8 h-8 opacity-75" />
            </div>
            <p className="text-sm font-semibold text-[#141413]">
              {searchQuery ? '未找到匹配的书籍' : '书架空空如也'}
            </p>
            <p className="text-xs text-stone-500 max-w-sm">
              点击右上角「导入书籍」导入本地 TXT / EPUB 文件，或粘贴网络小说链接开始阅读。
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
            {filteredBooks.map((book) => {
              const progress = book.progress?.percentage || 0;
              const chapterTitle = book.progress?.chapterTitle || '未开始';
              const coverTheme = getCoverTheme(book.id);

              return (
                <div
                  key={book.id}
                  onClick={() => onOpenBook(book)}
                  className="group relative flex flex-col cursor-pointer select-none"
                >
                  {/* Book Typographic Milk-White Minimalist Cover */}
                  <div
                    className={`aspect-[3/4.2] rounded-2xl bg-gradient-to-b ${coverTheme.bg} ${coverTheme.border} ${coverTheme.spine} border border-l-4 p-3.5 flex flex-col justify-between shadow-[0_4px_16px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_24px_rgba(218,119,86,0.12),0_2px_6px_rgba(0,0,0,0.04)] transition-all duration-200 group-hover:-translate-y-1 relative overflow-hidden`}
                  >
                    {/* Top Tag & Action */}
                    <div className="flex items-center justify-between z-10">
                      <span className={`text-[9px] uppercase font-mono tracking-widest px-2 py-0.5 rounded-sm border ${coverTheme.tagBg}`}>
                        {book.sourceType}
                      </span>

                      {/* Action Menu Trigger */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuBookId(
                            activeMenuBookId === book.id ? null : book.id
                          );
                        }}
                        className="p-1 rounded-lg text-stone-400 hover:text-[#141413] hover:bg-stone-200/50 transition"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Action Popup */}
                    {activeMenuBookId === book.id && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute top-10 right-2 z-30 w-44 bg-white rounded-xl shadow-2xl border border-[#e8e6df] py-1 text-xs text-[#141413] animate-in fade-in zoom-in-95 font-sans"
                      >
                        <button
                          type="button"
                          onClick={() => handleResetProgress(book)}
                          className="w-full text-left px-3 py-2 hover:bg-[#f5f4ee] flex items-center gap-2"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-stone-500" />
                          <span>从头开始阅读</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteBook(book)}
                          className="w-full text-left px-3 py-2 hover:bg-[#f5f4ee] text-[#ff5f38] flex items-center gap-2 font-medium"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>彻底删除书籍</span>
                        </button>
                      </div>
                    )}

                    {/* Center Title & Author Card Frame */}
                    <div className={`my-auto py-3 px-2 text-center rounded-xl border ${coverTheme.innerBorder} bg-white/40 backdrop-blur-[1px] space-y-1.5`}>
                      <h3 className="font-serif font-bold text-sm sm:text-base leading-snug text-[#141413] line-clamp-3 tracking-wide">
                        {book.title}
                      </h3>
                      <div className="w-1.5 h-1.5 rounded-full bg-[#da7756] mx-auto opacity-75" />
                      <p className="text-[11px] font-sans text-stone-500 truncate tracking-wider">
                        {book.author}
                      </p>
                    </div>

                    {/* Bottom Progress Bar */}
                    <div className="space-y-1.5 z-10">
                      <div className="flex justify-between text-[10px] font-mono text-stone-500">
                        <span className="truncate pr-2">{chapterTitle}</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="w-full h-1 bg-stone-200/80 rounded-full overflow-hidden">
                        <div
                          className="bg-[#da7756] h-full rounded-full transition-all duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Title text under cover for clarity */}
                  <div className="mt-2 space-y-0.5 font-sans">
                    <div className="text-xs font-semibold text-[#141413] truncate font-serif">
                      {book.title}
                    </div>
                    <div className="text-[11px] text-stone-500 truncate font-mono">
                      {book.chapters.length} 章节 · {Math.round(book.totalWords / 10000 * 10) / 10} 万字
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List View */
          <div className="space-y-2 font-sans">
            {filteredBooks.map((book) => {
              const progress = book.progress?.percentage || 0;
              const chapterTitle = book.progress?.chapterTitle || '未开始';
              const coverTheme = getCoverTheme(book.id);

              return (
                <div
                  key={book.id}
                  onClick={() => onOpenBook(book)}
                  className="p-3.5 sm:p-4 rounded-2xl bg-white border border-[#e8e6df] shadow-xs hover:shadow-md transition flex items-center justify-between gap-4 cursor-pointer"
                >
                  <div className="flex items-center gap-3.5 truncate">
                    <div
                      className={`w-10 h-14 rounded-lg bg-gradient-to-b ${coverTheme.bg} ${coverTheme.border} ${coverTheme.spine} border border-l-2 flex items-center justify-center text-[#141413] font-serif font-bold text-xs shrink-0 shadow-2xs`}
                    >
                      {book.title[0]}
                    </div>
                    <div className="space-y-1 truncate">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-xs sm:text-sm text-[#141413] truncate font-serif">
                          {book.title}
                        </h3>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[#f5f4ee] text-stone-600 uppercase border border-[#e8e6df]">
                          {book.sourceType}
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-500 truncate">
                        {book.author} · {book.chapters.length} 章 · 当前：{chapterTitle}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right hidden sm:block">
                      <div className="text-xs font-semibold text-[#141413]">
                        {progress}%
                      </div>
                      <div className="w-16 h-1 bg-stone-200 rounded-full mt-1 overflow-hidden">
                        <div
                          className="bg-[#da7756] h-full rounded-full"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteBook(book);
                      }}
                      className="p-2 text-stone-400 hover:text-[#ff5f38] rounded-lg hover:bg-[#f5f4ee] transition"
                      title="彻底删除书籍"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* TXT Split Preview Modal */}
      {txtModalData && (
        <TxtSplitPreviewModal
          rawText={txtModalData.rawText}
          fileName={txtModalData.fileName}
          initialResult={txtModalData.initialResult}
          onConfirm={handleConfirmTxtImport}
          onCancel={() => setTxtModalData(null)}
        />
      )}

      {/* Tomato Import Modal */}
      {showTomatoModal && (
        <TomatoImportModal
          onSuccess={(book, openDirectly) => {
            setShowTomatoModal(false);
            loadBooks();
            if (openDirectly) {
              onOpenBook(book);
            }
          }}
          onClose={() => {
            setShowTomatoModal(false);
            loadBooks();
          }}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onSettingsUpdated={() => loadBooks()}
        />
      )}
    </div>
  );
};
