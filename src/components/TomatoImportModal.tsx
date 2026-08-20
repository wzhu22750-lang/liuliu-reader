import React, { useState } from 'react';
import { X, Sparkles, Download, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { startTomatoNovelImport, TomatoFetchProgress } from '../parsers/tomatoFetcher';
import { Book } from '../types';

interface Props {
  onSuccess: (book: Book, openDirectly?: boolean) => void;
  onClose: () => void;
}

export const TomatoImportModal: React.FC<Props> = ({ onSuccess, onClose }) => {
  const [inputUrl, setInputUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<TomatoFetchProgress | null>(null);
  const [importedBook, setImportedBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleStartImport = async () => {
    if (!inputUrl.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const book = await startTomatoNovelImport(inputUrl.trim(), (p) => {
        setProgress(p);
      });
      setImportedBook(book);
    } catch (err: any) {
      setError(err.message || '抓取小说失败，请检查链接或稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenReaderNow = () => {
    if (importedBook) {
      onSuccess(importedBook, true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 font-sans">
      <div className="bg-white dark:bg-[#1a1a19] text-[#141413] dark:text-stone-100 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-[#e8e6df] dark:border-stone-800 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#e8e6df] dark:border-stone-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#da7756]/10 text-[#da7756]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight">网络小说链接解析导入</h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                支持流式解析边下边读，前序章节就绪即可直接开始阅读
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 rounded-lg hover:bg-[#e8e6df]/50 dark:hover:bg-stone-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1.5">
              粘贴小说分享链接或书名
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="例如：https://fanqie.novel/book/12345 或 九品修仙纪"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                disabled={loading || !!progress}
                className="flex-1 px-3.5 py-2.5 text-xs rounded-xl border border-[#e8e6df] dark:border-stone-700 bg-white dark:bg-stone-800 focus:outline-hidden focus:ring-2 focus:ring-[#da7756]/40 disabled:opacity-60 text-[#141413] dark:text-stone-100"
              />
              {!progress && (
                <button
                  type="button"
                  onClick={handleStartImport}
                  disabled={loading || !inputUrl.trim()}
                  className="px-4 py-2 text-xs font-medium bg-[#da7756] hover:bg-[#c86341] disabled:opacity-50 text-white rounded-xl shadow-xs transition flex items-center gap-1.5 shrink-0"
                >
                  {loading ? (
                    <>
                      <Download className="w-3.5 h-3.5 animate-bounce" />
                      解析中...
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5" />
                      开始解析
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Quick presets */}
          {!progress && (
            <div className="text-[11px] text-stone-500">
              <span>示例热书：</span>
              <button
                type="button"
                onClick={() => setInputUrl('番茄热书·九品修仙纪')}
                className="ml-1 text-[#da7756] hover:underline"
              >
                《九品修仙纪》
              </button>
              <span className="mx-1.5">·</span>
              <button
                type="button"
                onClick={() => setInputUrl('https://fanqie.novel/book/xinghe_wushen')}
                className="text-[#da7756] hover:underline"
              >
                《星河武神》
              </button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 text-[#ff5f38] dark:text-red-300 rounded-xl text-xs flex items-start gap-2 border border-red-200 dark:border-red-900">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Progress Box */}
          {progress && (
            <div className="p-4 bg-[#f5f4ee] dark:bg-stone-800/50 rounded-xl border border-[#e8e6df] dark:border-stone-800 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium flex items-center gap-1.5 text-[#141413] dark:text-stone-300">
                  {progress.isComplete ? (
                    <CheckCircle2 className="w-4 h-4 text-[#00c853]" />
                  ) : (
                    <Download className="w-4 h-4 text-[#da7756] animate-pulse" />
                  )}
                  {progress.isComplete ? '全本抓取完成！' : '后台流式抓取中...'}
                </span>
                <span className="text-stone-500 font-mono">
                  {progress.completedChapters} / {progress.totalChapters} 章
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-[#e8e6df] dark:bg-stone-700 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-[#da7756] h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.round((progress.completedChapters / progress.totalChapters) * 100)}%`,
                  }}
                />
              </div>

              <div className="text-[11px] text-stone-500 truncate">
                当前抓取：{progress.currentChapterTitle}
              </div>

              {/* Instant Read Button */}
              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={handleOpenReaderNow}
                  className="flex-1 px-4 py-2.5 text-xs font-medium bg-[#da7756] hover:bg-[#c86341] text-white rounded-xl shadow-xs transition flex items-center justify-center gap-1.5"
                >
                  <ArrowRight className="w-4 h-4" />
                  立即进入阅读（已就绪 {progress.completedChapters} 章）
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2 border-t border-[#e8e6df] dark:border-stone-800/80">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-stone-600 dark:text-stone-400 hover:text-[#141413] dark:hover:text-stone-200 rounded-xl hover:bg-[#e8e6df]/50 dark:hover:bg-stone-800 transition"
          >
            {progress ? '完成并在书库查看' : '取消'}
          </button>
        </div>
      </div>
    </div>
  );
};
