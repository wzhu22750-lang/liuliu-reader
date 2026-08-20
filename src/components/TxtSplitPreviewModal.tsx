import React, { useState } from 'react';
import { COMMON_SPLIT_RULES, TxtParseResult, parseTxtContent } from '../parsers/txtParser';
import { X, BookOpen, Layers, CheckCircle2, RefreshCw } from 'lucide-react';

interface Props {
  rawText: string;
  fileName: string;
  initialResult: TxtParseResult;
  onConfirm: (result: TxtParseResult, customTitle: string, customAuthor: string) => void;
  onCancel: () => void;
}

export const TxtSplitPreviewModal: React.FC<Props> = ({
  rawText,
  fileName,
  initialResult,
  onConfirm,
  onCancel,
}) => {
  const [selectedRuleId, setSelectedRuleId] = useState<string>(COMMON_SPLIT_RULES[0].id);
  const [customRegexStr, setCustomRegexStr] = useState<string>('');
  const [useCustomRegex, setUseCustomRegex] = useState<boolean>(false);
  const [title, setTitle] = useState<string>(initialResult.title);
  const [author, setAuthor] = useState<string>(initialResult.author);
  const [currentResult, setCurrentResult] = useState<TxtParseResult>(initialResult);

  const handleRuleChange = (ruleId: string) => {
    setSelectedRuleId(ruleId);
    setUseCustomRegex(false);
    const rule = COMMON_SPLIT_RULES.find((r) => r.id === ruleId);
    if (rule) {
      const newResult = parseTxtContent(rawText, fileName, rule.pattern);
      setCurrentResult(newResult);
    }
  };

  const handleApplyCustomRegex = () => {
    if (!customRegexStr.trim()) return;
    try {
      const reg = new RegExp(customRegexStr.trim(), 'm');
      const newResult = parseTxtContent(rawText, fileName, reg);
      setCurrentResult(newResult);
      setUseCustomRegex(true);
    } catch (e: any) {
      alert('自定义正则表达式语法有误：' + e.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 font-sans">
      <div className="bg-white dark:bg-[#1a1a19] text-[#141413] dark:text-stone-100 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-[#e8e6df] dark:border-stone-800 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e8e6df] dark:border-stone-800 bg-[#f5f4ee]/80 dark:bg-stone-900/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#da7756]/10 text-[#da7756]">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">TXT 章节拆分与目录预览</h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                请确认书籍元数据与拆分规则，可手动微调后再入库
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 rounded-lg hover:bg-[#e8e6df]/50 dark:hover:bg-stone-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Metadata Edit */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
                书名
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-[#e8e6df] dark:border-stone-700 bg-white dark:bg-stone-800 focus:outline-hidden focus:ring-2 focus:ring-[#da7756]/40 text-[#141413] dark:text-stone-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
                作者
              </label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-[#e8e6df] dark:border-stone-700 bg-white dark:bg-stone-800 focus:outline-hidden focus:ring-2 focus:ring-[#da7756]/40 text-[#141413] dark:text-stone-100"
              />
            </div>
          </div>

          {/* Rule Selector */}
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-2">
              章节拆分规则
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {COMMON_SPLIT_RULES.map((rule) => (
                <button
                  key={rule.id}
                  type="button"
                  onClick={() => handleRuleChange(rule.id)}
                  className={`px-3 py-2.5 rounded-xl border text-left text-xs transition ${
                    !useCustomRegex && selectedRuleId === rule.id
                      ? 'border-[#da7756] bg-[#da7756]/10 text-[#141413] dark:text-stone-100 font-medium'
                      : 'border-[#e8e6df] dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600 bg-white dark:bg-stone-800/60'
                  }`}
                >
                  <div className="font-semibold text-[#da7756] truncate">{rule.name}</div>
                  <div className="text-[10px] text-stone-500 dark:text-stone-400 mt-0.5 truncate">
                    {rule.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Custom Regex Input */}
          <div className="pt-1">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="自定义正则，例如：^第[0-9]+章"
                value={customRegexStr}
                onChange={(e) => setCustomRegexStr(e.target.value)}
                className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-[#e8e6df] dark:border-stone-700 bg-white dark:bg-stone-800 focus:outline-hidden focus:ring-2 focus:ring-[#da7756]/40 text-[#141413] dark:text-stone-100 font-mono"
              />
              <button
                type="button"
                onClick={handleApplyCustomRegex}
                className="px-3.5 py-2 text-xs font-medium bg-[#f5f4ee] dark:bg-stone-800 hover:bg-[#e8e6df] dark:hover:bg-stone-700 text-[#141413] dark:text-stone-200 rounded-xl transition flex items-center gap-1.5 border border-[#e8e6df] dark:border-stone-700"
              >
                <RefreshCw className="w-3.5 h-3.5 text-[#da7756]" />
                重新拆分
              </button>
            </div>
          </div>

          {/* Chapters Preview Summary */}
          <div className="bg-[#f5f4ee] dark:bg-stone-800/40 rounded-xl p-3.5 border border-[#e8e6df] dark:border-stone-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[#da7756]" />
              <span>识别到 <strong className="text-[#da7756] font-mono">{currentResult.chapters.length}</strong> 个章节</span>
            </div>
            <span className="text-stone-500 font-mono">约 {Math.round(currentResult.totalWords / 10000 * 10) / 10} 万字</span>
          </div>

          {/* Chapters List Preview */}
          <div>
            <div className="text-xs font-medium text-stone-600 dark:text-stone-400 mb-2">
              目录预览（前 30 章）
            </div>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-[#e8e6df] dark:border-stone-800 divide-y divide-[#e8e6df] dark:divide-stone-800/60 bg-white dark:bg-stone-900/60">
              {currentResult.chapters.slice(0, 30).map((ch, idx) => (
                <div
                  key={ch.id || idx}
                  className="px-3.5 py-2 text-xs flex items-center justify-between hover:bg-[#f5f4ee] dark:hover:bg-stone-800/30 transition"
                >
                  <span className="truncate pr-4 font-medium text-stone-700 dark:text-stone-300">
                    {ch.title}
                  </span>
                  <span className="text-[11px] text-stone-400 font-mono shrink-0">{ch.wordCount} 字</span>
                </div>
              ))}
              {currentResult.chapters.length > 30 && (
                <div className="px-3.5 py-2 text-center text-xs text-stone-400">
                  ... 及其余 {currentResult.chapters.length - 30} 个章节
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#e8e6df] dark:border-stone-800 bg-[#f5f4ee]/80 dark:bg-stone-900/50">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs font-medium text-stone-600 dark:text-stone-400 hover:text-[#141413] dark:hover:text-stone-200 rounded-xl hover:bg-[#e8e6df]/50 dark:hover:bg-stone-800 transition"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(currentResult, title, author)}
            className="px-5 py-2 text-xs font-medium bg-[#da7756] hover:bg-[#c86341] text-white rounded-xl shadow-xs transition flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            确认导入书库
          </button>
        </div>
      </div>
    </div>
  );
};
