import React, { useState } from 'react';
import { Copy, BookMarked, Highlighter, Bot, ChevronRight, Check } from 'lucide-react';
import { HighlightStyle } from '../types';

interface Props {
  position: { x: number; y: number };
  selectedText: string;
  lastHighlightStyle: HighlightStyle;
  onCopy: () => void;
  onExcerpt: () => void;
  onHighlight: (style: HighlightStyle) => void;
  onAIExplain: () => void;
  onClose: () => void;
}

export const HIGHLIGHT_PALETTE: {
  id: HighlightStyle;
  name: string;
  bgClass: string;
  indicator: string;
}[] = [
  { id: 'amber', name: '赤砂色', bgClass: 'bg-[#da7756]/30', indicator: 'bg-[#da7756]' },
  { id: 'emerald', name: '翠绿色', bgClass: 'bg-[#00c853]/30', indicator: 'bg-[#00c853]' },
  { id: 'rose', name: '朱砂红', bgClass: 'bg-[#ff5f38]/30', indicator: 'bg-[#ff5f38]' },
  { id: 'sky', name: '青石蓝', bgClass: 'bg-sky-400', indicator: 'bg-sky-400' },
  { id: 'purple', name: '黛紫色', bgClass: 'bg-purple-400', indicator: 'bg-purple-400' },
  { id: 'underline', name: '直线', bgClass: 'bg-stone-300', indicator: 'border-b-2 border-[#da7756]' },
  { id: 'wavy', name: '波浪线', bgClass: 'bg-stone-300', indicator: 'border-b-2 border-dashed border-[#00c853]' },
];

export const TextSelectionMenu: React.FC<Props> = ({
  position,
  selectedText,
  lastHighlightStyle,
  onCopy,
  onExcerpt,
  onHighlight,
  onAIExplain,
  onClose,
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Position bounds check to prevent floating off screen
  const menuWidth = showColorPicker ? 280 : 250;
  const screenWidth = window.innerWidth;
  const left = Math.max(10, Math.min(position.x - menuWidth / 2, screenWidth - menuWidth - 10));
  const top = Math.max(10, position.y - 56);

  const activeStyleConfig = HIGHLIGHT_PALETTE.find((p) => p.id === lastHighlightStyle) || HIGHLIGHT_PALETTE[0];

  return (
    <>
      {/* Invisible backdrop to dismiss on click outside */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div
        className="fixed z-50 transition-all duration-150 animate-in fade-in zoom-in-95 font-sans"
        style={{ left: `${left}px`, top: `${top}px` }}
      >
        <div className="bg-[#141413] text-[#f5f4ee] rounded-xl shadow-xl border border-[#2e2e2c] p-1 flex items-center gap-0.5 text-xs font-medium select-none">
          {!showColorPicker ? (
            <>
              {/* Copy */}
              <button
                type="button"
                onClick={onCopy}
                className="px-2.5 py-1.5 hover:bg-stone-800 rounded-lg flex items-center gap-1.5 transition active:scale-95 text-stone-300 hover:text-white"
                title="复制到剪贴板"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>复制</span>
              </button>

              <div className="w-[1px] h-4 bg-stone-700/60" />

              {/* Excerpt */}
              <button
                type="button"
                onClick={onExcerpt}
                className="px-2.5 py-1.5 hover:bg-stone-800 rounded-lg flex items-center gap-1.5 transition active:scale-95 text-stone-300 hover:text-white"
                title="存入独立摘抄本"
              >
                <BookMarked className="w-3.5 h-3.5 text-[#da7756]" />
                <span>摘抄</span>
              </button>

              <div className="w-[1px] h-4 bg-stone-700/60" />

              {/* Direct Highlight with Last Style / Expand colors */}
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => onHighlight(lastHighlightStyle)}
                  className="px-2 py-1.5 hover:bg-stone-800 rounded-l-lg flex items-center gap-1.5 transition active:scale-95 text-stone-300 hover:text-white"
                  title={`高亮 (${activeStyleConfig.name})`}
                >
                  <Highlighter className="w-3.5 h-3.5 text-[#da7756]" />
                  <span className="flex items-center gap-1">
                    高亮
                    <span className={`w-2 h-2 rounded-full ${activeStyleConfig.indicator}`} />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowColorPicker(true)}
                  className="p-1.5 hover:bg-stone-800 rounded-r-lg text-stone-400 hover:text-stone-200 transition"
                  title="更换高亮颜色"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              <div className="w-[1px] h-4 bg-stone-700/60" />

              {/* AI Explain */}
              <button
                type="button"
                onClick={onAIExplain}
                className="px-2.5 py-1.5 bg-[#da7756]/20 hover:bg-[#da7756]/30 text-[#da7756] hover:text-[#f5f4ee] rounded-lg flex items-center gap-1.5 transition active:scale-95 font-medium"
                title="防剧透 AI 语境深度解读"
              >
                <Bot className="w-3.5 h-3.5" />
                <span>AI解读</span>
              </button>
            </>
          ) : (
            /* Color Picker Submenu */
            <div className="flex items-center gap-1 px-1 py-0.5">
              {HIGHLIGHT_PALETTE.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onHighlight(p.id);
                    setShowColorPicker(false);
                  }}
                  className={`p-1.5 rounded-lg flex items-center justify-center hover:bg-stone-800 transition ${
                    lastHighlightStyle === p.id ? 'ring-1 ring-[#da7756] bg-stone-800' : ''
                  }`}
                  title={p.name}
                >
                  {p.id === 'underline' ? (
                    <span className="text-[10px] underline decoration-[#da7756] underline-offset-2 px-1 text-white">
                      U
                    </span>
                  ) : p.id === 'wavy' ? (
                    <span className="text-[10px] underline decoration-wavy decoration-[#00c853] px-1 text-white">
                      W
                    </span>
                  ) : (
                    <span className={`w-3.5 h-3.5 rounded-full ${p.indicator} block`} />
                  )}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowColorPicker(false)}
                className="text-[10px] text-stone-400 hover:text-white px-1 py-0.5 ml-1"
              >
                返回
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
