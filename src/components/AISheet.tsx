import React, { useState, useEffect } from 'react';
import {
  X,
  Bot,
  Sparkles,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Copy,
  BookMarked,
  Check,
  Quote,
  ChevronDown,
} from 'lucide-react';
import {
  findCachedAIInterpretation,
  saveAIInterpretation,
  addExcerpt,
  getAISettings,
} from '../db/store';
import { AIInterpretation, Excerpt } from '../types';

interface Props {
  bookId: string;
  bookTitle: string;
  chapterTitle: string;
  chapterIndex: number;
  selectedText: string;
  precedingText: string;
  followingText: string;
  progressPercentage: number;
  initialSpoilerScope?: 'current' | 'chapter' | 'book';
  onClose: () => void;
  onSavedExcerpt?: () => void;
}

export const AISheet: React.FC<Props> = ({
  bookId,
  bookTitle,
  chapterTitle,
  chapterIndex,
  selectedText,
  precedingText,
  followingText,
  progressPercentage,
  initialSpoilerScope = 'current',
  onClose,
  onSavedExcerpt,
}) => {
  const [spoilerScope, setSpoilerScope] = useState<'current' | 'chapter' | 'book'>(
    initialSpoilerScope
  );
  const [explanation, setExplanation] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [savedToExcerpts, setSavedToExcerpts] = useState<boolean>(false);
  const [isCached, setIsCached] = useState<boolean>(false);
  const [source, setSource] = useState<string>('');

  const fetchAIExplanation = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    setSavedToExcerpts(false);

    // 1. Check local persistent cache first
    if (!forceRefresh) {
      const cached = await findCachedAIInterpretation(bookId, chapterIndex, selectedText);
      if (cached && cached.explanation) {
        setExplanation(cached.explanation);
        setIsCached(true);
        setSource('本地持久缓存');
        setLoading(false);
        return;
      }
    }

    try {
      const aiSettings = await getAISettings();

      const response = await fetch('/api/ai/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedText,
          precedingText,
          followingText: spoilerScope === 'current' ? '' : followingText,
          bookTitle,
          chapterTitle,
          progressPercentage,
          spoilerScope,
          customConfig: aiSettings.apiKey
            ? {
                apiBaseUrl: aiSettings.apiBaseUrl,
                apiKey: aiSettings.apiKey,
                modelName: aiSettings.modelName,
              }
            : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `请求失败 (${response.status})`);
      }

      const data = await response.json();
      const output = data.explanation || '未能生成解读';
      setExplanation(output);
      setIsCached(false);
      setSource(data.source || 'Gemini 3.7 Flash');

      // 2. Persist result locally
      const record: AIInterpretation = {
        id: `ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        bookId,
        chapterIndex,
        selectedText,
        explanation: output,
        spoilerScope,
        createdAt: Date.now(),
      };
      await saveAIInterpretation(record);
    } catch (err: any) {
      console.error('AI interpretation error:', err);
      setError(err.message || 'AI 解读发生异常，请检查网络或稍后重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAIExplanation(false);
  }, [bookId, chapterIndex, selectedText, spoilerScope]);

  const handleCopyExplanation = () => {
    const textToCopy = `【选文】${selectedText}\n\n【AI 语境解读】\n${explanation}\n\n—— 出自《${bookTitle}》· ${chapterTitle}`;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveToExcerpts = async () => {
    const excerptItem: Excerpt = {
      id: `exc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      bookId,
      bookTitle,
      chapterTitle,
      chapterIndex,
      text: selectedText,
      thought: `[AI 语境解读]：\n${explanation}`,
      createdAt: Date.now(),
    };
    await addExcerpt(excerptItem);
    setSavedToExcerpts(true);
    if (onSavedExcerpt) {
      onSavedExcerpt();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      {/* Backdrop click to dismiss */}
      <div className="flex-1" onClick={onClose} />

      {/* Slide-up Sheet */}
      <div className="bg-white dark:bg-[#1a1a19] text-[#141413] dark:text-stone-100 rounded-t-3xl max-w-3xl w-full mx-auto max-h-[85vh] flex flex-col shadow-2xl border-t border-[#e8e6df] dark:border-stone-800 animate-in slide-in-from-bottom duration-300 overflow-hidden font-sans">
        {/* Handle Bar */}
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="w-10 h-1 rounded-full bg-stone-300 dark:bg-stone-700" />
        </div>

        {/* Sheet Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-[#e8e6df] dark:border-stone-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#da7756]/10 text-[#da7756]">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold tracking-tight text-[#141413] dark:text-stone-100">AI 语境深度解读</h3>
                {isCached && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-[#f5f4ee] dark:bg-stone-800 text-stone-600 dark:text-stone-300 border border-[#e8e6df] dark:border-stone-700 font-mono">
                    已缓存
                  </span>
                )}
              </div>
              <p className="text-xs text-stone-500 dark:text-stone-400 truncate max-w-xs sm:max-w-md">
                《{bookTitle}》· {chapterTitle} · 进度 {progressPercentage}%
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 rounded-xl hover:bg-[#f5f4ee] dark:hover:bg-stone-800 transition"
              title="关闭面板"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Spoiler Scope Control Matrix */}
        <div className="px-6 py-2.5 bg-[#f5f4ee]/80 dark:bg-stone-900/60 border-b border-[#e8e6df] dark:border-stone-800 flex items-center justify-between gap-2 overflow-x-auto text-xs">
          <div className="flex items-center gap-1.5 text-stone-600 dark:text-stone-400 shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 text-[#00c853]" />
            <span>防剧透范围：</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSpoilerScope('current')}
              className={`px-3 py-1 rounded-lg transition text-[11px] font-medium flex items-center gap-1 ${
                spoilerScope === 'current'
                  ? 'bg-white dark:bg-stone-800 text-[#da7756] shadow-xs border border-[#da7756]/30'
                  : 'text-stone-600 dark:text-stone-400 hover:bg-[#e8e6df]/50 dark:hover:bg-stone-800'
              }`}
              title="仅限当前阅读位置及前文（严禁剧透后续任何情节）"
            >
              <span>当前位置</span>
            </button>

            <button
              type="button"
              onClick={() => setSpoilerScope('chapter')}
              className={`px-3 py-1 rounded-lg transition text-[11px] font-medium flex items-center gap-1 ${
                spoilerScope === 'chapter'
                  ? 'bg-white dark:bg-stone-800 text-[#da7756] shadow-xs border border-[#da7756]/30'
                  : 'text-stone-600 dark:text-stone-400 hover:bg-[#e8e6df]/50 dark:hover:bg-stone-800'
              }`}
              title="结合当前章节内的前后文"
            >
              <span>当前章节</span>
            </button>

            <button
              type="button"
              onClick={() => setSpoilerScope('book')}
              className={`px-3 py-1 rounded-lg transition text-[11px] font-medium flex items-center gap-1 ${
                spoilerScope === 'book'
                  ? 'bg-white dark:bg-stone-800 text-[#da7756] shadow-xs border border-[#da7756]/30'
                  : 'text-stone-600 dark:text-stone-400 hover:bg-[#e8e6df]/50 dark:hover:bg-stone-800'
              }`}
              title="结合整本书宏观全局"
            >
              <span>整本书</span>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Selected Quote Card */}
          <div className="p-4 rounded-2xl bg-[#f5f4ee] dark:bg-stone-800/60 border border-[#e8e6df] dark:border-stone-800 relative">
            <Quote className="w-4 h-4 text-[#da7756]/40 absolute top-3 left-3" />
            <div className="pl-6 text-sm text-[#141413] dark:text-stone-200 font-serif italic leading-relaxed">
              “{selectedText}”
            </div>
          </div>

          {/* AI Result Container */}
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3 text-stone-500">
              <div className="p-3 rounded-2xl bg-[#da7756]/10 text-[#da7756] animate-spin">
                <Sparkles className="w-6 h-6" />
              </div>
              <p className="text-xs font-medium animate-pulse font-mono">正在构建防剧透语境并深度解析...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded-2xl text-xs border border-red-200 dark:border-red-900 flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="font-semibold">AI 解读未能完成</p>
                <p>{error}</p>
                <button
                  type="button"
                  onClick={() => fetchAIExplanation(true)}
                  className="mt-2 px-3 py-1.5 bg-[#da7756] hover:bg-[#c86341] text-white rounded-lg transition font-medium text-xs flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  重新尝试
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="prose prose-sm dark:prose-invert max-w-none text-[#141413] dark:text-stone-200 text-sm leading-relaxed whitespace-pre-wrap font-sans">
                {explanation}
              </div>

              {source && (
                <div className="pt-2 flex items-center justify-between text-[11px] text-stone-400 border-t border-[#e8e6df] dark:border-stone-800">
                  <span>模型引擎：{source}</span>
                  <span className="text-[#00c853] font-medium">防剧透状态：严格保障</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#e8e6df] dark:border-stone-800 bg-[#f5f4ee]/70 dark:bg-stone-900/60">
          <button
            type="button"
            onClick={() => fetchAIExplanation(true)}
            disabled={loading}
            className="px-3 py-2 text-xs text-stone-600 dark:text-stone-300 hover:bg-white dark:hover:bg-stone-800 rounded-xl transition flex items-center gap-1.5 disabled:opacity-50"
            title="强制重新生成解读"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>重新解读</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyExplanation}
              disabled={loading || !explanation}
              className="px-3.5 py-2 text-xs font-medium text-stone-700 dark:text-stone-200 hover:bg-white dark:hover:bg-stone-800 rounded-xl transition flex items-center gap-1.5 border border-[#e8e6df] dark:border-stone-700 disabled:opacity-50"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-[#00c853]" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? '已复制' : '复制解读'}</span>
            </button>

            <button
              type="button"
              onClick={handleSaveToExcerpts}
              disabled={loading || !explanation || savedToExcerpts}
              className="px-4 py-2 text-xs font-medium bg-[#da7756] hover:bg-[#c86341] text-white rounded-xl shadow-xs transition flex items-center gap-1.5 disabled:opacity-60"
            >
              {savedToExcerpts ? (
                <>
                  <Check className="w-3.5 h-3.5 text-white" />
                  已存入摘抄本
                </>
              ) : (
                <>
                  <BookMarked className="w-3.5 h-3.5" />
                  一键存为摘抄
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
