import React, { useState, useMemo } from 'react';
import { X, Sparkles, Download, ArrowRight, CheckCircle2, AlertCircle, FileDown, Link2, BookOpen } from 'lucide-react';
import {
  startTomatoNovelImport,
  downloadNovelAsTxt,
  extractUrlAndTitle,
  searchFanqieBooks,
  FanqieSearchHit,
  TomatoFetchProgress,
} from '../parsers/tomatoFetcher';
import { isTauri } from '../platform';
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
  const [searchHits, setSearchHits] = useState<FanqieSearchHit[]>([]);

  // Real-time parsing analysis of the current input
  const parsedAnalysis = useMemo(() => {
    if (!inputUrl.trim()) return null;
    return extractUrlAndTitle(inputUrl);
  }, [inputUrl]);

  const runImport = async (target: string) => {
    setLoading(true);
    setError(null);
    setSearchHits([]);
    try {
      const book = await startTomatoNovelImport(target, (p) => {
        setProgress(p);
      });
      setImportedBook(book);
    } catch (err: any) {
      setError(err.message || '抓取小说失败，请检查链接或稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleStartImport = async () => {
    if (!inputUrl.trim()) return;
    const parsed = extractUrlAndTitle(inputUrl.trim());
    if (isTauri() && parsed.platform === 'keyword_search' && !parsed.bookIdCandidate) {
      setLoading(true);
      setError(null);
      try {
        const hits = await searchFanqieBooks(inputUrl.trim());
        setSearchHits(hits);
        if (hits.length === 1) {
          await runImport(hits[0].bookId);
        }
      } catch (err: any) {
        setError(err.message || '搜索失败');
      } finally {
        setLoading(false);
      }
      return;
    }
    await runImport(inputUrl.trim());
  };

  const handleOpenReaderNow = () => {
    if (importedBook && progress?.isComplete) {
      onSuccess(importedBook, true);
    }
  };

  const handleRetryImport = async () => {
    if (!inputUrl.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const book = await startTomatoNovelImport(inputUrl.trim(), (p) => setProgress(p));
      setImportedBook(book);
    } catch (err: any) {
      setError(err.message || '重试导入失败，请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  const handleExportTxt = () => {
    if (!importedBook) return;
    setError(null);
    const chaptersToExport =
      progress?.chaptersData && progress.chaptersData.length > 0
        ? progress.chaptersData
        : importedBook.chapters.map((c) => ({ title: c.title, content: c.content }));

    try {
      downloadNovelAsTxt(importedBook.title, importedBook.author, chaptersToExport);
    } catch (err: any) {
      setError(err.message || '正文仍包含未解码字符，已阻止导出乱码文件');
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
                支持长读/番茄分享链接、书籍 ID 与书名流式秒开
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
              粘贴分享链接、书籍 ID，或直接输入书名搜索
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="例如：推荐一部好书《神通者》https://changdunovel.com/t/BTRdctuGVyI/"
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

          {/* Extracted preview chip if user pasted rich text */}
          {searchHits.length > 1 && !progress && (
            <div className="max-h-56 overflow-y-auto rounded-xl border border-[#e8e6df] dark:border-stone-800 divide-y divide-[#e8e6df] dark:divide-stone-800">
              {searchHits.map((hit) => (
                <button
                  key={hit.bookId}
                  type="button"
                  onClick={() => runImport(hit.bookId)}
                  className="w-full text-left px-3 py-2.5 hover:bg-[#f5f4ee] dark:hover:bg-stone-800 transition"
                >
                  <div className="text-xs font-medium truncate">{hit.title}</div>
                  <div className="text-[11px] text-stone-500 truncate">
                    {hit.author} · {hit.bookId}
                  </div>
                </button>
              ))}
            </div>
          )}

          {parsedAnalysis && !progress && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-500 bg-[#f5f4ee] dark:bg-stone-800/40 p-2.5 rounded-xl border border-[#e8e6df]/80 dark:border-stone-800">
              <span className="font-medium text-stone-600 dark:text-stone-300">智能识别：</span>
              {parsedAnalysis.extractedUrl && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-stone-700 border border-[#e8e6df] dark:border-stone-600 text-[#da7756] truncate max-w-[200px]">
                  <Link2 className="w-3 h-3 shrink-0" />
                  <span className="truncate">{parsedAnalysis.extractedUrl}</span>
                </span>
              )}
              {parsedAnalysis.titleHint && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-stone-700 border border-[#e8e6df] dark:border-stone-600 text-stone-700 dark:text-stone-200">
                  <BookOpen className="w-3 h-3 text-[#da7756] shrink-0" />
                  <span>《{parsedAnalysis.titleHint}》</span>
                </span>
              )}
              {parsedAnalysis.platform === 'changdunovel_share' && (
                <span className="text-[10px] text-stone-400">长读分享链接 (自动 302 重定向解析)</span>
              )}
            </div>
          )}

          {/* Quick presets */}
          {!progress && (
            <div className="text-[11px] text-stone-500">
              <span>示例链接：</span>
              <button
                type="button"
                onClick={() => setInputUrl('推荐一部好书《神通者》https://changdunovel.com/t/BTRdctuGVyI/')}
                className="ml-1 text-[#da7756] hover:underline"
              >
                《神通者》长读分享
              </button>
              <span className="mx-1.5">·</span>
              <button
                type="button"
                onClick={() => setInputUrl('https://fanqienovel.com/page/7665193065501445145')}
                className="text-[#da7756] hover:underline"
              >
                番茄直连
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
                  {progress.isComplete ? '全本抓取完成！' : progress.statusText || '后台流式抓取中...'}
                </span>
                <span className="text-stone-500 font-mono">
                  {progress.completedChapters} / {Math.max(1, progress.totalChapters)} 章
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-[#e8e6df] dark:bg-stone-700 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-[#da7756] h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.max(
                      5,
                      Math.round((progress.completedChapters / Math.max(1, progress.totalChapters)) * 100)
                    )}%`,
                  }}
                />
              </div>

              <div className="text-[11px] text-stone-500 truncate">
                当前进度：{progress.currentChapterTitle}
              </div>

              {/* Actions: only a fully READY book can be read or exported */}
              {progress.error && (
                <button
                  type="button"
                  onClick={handleRetryImport}
                  disabled={loading}
                  className="w-full px-4 py-2 text-xs font-medium bg-white dark:bg-stone-800 hover:bg-[#e8e6df]/50 text-[#da7756] border border-[#e8e6df] dark:border-stone-700 rounded-xl transition disabled:opacity-50"
                >
                  {loading ? '正在重试...' : '重试导入'}
                </button>
              )}
              <div className="pt-2 flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={handleOpenReaderNow}
                  disabled={!importedBook || !progress.isComplete}
                  className="flex-1 px-4 py-2.5 text-xs font-medium bg-[#da7756] hover:bg-[#c86341] text-white rounded-xl shadow-xs transition flex items-center justify-center gap-1.5"
                >
                  <ArrowRight className="w-4 h-4" />
                  {progress.isComplete ? '进入阅读（全本已就绪）' : '全部章节完成后可阅读'}
                </button>

                <button
                  type="button"
                  onClick={handleExportTxt}
                  disabled={!progress.completedChapters}
                  className="px-4 py-2.5 text-xs font-medium bg-white dark:bg-stone-800 hover:bg-[#e8e6df]/50 text-[#141413] dark:text-stone-100 border border-[#e8e6df] dark:border-stone-700 rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <FileDown className="w-4 h-4 text-[#da7756]" />
                  下载为 .TXT 文件
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
