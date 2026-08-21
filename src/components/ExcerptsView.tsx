import React, { useState, useEffect } from 'react';
import {
  BookMarked,
  Quote,
  Share2,
  Trash2,
  ExternalLink,
  MessageSquare,
  Copy,
  Check,
  Filter,
  Search,
  BookOpen,
  Library as LibraryIcon,
  UserRound,
  Sparkles,
} from 'lucide-react';
import { Excerpt, Book, ReaderSettings } from '../types';
import {
  getAllExcerpts,
  deleteExcerpt,
  updateExcerptThought,
  getAllBooks,
} from '../db/store';

interface Props {
  onOpenBookToChapter?: (bookId: string, chapterIndex: number) => void;
  onBackToLibrary: () => void;
  onOpenSettings?: () => void;
  theme?: ReaderSettings['theme'];
}

export const ExcerptsView: React.FC<Props> = ({ onOpenBookToChapter, onBackToLibrary, onOpenSettings, theme }) => {
  const [excerpts, setExcerpts] = useState<Excerpt[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBookFilter, setSelectedBookFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingThoughtId, setEditingThoughtId] = useState<string | null>(null);
  const [thoughtInput, setThoughtInput] = useState<string>('');

  const loadData = async () => {
    const [allExcs, allBooks] = await Promise.all([getAllExcerpts(), getAllBooks()]);
    setExcerpts(allExcs);
    setBooks(allBooks);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('确定要删除这条摘抄吗？')) {
      await deleteExcerpt(id);
      setExcerpts((prev) => prev.filter((item) => item.id !== id));
    }
  };

  const handleShare = async (item: Excerpt, e: React.MouseEvent) => {
    e.stopPropagation();
    const shareText = `“${item.text}”\n\n——《${item.bookTitle}》· ${item.chapterTitle}${
      item.thought ? `\n\n[心得/解读]：\n${item.thought}` : ''
    }`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `摘抄·《${item.bookTitle}》`,
          text: shareText,
        });
        return;
      } catch (err) {
        // Fallback to clipboard if share dismissed
      }
    }

    navigator.clipboard.writeText(shareText);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSaveThought = async (id: string) => {
    await updateExcerptThought(id, thoughtInput.trim());
    setExcerpts((prev) =>
      prev.map((item) => (item.id === id ? { ...item, thought: thoughtInput.trim() } : item))
    );
    setEditingThoughtId(null);
  };

  const existingBookIds = new Set(books.map((b) => b.id));

  // Unique books list for filter tabs
  const uniqueBookTitles = Array.from(new Set(excerpts.map((e) => e.bookTitle)));

  const filteredExcerpts = excerpts.filter((item) => {
    const matchBook =
      selectedBookFilter === 'all' || item.bookTitle === selectedBookFilter;
    const matchQuery =
      !searchQuery.trim() ||
      item.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.bookTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.thought && item.thought.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchBook && matchQuery;
  });

  if (theme === 'ink' || theme === 'claude') {
    const themeClass = theme === 'claude' ? 'claude-excerpts' : 'ink-excerpts';

    return (
      <div className={`${themeClass} ink-excerpts-page min-h-screen pb-24`}>
        <header className="ink-page-header">
          <div>
            <p className="ink-eyebrow">LIULIU READER</p>
            <h1>摘抄</h1>
            <p className="ink-header-note">已留存 {excerpts.length} 条文字片段</p>
          </div>
          <button type="button" className="ink-icon-button" onClick={onBackToLibrary} aria-label="返回书架"><BookOpen className="w-5 h-5" /></button>
        </header>

        <main className="ink-page-main">
          <div className="ink-search-line">
            <Search className="w-4 h-4" />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索摘抄、书名或心得" aria-label="搜索摘抄" />
          </div>
          <div className="ink-filter-strip" aria-label="书籍筛选">
            <button type="button" className={selectedBookFilter === 'all' ? 'is-selected' : ''} onClick={() => setSelectedBookFilter('all')}>全部</button>
            {uniqueBookTitles.map((title) => <button key={title} type="button" className={selectedBookFilter === title ? 'is-selected' : ''} onClick={() => setSelectedBookFilter(title)}>{title}</button>)}
          </div>

          <section className="ink-section">
            <div className="ink-section-heading"><span>文字片段</span><span>{filteredExcerpts.length} 条</span></div>
            {filteredExcerpts.length === 0 ? (
              <div className="ink-empty">还没有匹配的摘抄</div>
            ) : (
              <div className="ink-excerpt-list">
                {filteredExcerpts.map((item) => {
                  const canOpenSource = existingBookIds.has(item.bookId);
                  return (
                    <article key={item.id} className="ink-excerpt-row">
                      <button type="button" className="ink-excerpt-source" disabled={!canOpenSource} onClick={() => canOpenSource && onOpenBookToChapter?.(item.bookId, item.chapterIndex)}>
                        <span>《{item.bookTitle}》</span><small>{item.chapterTitle}</small>
                      </button>
                      <blockquote>“{item.text}”</blockquote>
                      {item.thought && editingThoughtId !== item.id && <p className="ink-excerpt-thought">{item.thought}</p>}
                      {editingThoughtId === item.id && (
                        <div className="ink-excerpt-editor">
                          <textarea rows={3} value={thoughtInput} onChange={(event) => setThoughtInput(event.target.value)} placeholder="记录你的阅读心得" />
                          <div><button type="button" onClick={() => setEditingThoughtId(null)}>取消</button><button type="button" onClick={() => handleSaveThought(item.id)}>保存</button></div>
                        </div>
                      )}
                      <div className="ink-excerpt-actions">
                        <button type="button" onClick={() => { setEditingThoughtId(item.id); setThoughtInput(item.thought || ''); }}><MessageSquare className="w-4 h-4" /> {item.thought ? '编辑心得' : '写心得'}</button>
                        <button type="button" onClick={(event) => handleShare(item, event)}>{copiedId === item.id ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />} {copiedId === item.id ? '已复制' : '分享'}</button>
                        <button type="button" onClick={(event) => handleDelete(item.id, event)} aria-label="删除摘抄"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </main>

        <nav className="ink-bottom-nav" aria-label="主导航">
          <button type="button" className="is-active"><BookMarked className="w-6 h-6" /><span>摘抄</span></button>
          <button type="button" onClick={onBackToLibrary}><LibraryIcon className="w-6 h-6" /><span>书架</span></button>
          <button type="button" onClick={onOpenSettings} aria-label="打开我的设置"><UserRound className="w-6 h-6" /><span>我的</span></button>
        </nav>
      </div>
    );
  }

  return (
    <div className={`${theme === 'ink' || theme === 'claude' ? `ink-excerpts ${theme === 'claude' ? 'claude-excerpts' : ''}` : ''} max-w-4xl mx-auto px-4 py-6 sm:py-8 space-y-6 animate-in fade-in duration-200 font-sans`}>
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#e8e6df] dark:border-stone-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-[#da7756]/10 text-[#da7756]">
            <BookMarked className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#141413] dark:text-stone-100">
              知识资产 · 摘抄本
            </h1>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
              共记录 <strong className="text-[#da7756] font-mono">{excerpts.length}</strong> 条纯文本佳句，与书籍删除完全解耦，永久独立留存
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBackToLibrary}
            className="px-4 py-2 text-xs font-medium bg-[#f5f4ee] hover:bg-[#e8e6df] dark:bg-stone-800 dark:hover:bg-stone-700 text-[#141413] dark:text-stone-200 rounded-xl transition flex items-center gap-1.5 border border-[#e8e6df] dark:border-stone-700"
          >
            <BookOpen className="w-4 h-4 text-[#da7756]" />
            返回书架
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Book filter chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full text-xs">
          <button
            type="button"
            onClick={() => setSelectedBookFilter('all')}
            className={`px-3 py-1.5 rounded-xl transition shrink-0 font-medium ${
              selectedBookFilter === 'all'
                ? 'bg-[#da7756] text-white shadow-xs'
                : 'bg-[#f5f4ee] dark:bg-stone-800/80 text-stone-600 dark:text-stone-300 hover:bg-[#e8e6df] dark:hover:bg-stone-700 border border-[#e8e6df] dark:border-stone-700'
            }`}
          >
            全部时间线 ({excerpts.length})
          </button>
          {uniqueBookTitles.map((title) => (
            <button
              key={title}
              type="button"
              onClick={() => setSelectedBookFilter(title)}
              className={`px-3 py-1.5 rounded-xl transition shrink-0 truncate max-w-[160px] font-medium ${
                selectedBookFilter === title
                  ? 'bg-[#da7756] text-white shadow-xs'
                  : 'bg-[#f5f4ee] dark:bg-stone-800/80 text-stone-600 dark:text-stone-300 hover:bg-[#e8e6df] dark:hover:bg-stone-700 border border-[#e8e6df] dark:border-stone-700'
              }`}
            >
              《{title}》
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-stone-400" />
          <input
            type="text"
            placeholder="搜索摘抄或心得内容..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3.5 py-1.5 text-xs rounded-xl border border-[#e8e6df] dark:border-stone-800 bg-white dark:bg-stone-900 focus:outline-hidden focus:ring-2 focus:ring-[#da7756]/40 text-[#141413] dark:text-stone-200"
          />
        </div>
      </div>

      {/* Excerpts List */}
      {filteredExcerpts.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center text-center space-y-3 bg-[#f5f4ee]/40 dark:bg-stone-900/30 rounded-3xl border border-dashed border-[#e8e6df] dark:border-stone-800">
          <div className="p-4 rounded-2xl bg-[#da7756]/10 text-[#da7756]">
            <Quote className="w-8 h-8 opacity-60" />
          </div>
          <p className="text-sm font-medium text-stone-600 dark:text-stone-400">
            {searchQuery || selectedBookFilter !== 'all' ? '未找到匹配的摘抄' : '暂无摘抄记录'}
          </p>
          <p className="text-xs text-stone-400 max-w-sm">
            在阅读器中长按选中文本，点击「摘抄」或在 AI 解读中「一键存为摘抄」，句子便会独立沉淀在此处。
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredExcerpts.map((item) => {
            const isOriginalBookAvailable = existingBookIds.has(item.bookId);

            return (
              <div
                key={item.id}
                className="p-5 rounded-2xl bg-white dark:bg-stone-900 border border-[#e8e6df] dark:border-stone-800 shadow-xs hover:shadow-md transition duration-200 group relative flex flex-col justify-between"
              >
                <div className="space-y-3.5">
                  {/* Quote Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400 flex-wrap">
                      <span className="font-semibold text-[#141413] dark:text-stone-200">
                        《{item.bookTitle}》
                      </span>
                      <span>·</span>
                      <span className="text-stone-600 dark:text-stone-400">{item.chapterTitle}</span>
                      <span>·</span>
                      <span className="text-[11px] text-stone-400 font-mono">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Source Status Tag */}
                    <div>
                      {isOriginalBookAvailable ? (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenBookToChapter &&
                            onOpenBookToChapter(item.bookId, item.chapterIndex)
                          }
                          className="px-2.5 py-1 rounded-lg text-[11px] bg-[#da7756]/10 hover:bg-[#da7756]/20 text-[#da7756] font-medium transition flex items-center gap-1"
                          title="在阅读器中跳转到原文所在章节"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>反查原文</span>
                        </button>
                      ) : (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] bg-[#f5f4ee] dark:bg-stone-800 text-stone-400 font-mono">
                          独立留存（原书已删）
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Main Quote Content */}
                  <div className="text-sm sm:text-base font-serif text-[#141413] dark:text-stone-100 leading-relaxed pl-3 border-l-2 border-[#da7756] whitespace-pre-wrap">
                    “{item.text}”
                  </div>

                  {/* User Thought / Reflection Section */}
                  {item.thought && editingThoughtId !== item.id && (
                    <div className="p-3 bg-[#f5f4ee] dark:bg-stone-800/50 rounded-xl text-xs text-stone-700 dark:text-stone-300 border border-[#e8e6df] dark:border-stone-800 whitespace-pre-wrap flex items-start gap-2">
                      <Sparkles className="w-4 h-4 text-[#da7756] shrink-0 mt-0.5" />
                      <div className="flex-1 leading-relaxed font-sans">{item.thought}</div>
                    </div>
                  )}

                  {/* Editing Thought */}
                  {editingThoughtId === item.id && (
                    <div className="space-y-2 pt-1 font-sans">
                      <textarea
                        rows={3}
                        value={thoughtInput}
                        onChange={(e) => setThoughtInput(e.target.value)}
                        placeholder="记录你的阅读心得、疑问或关联思考..."
                        className="w-full p-2.5 text-xs rounded-xl border border-[#e8e6df] dark:border-stone-700 bg-white dark:bg-stone-800 focus:outline-hidden focus:ring-2 focus:ring-[#da7756]/40 text-[#141413] dark:text-stone-200"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingThoughtId(null)}
                          className="px-2.5 py-1 text-[11px] text-stone-500 hover:text-[#141413] dark:hover:text-stone-300"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveThought(item.id)}
                          className="px-3 py-1 text-[11px] font-medium bg-[#da7756] hover:bg-[#c86341] text-white rounded-lg transition"
                        >
                          保存心得
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Card Actions Footer */}
                <div className="pt-4 mt-2 border-t border-[#e8e6df] dark:border-stone-800/80 flex items-center justify-between font-sans">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingThoughtId(item.id);
                        setThoughtInput(item.thought || '');
                      }}
                      className="px-2.5 py-1 text-xs text-stone-500 hover:text-[#141413] dark:hover:text-stone-200 hover:bg-[#f5f4ee] dark:hover:bg-stone-800 rounded-lg transition flex items-center gap-1"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>{item.thought ? '编辑心得' : '写心得'}</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => handleShare(item, e)}
                      className="px-2.5 py-1 text-xs text-stone-600 dark:text-stone-300 hover:bg-[#f5f4ee] dark:hover:bg-stone-800 rounded-lg transition flex items-center gap-1"
                      title="系统分享或复制卡片文本到 Flomo/备忘录"
                    >
                      {copiedId === item.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[#00c853]" />
                          <span className="text-[#00c853] font-medium">已复制</span>
                        </>
                      ) : (
                        <>
                          <Share2 className="w-3.5 h-3.5 text-[#da7756]" />
                          <span>分享/推送</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleDelete(item.id, e)}
                      className="p-1.5 text-stone-400 hover:text-[#ff5f38] dark:hover:text-red-400 hover:bg-[#f5f4ee] dark:hover:bg-stone-800 rounded-lg transition"
                      title="删除此摘抄"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
