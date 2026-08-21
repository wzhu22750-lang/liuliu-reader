import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Search,
  List,
  Bookmark as BookmarkIcon,
  BookmarkCheck,
  Settings2,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Coffee,
  Sparkles,
  Highlighter,
  X,
  RotateCcw,
  Check,
} from 'lucide-react';
import {
  Book,
  Chapter,
  Highlight,
  HighlightStyle,
  Bookmark,
  Excerpt,
  ReaderSettings,
} from '../types';
import {
  updateBookProgress,
  getHighlightsByBook,
  addHighlight,
  deleteHighlight,
  getBookmarksByBook,
  addBookmark,
  deleteBookmark,
  addExcerpt,
  getReaderSettings,
  saveReaderSettings,
} from '../db/indexedDB';
import { TextSelectionMenu, HIGHLIGHT_PALETTE } from './TextSelectionMenu';
import { AISheet } from './AISheet';

interface Props {
  book: Book;
  onBack: () => void;
  onOpenExcerpts: () => void;
  theme?: ReaderSettings['theme'];
  onThemeChange?: (theme: ReaderSettings['theme']) => void | Promise<void>;
}

export const Reader: React.FC<Props> = ({ book, onBack, onOpenExcerpts, theme, onThemeChange }) => {
  const [currentChapterIndex, setCurrentChapterIndex] = useState<number>(
    book.progress?.chapterIndex || 0
  );
  const [showControls, setShowControls] = useState<boolean>(true);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [settings, setSettings] = useState<ReaderSettings>({
    fontSize: 18,
    lineHeight: 1.8,
    theme: 'light',
    renderMode: 'scroll',
    spoilerScope: 'current',
    lastHighlightStyle: 'amber',
    autoSnapSentence: true,
  });

  // UI Modals
  const [showTOC, setShowTOC] = useState<boolean>(false);
  const [tocActiveTab, setTocActiveTab] = useState<'chapters' | 'bookmarks' | 'highlights'>('chapters');
  const [showSearch, setShowSearch] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<
    Array<{ chapterIndex: number; chapterTitle: string; snippet: string; matchIndex: number }>
  >([]);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState<boolean>(false);

  // Selection & Action Bar
  const [selectionMenuPos, setSelectionMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedText, setSelectedText] = useState<string>('');
  const [selectionContext, setSelectionContext] = useState<{
    preceding: string;
    following: string;
    startOffset: number;
    endOffset: number;
  }>({ preceding: '', following: '', startOffset: 0, endOffset: 0 });

  // AI Sheet
  const [showAISheet, setShowAISheet] = useState<boolean>(false);

  // Toast notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Load initial settings and knowledge assets
  useEffect(() => {
    Promise.all([
      getReaderSettings(),
      getHighlightsByBook(book.id),
      getBookmarksByBook(book.id),
    ]).then(([st, hls, bms]) => {
      if (st) setSettings(st);
      setHighlights(hls);
      setBookmarks(bms);
    });
  }, [book.id]);

  useEffect(() => {
    if (theme && settings.theme !== theme) {
      setSettings((current) => ({ ...current, theme }));
    }
  }, [theme]);

  // Current Chapter
  const currentChapter: Chapter | undefined =
    book.chapters[currentChapterIndex] || book.chapters[0] || undefined;

  // Calculate overall book progress percentage
  const totalChapters = Math.max(1, book.chapters.length);
  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round(((currentChapterIndex + 1) / totalChapters) * 100))
  );

  // Update progress in database whenever chapter changes
  useEffect(() => {
    if (currentChapter) {
      updateBookProgress(
        book.id,
        currentChapterIndex,
        currentChapter.title,
        progressPercent,
        containerRef.current?.scrollTop || 0
      );
    }
  }, [book.id, currentChapterIndex, currentChapter, progressPercent]);

  // Scroll to top when changing chapter in scroll mode
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentChapterIndex]);

  // Handle Text Selection & Smart Sentence Snapping
  const handleMouseUpOrTouchEnd = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setSelectionMenuPos(null);
      return;
    }

    let rawText = selection.toString().trim();
    if (!rawText || rawText.length < 1) {
      setSelectionMenuPos(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Context extraction
    const fullChapterText = currentChapter?.content || '';
    let startIdx = fullChapterText.indexOf(rawText);
    if (startIdx === -1) startIdx = 0;
    const endIdx = startIdx + rawText.length;

    // Smart snap sentence if enabled (expand to punctuation boundary)
    if (settings.autoSnapSentence && rawText.length < 150) {
      const sentenceEnders = /[。！？!?…\n]/;
      let expandedStart = startIdx;
      while (expandedStart > 0 && !sentenceEnders.test(fullChapterText[expandedStart - 1])) {
        expandedStart--;
      }
      let expandedEnd = endIdx;
      while (expandedEnd < fullChapterText.length && !sentenceEnders.test(fullChapterText[expandedEnd])) {
        expandedEnd++;
      }
      if (expandedEnd < fullChapterText.length && sentenceEnders.test(fullChapterText[expandedEnd])) {
        expandedEnd++;
      }

      const snapped = fullChapterText.slice(expandedStart, expandedEnd).trim();
      if (snapped.length > rawText.length && snapped.length < 200) {
        rawText = snapped;
        startIdx = expandedStart;
      }
    }

    const preceding = fullChapterText.slice(Math.max(0, startIdx - 500), startIdx);
    const following = fullChapterText.slice(endIdx, Math.min(fullChapterText.length, endIdx + 500));

    setSelectedText(rawText);
    setSelectionContext({
      preceding,
      following,
      startOffset: startIdx,
      endOffset: startIdx + rawText.length,
    });

    setSelectionMenuPos({
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  };

  // Actions from selection menu
  const handleCopy = () => {
    navigator.clipboard.writeText(selectedText);
    showToast('已复制到剪贴板');
    setSelectionMenuPos(null);
  };

  const handleExcerpt = async () => {
    if (!currentChapter) return;
    const item: Excerpt = {
      id: `exc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      bookId: book.id,
      bookTitle: book.title,
      chapterTitle: currentChapter.title,
      chapterIndex: currentChapterIndex,
      text: selectedText,
      createdAt: Date.now(),
    };
    await addExcerpt(item);
    showToast('已存入独立摘抄本');
    setSelectionMenuPos(null);
  };

  const handleHighlight = async (style: HighlightStyle) => {
    if (!currentChapter) return;
    const newHl: Highlight = {
      id: `hl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      bookId: book.id,
      chapterIndex: currentChapterIndex,
      chapterTitle: currentChapter.title,
      text: selectedText,
      startOffset: selectionContext.startOffset,
      endOffset: selectionContext.endOffset,
      style,
      createdAt: Date.now(),
    };

    await addHighlight(newHl);
    setHighlights((prev) => [...prev, newHl]);

    // Remember last highlight style
    const newSettings: ReaderSettings = { ...settings, lastHighlightStyle: style };
    setSettings(newSettings);
    await saveReaderSettings(newSettings);

    showToast('已添加高亮');
    setSelectionMenuPos(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleAIExplain = () => {
    setShowAISheet(true);
    setSelectionMenuPos(null);
  };

  const handleToggleBookmark = async () => {
    if (!currentChapter) return;
    const existing = bookmarks.find((b) => b.chapterIndex === currentChapterIndex);
    if (existing) {
      await deleteBookmark(existing.id);
      setBookmarks((prev) => prev.filter((b) => b.id !== existing.id));
      showToast('已移除本章书签');
    } else {
      const snippet = (currentChapter.content || '').slice(0, 40).replace(/\n+/g, ' ');
      const newBm: Bookmark = {
        id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        bookId: book.id,
        chapterIndex: currentChapterIndex,
        chapterTitle: currentChapter.title,
        snippet,
        percentage: progressPercent,
        createdAt: Date.now(),
      };
      await addBookmark(newBm);
      setBookmarks((prev) => [newBm, ...prev]);
      showToast('已添加书签');
    }
  };

  // Search inside book
  const handlePerformSearch = (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    const q = query.trim().toLowerCase();
    const results: Array<{
      chapterIndex: number;
      chapterTitle: string;
      snippet: string;
      matchIndex: number;
    }> = [];

    book.chapters.forEach((ch) => {
      const content = ch.content || '';
      const lower = content.toLowerCase();
      let pos = lower.indexOf(q);
      let count = 0;
      while (pos !== -1 && count < 5) {
        const start = Math.max(0, pos - 25);
        const end = Math.min(content.length, pos + q.length + 35);
        const snippet = content.slice(start, end).replace(/\n+/g, ' ');
        results.push({
          chapterIndex: ch.index,
          chapterTitle: ch.title,
          snippet: (start > 0 ? '...' : '') + snippet + (end < content.length ? '...' : ''),
          matchIndex: pos,
        });
        pos = lower.indexOf(q, pos + q.length);
        count++;
      }
    });

    setSearchResults(results);
  };

  // Reset to chapter 0 ("从头阅读")
  const handleReadFromStart = async () => {
    if (confirm('确定要从头开始阅读吗？历史高亮与摘抄将完整保留。')) {
      setCurrentChapterIndex(0);
      await updateBookProgress(book.id, 0, book.chapters[0]?.title || '', 0, 0);
      showToast('已重置阅读进度至第一章');
    }
  };

  // Themes
  const themeClasses: Record<string, { bg: string; text: string; header: string }> = {
    light: {
      bg: 'bg-[#f5f4ee]',
      text: 'text-[#141413]',
      header: 'bg-[#f5f4ee]/95 border-[#e8e6df]',
    },
    sepia: {
      bg: 'bg-[#f0ebe1]',
      text: 'text-[#2d2926]',
      header: 'bg-[#f0ebe1]/95 border-[#ded5c5]',
    },
    dark: {
      bg: 'bg-[#1a1a19]',
      text: 'text-[#d4d4d0]',
      header: 'bg-[#1a1a19]/95 border-[#2e2e2c]',
    },
    night: {
      bg: 'bg-[#10100f]',
      text: 'text-[#a3a29e]',
      header: 'bg-[#10100f]/95 border-[#222220]',
    },
    ink: {
      bg: 'bg-white',
      text: 'text-[#111111]',
      header: 'bg-white border-[#d5d5d0]',
    },
  };

  const currentTheme = themeClasses[settings.theme] || themeClasses.light;
  const isBookmarkedCurrent = bookmarks.some((b) => b.chapterIndex === currentChapterIndex);

  // Render paragraphs with highlight styling
  const chapterHighlights = highlights.filter((h) => h.chapterIndex === currentChapterIndex);

  const renderParagraphsWithHighlights = (content: string) => {
    const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);

    return paragraphs.map((pText, pIdx) => {
      // Check if any highlight overlaps with this paragraph
      let renderedElements: React.ReactNode = pText;

      const matchingHl = chapterHighlights.find((h) => pText.includes(h.text));
      if (matchingHl) {
        const parts = pText.split(matchingHl.text);
        let hlStyleClass = 'bg-[#da7756]/20 text-[#141413] rounded px-0.5';
        if (matchingHl.style === 'emerald') hlStyleClass = 'bg-emerald-200/60 text-emerald-950 rounded px-0.5';
        if (matchingHl.style === 'rose') hlStyleClass = 'bg-rose-200/60 text-rose-950 rounded px-0.5';
        if (matchingHl.style === 'sky') hlStyleClass = 'bg-sky-200/60 text-sky-950 rounded px-0.5';
        if (matchingHl.style === 'purple') hlStyleClass = 'bg-purple-200/60 text-purple-950 rounded px-0.5';
        if (matchingHl.style === 'underline') hlStyleClass = 'underline decoration-2 decoration-[#da7756] underline-offset-4';
        if (matchingHl.style === 'wavy') hlStyleClass = 'underline decoration-wavy decoration-[#cc7d5e] underline-offset-4';

        renderedElements = (
          <span>
            {parts[0]}
            <mark className={`${hlStyleClass} cursor-pointer inline transition hover:opacity-80`}>
              {matchingHl.text}
            </mark>
            {parts.slice(1).join(matchingHl.text)}
          </span>
        );
      }

      return (
        <p
          key={pIdx}
          className="text-justify indent-8 tracking-normal select-text mb-4 transition-all duration-150"
          style={{
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineHeight,
          }}
        >
          {renderedElements}
        </p>
      );
    });
  };

  return (
    <div
      data-reader-theme={settings.theme}
      className={`fixed inset-0 z-30 flex flex-col ${currentTheme.bg} ${currentTheme.text} select-none transition-colors duration-200 overflow-hidden font-serif ${settings.theme === 'ink' ? 'ink-reader' : ''}`}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-[#141413] text-[#f5f4ee] rounded-full text-xs shadow-lg backdrop-blur-xs flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-150 font-sans">
          <Check className="w-3.5 h-3.5 text-[#da7756]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header Toolbar */}
      <div
        className={`fixed top-0 left-0 right-0 z-40 px-4 py-2.5 flex items-center justify-between border-b backdrop-blur-md transition-transform duration-200 font-sans ${
          currentTheme.header
        } ${showControls ? 'translate-y-0' : '-translate-y-full'}`}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition"
            title="返回书架"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="max-w-[180px] sm:max-w-xs truncate">
            <h1 className="text-xs font-semibold truncate leading-tight">{book.title}</h1>
            <p className="text-[10px] opacity-70 truncate">{currentChapter?.title}</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* In-Book Search */}
          <button
            type="button"
            onClick={() => setShowSearch(true)}
            className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition"
            title="全文搜索"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Table of Contents */}
          <button
            type="button"
            onClick={() => setShowTOC(true)}
            className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition"
            title="目录与高亮"
          >
            <List className="w-4 h-4" />
          </button>

          {/* Toggle Bookmark */}
          <button
            type="button"
            onClick={handleToggleBookmark}
            className={`p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition ${
              isBookmarkedCurrent ? 'text-[#da7756]' : ''
            }`}
            title={isBookmarkedCurrent ? '移除书签' : '添加书签'}
          >
            {isBookmarkedCurrent ? (
              <BookmarkCheck className="w-4 h-4" />
            ) : (
              <BookmarkIcon className="w-4 h-4" />
            )}
          </button>

          {/* Reader Settings */}
          <button
            type="button"
            onClick={() => setShowSettingsDrawer(!showSettingsDrawer)}
            className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition"
            title="阅读设置"
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Reading Canvas */}
      <div
        ref={containerRef}
        onMouseUp={handleMouseUpOrTouchEnd}
        onTouchEnd={handleMouseUpOrTouchEnd}
        className="ink-reader-content flex-1 overflow-y-auto px-5 sm:px-12 md:px-24 py-16 max-w-3xl mx-auto w-full scroll-smooth"
        onClick={(e) => {
          // Tap center 50% width & height toggles controls
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return;
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const isCenter =
            x > rect.width * 0.25 &&
            x < rect.width * 0.75 &&
            y > rect.height * 0.25 &&
            y < rect.height * 0.75;
          if (isCenter && !window.getSelection()?.toString().trim()) {
            setShowControls(!showControls);
            setShowSettingsDrawer(false);
          }
        }}
      >
        <div ref={contentRef} className="space-y-6 pt-4 pb-20">
          {/* Chapter Title Header */}
          <div className="ink-reader-title text-center py-6 border-b border-black/5 dark:border-white/5 space-y-2">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
              {currentChapter?.title}
            </h2>
            <p className="text-xs opacity-50 font-sans">
              字数：{currentChapter?.wordCount} 字 · 进度：{progressPercent}%
            </p>
          </div>

          {/* Chapter Paragraphs */}
          <div className="ink-reader-body pt-4 leading-relaxed font-serif">
            {currentChapter?.content ? (
              renderParagraphsWithHighlights(currentChapter.content)
            ) : currentChapter ? (
              <div className="py-20 text-center text-sm opacity-60">章节暂无内容</div>
            ) : (
              <div className="py-20 text-center text-sm opacity-60">本书暂无章节</div>
            )}
          </div>

          {/* Chapter End & Navigation */}
          <div className="pt-12 pb-6 flex items-center justify-between border-t border-black/5 dark:border-white/5 font-sans text-xs">
            <button
              type="button"
              disabled={currentChapterIndex <= 0}
              onClick={() => setCurrentChapterIndex((prev) => Math.max(0, prev - 1))}
              className="px-4 py-2 rounded-xl bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-30 transition flex items-center gap-1.5"
            >
              <ChevronLeft className="w-4 h-4" />
              上一章
            </button>

            <span className="opacity-60 text-[11px]">
              {currentChapterIndex + 1} / {totalChapters} 章
            </span>

            <button
              type="button"
              disabled={currentChapterIndex >= totalChapters - 1}
              onClick={() =>
                setCurrentChapterIndex((prev) => Math.min(totalChapters - 1, prev + 1))
              }
              className="px-4 py-2 rounded-xl bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-30 transition flex items-center gap-1.5"
            >
              下一章
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Floating Selection Action Bar */}
      {selectionMenuPos && selectedText && (
        <TextSelectionMenu
          position={selectionMenuPos}
          selectedText={selectedText}
          lastHighlightStyle={settings.lastHighlightStyle}
          onCopy={handleCopy}
          onExcerpt={handleExcerpt}
          onHighlight={handleHighlight}
          onAIExplain={handleAIExplain}
          onClose={() => setSelectionMenuPos(null)}
        />
      )}

      {/* Bottom Status Bar */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-40 px-6 py-2.5 flex items-center justify-between border-t backdrop-blur-md transition-transform duration-200 font-sans text-xs ${
          currentTheme.header
        } ${showControls ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex items-center gap-2 truncate">
          <span className="font-medium truncate">{currentChapter?.title}</span>
          <span className="opacity-50">·</span>
          <span className="opacity-70">{progressPercent}%</span>
        </div>

        {/* Quick Slider */}
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={totalChapters - 1}
            value={currentChapterIndex}
            onChange={(e) => setCurrentChapterIndex(parseInt(e.target.value, 10))}
            className="w-24 sm:w-36 h-1.5 bg-black/10 dark:bg-white/20 rounded-lg appearance-none cursor-pointer accent-[#da7756]"
          />
        </div>
      </div>

      {/* Quick Settings Drawer */}
      {showSettingsDrawer && (
        <div className="fixed bottom-14 right-4 z-50 bg-white dark:bg-stone-900 rounded-2xl shadow-2xl border border-[#e8e6df] dark:border-stone-800 p-4 w-72 space-y-4 font-sans text-[#141413] dark:text-stone-200 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-2 border-b border-[#e8e6df] dark:border-stone-800">
            <span className="text-xs font-semibold">排版与主题设置</span>
            <button
              onClick={() => setShowSettingsDrawer(false)}
              className="p-1 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Theme Selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-stone-500 font-medium">阅读主题</label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
              {[
                { id: 'light', name: '素雅', bg: 'bg-[#f5f4ee]', border: 'border-[#e8e6df]' },
                { id: 'sepia', name: '竹简', bg: 'bg-[#f0ebe1]', border: 'border-[#ded5c5]' },
                { id: 'dark', name: '水墨', bg: 'bg-[#1a1a19]', border: 'border-stone-700' },
                { id: 'night', name: '夜读', bg: 'bg-[#10100f]', border: 'border-stone-800' },
                { id: 'ink', name: 'E-Ink', bg: 'bg-white', border: 'border-[#d5d5d0]' },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={async () => {
                    const newSt = { ...settings, theme: t.id as ReaderSettings['theme'] };
                    setSettings(newSt);
                    await saveReaderSettings(newSt);
                    await onThemeChange?.(newSt.theme);
                  }}
                  className={`py-1.5 rounded-xl border text-[11px] font-medium transition ${t.bg} ${
                    settings.theme === t.id ? 'ring-2 ring-[#da7756]' : ''
                  } ${t.id === 'dark' || t.id === 'night' ? 'text-white' : 'text-[#141413]'}`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          {/* Font Size */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] text-stone-500 font-medium">
              <span>字号大小</span>
              <span>{settings.fontSize} px</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  const size = Math.max(14, settings.fontSize - 1);
                  const newSt = { ...settings, fontSize: size };
                  setSettings(newSt);
                  await saveReaderSettings(newSt);
                }}
                className="px-2.5 py-1 text-xs bg-stone-100 dark:bg-stone-800 rounded-lg hover:bg-stone-200 dark:hover:bg-stone-700"
              >
                A-
              </button>
              <input
                type="range"
                min={14}
                max={28}
                value={settings.fontSize}
                onChange={async (e) => {
                  const size = parseInt(e.target.value, 10);
                  const newSt = { ...settings, fontSize: size };
                  setSettings(newSt);
                  await saveReaderSettings(newSt);
                }}
                className="flex-1 h-1.5 bg-stone-200 dark:bg-stone-700 rounded-lg appearance-none cursor-pointer accent-[#da7756]"
              />
              <button
                type="button"
                onClick={async () => {
                  const size = Math.min(28, settings.fontSize + 1);
                  const newSt = { ...settings, fontSize: size };
                  setSettings(newSt);
                  await saveReaderSettings(newSt);
                }}
                className="px-2.5 py-1 text-xs bg-stone-100 dark:bg-stone-800 rounded-lg hover:bg-stone-200 dark:hover:bg-stone-700"
              >
                A+
              </button>
            </div>
          </div>

          {/* Line Height */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] text-stone-500 font-medium">
              <span>行距调节</span>
              <span>{settings.lineHeight} 倍</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {[1.5, 1.8, 2.2].map((lh) => (
                <button
                  key={lh}
                  onClick={async () => {
                    const newSt = { ...settings, lineHeight: lh };
                    setSettings(newSt);
                    await saveReaderSettings(newSt);
                  }}
                  className={`py-1 text-xs rounded-lg transition ${
                    settings.lineHeight === lh
                      ? 'bg-[#da7756] text-white font-medium'
                      : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300'
                  }`}
                >
                  {lh === 1.5 ? '紧凑' : lh === 1.8 ? '适中' : '宽松'}
                </button>
              ))}
            </div>
          </div>

          {/* Read from Start */}
          <div className="pt-2 border-t border-[#e8e6df] dark:border-stone-800">
            <button
              type="button"
              onClick={handleReadFromStart}
              className="w-full py-1.5 text-xs text-stone-600 dark:text-stone-400 hover:text-[#141413] dark:hover:text-stone-100 hover:bg-[#f5f4ee] dark:hover:bg-stone-800 rounded-lg transition flex items-center justify-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>从头开始阅读</span>
            </button>
          </div>
        </div>
      )}

      {/* Table of Contents & Assets Modal */}
      {showTOC && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 font-sans text-[#141413] dark:text-stone-100">
          <div className="bg-white dark:bg-stone-900 rounded-2xl max-w-md w-full max-h-[85vh] flex flex-col shadow-2xl border border-[#e8e6df] dark:border-stone-800 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e8e6df] dark:border-stone-800 bg-[#f5f4ee]/80 dark:bg-stone-900/50">
              <div className="flex items-center gap-2">
                <List className="w-4 h-4 text-[#da7756]" />
                <h3 className="text-sm font-semibold truncate max-w-[200px]">{book.title}</h3>
              </div>
              <button
                onClick={() => setShowTOC(false)}
                className="p-1 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-[#e8e6df] dark:border-stone-800 text-xs">
              <button
                onClick={() => setTocActiveTab('chapters')}
                className={`flex-1 py-2.5 text-center font-medium border-b-2 transition ${
                  tocActiveTab === 'chapters'
                    ? 'border-[#da7756] text-[#da7756] font-semibold'
                    : 'border-transparent text-stone-500 hover:text-stone-700'
                }`}
              >
                目录 ({book.chapters.length})
              </button>
              <button
                onClick={() => setTocActiveTab('bookmarks')}
                className={`flex-1 py-2.5 text-center font-medium border-b-2 transition ${
                  tocActiveTab === 'bookmarks'
                    ? 'border-[#da7756] text-[#da7756] font-semibold'
                    : 'border-transparent text-stone-500 hover:text-stone-700'
                }`}
              >
                书签 ({bookmarks.length})
              </button>
              <button
                onClick={() => setTocActiveTab('highlights')}
                className={`flex-1 py-2.5 text-center font-medium border-b-2 transition ${
                  tocActiveTab === 'highlights'
                    ? 'border-[#da7756] text-[#da7756] font-semibold'
                    : 'border-transparent text-stone-500 hover:text-stone-700'
                }`}
              >
                高亮 ({highlights.length})
              </button>
            </div>

            {/* List Body */}
            <div className="flex-1 overflow-y-auto divide-y divide-[#e8e6df]/60 dark:divide-stone-800/60 p-1">
              {tocActiveTab === 'chapters' &&
                book.chapters.map((ch, idx) => (
                  <button
                    key={ch.id || idx}
                    type="button"
                    onClick={() => {
                      setCurrentChapterIndex(idx);
                      setShowTOC(false);
                    }}
                    className={`w-full text-left px-4 py-3 text-xs flex items-center justify-between hover:bg-[#f5f4ee] dark:hover:bg-stone-800/50 transition rounded-xl ${
                      currentChapterIndex === idx
                        ? 'text-[#da7756] font-semibold bg-[#da7756]/10'
                        : 'text-stone-700 dark:text-stone-300'
                    }`}
                  >
                    <span className="truncate pr-3">{ch.title}</span>
                    <span className="text-[10px] text-stone-400 shrink-0">{ch.wordCount} 字</span>
                  </button>
                ))}

              {tocActiveTab === 'bookmarks' &&
                (bookmarks.length === 0 ? (
                  <div className="py-12 text-center text-xs text-stone-400">暂无书签</div>
                ) : (
                  bookmarks.map((bm) => (
                    <div
                      key={bm.id}
                      onClick={() => {
                        setCurrentChapterIndex(bm.chapterIndex);
                        setShowTOC(false);
                      }}
                      className="px-4 py-3 text-xs hover:bg-[#f5f4ee] dark:hover:bg-stone-800/50 cursor-pointer space-y-1"
                    >
                      <div className="font-semibold text-[#141413] dark:text-stone-200">
                        {bm.chapterTitle}
                      </div>
                      <div className="text-[11px] text-stone-500 truncate">{bm.snippet}</div>
                    </div>
                  ))
                ))}

              {tocActiveTab === 'highlights' &&
                (highlights.length === 0 ? (
                  <div className="py-12 text-center text-xs text-stone-400">暂无高亮</div>
                ) : (
                  highlights.map((hl) => (
                    <div
                      key={hl.id}
                      onClick={() => {
                        setCurrentChapterIndex(hl.chapterIndex);
                        setShowTOC(false);
                      }}
                      className="px-4 py-3 text-xs hover:bg-[#f5f4ee] dark:hover:bg-stone-800/50 cursor-pointer space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-stone-600 dark:text-stone-400 text-[11px]">
                          {hl.chapterTitle}
                        </span>
                        <span className="text-[10px] text-stone-400">
                          {new Date(hl.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="text-xs text-[#da7756] line-clamp-2 pl-2 border-l-2 border-[#da7756]">
                        “{hl.text}”
                      </div>
                    </div>
                  ))
                ))}
            </div>
          </div>
        </div>
      )}

      {/* In-Book Search Modal */}
      {showSearch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 font-sans text-[#141413] dark:text-stone-100">
          <div className="bg-white dark:bg-stone-900 rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl border border-[#e8e6df] dark:border-stone-800 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-[#e8e6df] dark:border-stone-800 flex items-center gap-2">
              <Search className="w-4 h-4 text-stone-400" />
              <input
                type="text"
                autoFocus
                placeholder={`在《${book.title}》全文中搜索关键词...`}
                value={searchQuery}
                onChange={(e) => handlePerformSearch(e.target.value)}
                className="flex-1 text-xs bg-transparent border-none focus:outline-hidden text-[#141413] dark:text-stone-100"
              />
              <button
                onClick={() => setShowSearch(false)}
                className="p-1 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 divide-y divide-[#e8e6df]/60 dark:divide-stone-800/60">
              {searchResults.length === 0 ? (
                <div className="py-16 text-center text-xs text-stone-400">
                  {searchQuery ? '未找到相关内容' : '输入关键词快速定位到相应段落'}
                </div>
              ) : (
                searchResults.map((res, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      setCurrentChapterIndex(res.chapterIndex);
                      setShowSearch(false);
                    }}
                    className="p-3 hover:bg-[#f5f4ee] dark:hover:bg-stone-800/50 rounded-xl cursor-pointer space-y-1 transition text-xs"
                  >
                    <div className="font-semibold text-[#da7756]">
                      {res.chapterTitle}
                    </div>
                    <div className="text-stone-600 dark:text-stone-300 leading-relaxed">
                      {res.snippet}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Contextual Explanation Bottom Sheet */}
      {showAISheet && (
        <AISheet
          bookId={book.id}
          bookTitle={book.title}
          chapterTitle={currentChapter?.title || '当前章节'}
          chapterIndex={currentChapterIndex}
          selectedText={selectedText}
          precedingText={selectionContext.preceding}
          followingText={selectionContext.following}
          progressPercentage={progressPercent}
          initialSpoilerScope={settings.spoilerScope}
          onClose={() => setShowAISheet(false)}
          onSavedExcerpt={() => {
            showToast('已保存摘抄与 AI 解读');
          }}
        />
      )}
    </div>
  );
};
