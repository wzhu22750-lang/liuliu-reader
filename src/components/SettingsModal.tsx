import React, { useState, useEffect } from 'react';
import {
  X,
  Settings,
  Bot,
  ShieldCheck,
  Download,
  Upload,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Database,
  KeyRound,
  FileSpreadsheet,
} from 'lucide-react';
import {
  getAISettings,
  saveAISettings,
  getReaderSettings,
  saveReaderSettings,
  generateBackup,
  restoreBackup,
} from '../db/indexedDB';
import { AISettings, ReaderSettings, BackupData } from '../types';

interface Props {
  onClose: () => void;
  onSettingsUpdated?: () => void;
}

export const SettingsModal: React.FC<Props> = ({ onClose, onSettingsUpdated }) => {
  const [aiSettings, setAiSettings] = useState<AISettings>({
    apiBaseUrl: '',
    apiKey: '',
    modelName: 'gemini-3.7-flash',
  });
  const [readerSettings, setReaderSettings] = useState<ReaderSettings | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getAISettings(), getReaderSettings()]).then(([ai, reader]) => {
      setAiSettings(ai);
      setReaderSettings(reader);
    });
  }, []);

  const handleSaveAISettings = async () => {
    await saveAISettings(aiSettings);
    if (readerSettings) {
      await saveReaderSettings(readerSettings);
    }
    setSaveSuccess(true);
    if (onSettingsUpdated) onSettingsUpdated();
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleTestAIConnection = async () => {
    setTestStatus('testing');
    try {
      const res = await fetch('/api/ai/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedText: '知行合一',
          precedingText: '阳明心学之旨，在于致良知。',
          bookTitle: '心学札记',
          chapterTitle: '第一卷',
          spoilerScope: 'current',
          customConfig: aiSettings.apiKey
            ? {
                apiBaseUrl: aiSettings.apiBaseUrl,
                apiKey: aiSettings.apiKey,
                modelName: aiSettings.modelName,
              }
            : undefined,
        }),
      });

      if (res.ok) {
        setTestStatus('success');
      } else {
        const data = await res.json().catch(() => ({}));
        setTestStatus(`failed: ${data.error || res.status}`);
      }
    } catch (err: any) {
      setTestStatus(`failed: ${err.message}`);
    }
  };

  const handleExportBackup = async (type: 'full' | 'data-only') => {
    setBackupLoading(true);
    try {
      const backup = await generateBackup(type);
      const jsonStr = JSON.stringify(backup, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = `ReaderAI_${type === 'full' ? 'FullBackup' : 'DataOnly'}_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('备份导出失败：' + err.message);
    } finally {
      setBackupLoading(false);
    }
  };

  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target?.result as string) as BackupData;
        const res = await restoreBackup(json);
        setRestoreMessage(res.message);
        if (onSettingsUpdated) onSettingsUpdated();
        setTimeout(() => setRestoreMessage(null), 3000);
      } catch (err: any) {
        alert('恢复备份失败：' + err.message);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 font-sans">
      <div className="bg-white dark:bg-[#1a1a19] text-[#141413] dark:text-stone-100 rounded-2xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-[#e8e6df] dark:border-stone-800 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e8e6df] dark:border-stone-800 bg-[#f5f4ee]/80 dark:bg-stone-900/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#da7756]/10 text-[#da7756]">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight">应用设置与数据中心</h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                AI 语境模型配置、防剧透预设与本地双模式备份
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
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Section 1: AI API Configuration */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300 uppercase tracking-wider">
              <KeyRound className="w-4 h-4 text-[#da7756]" />
              <span>AI API 全局配置</span>
            </div>
            <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed">
              默认自动调用后端 Gemini 3.7 模型。若需要，也可在此填入自定义 OpenAI / DeepSeek / 通义千问等兼容 API。
            </p>

            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
                  API Base URL (可选)
                </label>
                <input
                  type="text"
                  placeholder="例如：https://api.deepseek.com/v1 (留空则使用默认后端)"
                  value={aiSettings.apiBaseUrl}
                  onChange={(e) => setAiSettings({ ...aiSettings, apiBaseUrl: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#e8e6df] dark:border-stone-700 bg-white dark:bg-stone-800 focus:outline-hidden focus:ring-2 focus:ring-[#da7756]/40 text-[#141413] dark:text-stone-100"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
                    API Key (密钥安全仅保存在本地)
                  </label>
                  <input
                    type="password"
                    placeholder="sk-..."
                    value={aiSettings.apiKey}
                    onChange={(e) => setAiSettings({ ...aiSettings, apiKey: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#e8e6df] dark:border-stone-700 bg-white dark:bg-stone-800 focus:outline-hidden focus:ring-2 focus:ring-[#da7756]/40 text-[#141413] dark:text-stone-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
                    Model Name (模型代号)
                  </label>
                  <input
                    type="text"
                    placeholder="gemini-3.7-flash 或 deepseek-chat"
                    value={aiSettings.modelName}
                    onChange={(e) => setAiSettings({ ...aiSettings, modelName: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#e8e6df] dark:border-stone-700 bg-white dark:bg-stone-800 focus:outline-hidden focus:ring-2 focus:ring-[#da7756]/40 text-[#141413] dark:text-stone-100 font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleTestAIConnection}
                  className="px-3 py-1.5 text-xs bg-[#f5f4ee] dark:bg-stone-800 hover:bg-[#e8e6df] dark:hover:bg-stone-700 rounded-lg text-[#141413] dark:text-stone-200 transition font-medium border border-[#e8e6df] dark:border-stone-700"
                >
                  测试连接连通性
                </button>
                {testStatus === 'testing' && (
                  <span className="text-xs text-stone-400 animate-pulse">正在测试...</span>
                )}
                {testStatus === 'success' && (
                  <span className="text-xs text-[#00c853] flex items-center gap-1 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 连接正常
                  </span>
                )}
                {testStatus?.startsWith('failed') && (
                  <span className="text-xs text-[#ff5f38] flex items-center gap-1 font-medium truncate max-w-xs">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {testStatus}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="h-[1px] bg-[#e8e6df] dark:border-stone-800" />

          {/* Section 2: Anti-Spoiler & Reading Settings */}
          {readerSettings && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300 uppercase tracking-wider">
                <ShieldCheck className="w-4 h-4 text-[#00c853]" />
                <span>防剧透默认范围与选段设置</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setReaderSettings({ ...readerSettings, spoilerScope: 'current' })}
                  className={`p-3 rounded-xl border text-left text-xs transition ${
                    readerSettings.spoilerScope === 'current'
                      ? 'border-[#da7756] bg-[#da7756]/10 text-[#141413] dark:text-stone-100 font-medium'
                      : 'border-[#e8e6df] dark:border-stone-700 bg-white dark:bg-stone-800/60'
                  }`}
                >
                  <div className="font-semibold text-[#da7756]">当前阅读位置</div>
                  <div className="text-[10px] text-stone-500 dark:text-stone-400 mt-1">
                    严禁包含任何后续未读正文（严格防剧透）
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setReaderSettings({ ...readerSettings, spoilerScope: 'chapter' })}
                  className={`p-3 rounded-xl border text-left text-xs transition ${
                    readerSettings.spoilerScope === 'chapter'
                      ? 'border-[#da7756] bg-[#da7756]/10 text-[#141413] dark:text-stone-100 font-medium'
                      : 'border-[#e8e6df] dark:border-stone-700 bg-white dark:bg-stone-800/60'
                  }`}
                >
                  <div className="font-semibold text-[#da7756]">当前章节</div>
                  <div className="text-[10px] text-stone-500 dark:text-stone-400 mt-1">
                    允许参考章内前后文，防止跨章剧透
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setReaderSettings({ ...readerSettings, spoilerScope: 'book' })}
                  className={`p-3 rounded-xl border text-left text-xs transition ${
                    readerSettings.spoilerScope === 'book'
                      ? 'border-[#da7756] bg-[#da7756]/10 text-[#141413] dark:text-stone-100 font-medium'
                      : 'border-[#e8e6df] dark:border-stone-700 bg-white dark:bg-stone-800/60'
                  }`}
                >
                  <div className="font-semibold text-[#da7756]">整本书视角</div>
                  <div className="text-[10px] text-stone-500 dark:text-stone-400 mt-1">
                    宏观全局视角（适合二刷或经典论述）
                  </div>
                </button>
              </div>

              {/* Auto Snap Sentences */}
              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={readerSettings.autoSnapSentence}
                    onChange={(e) =>
                      setReaderSettings({
                        ...readerSettings,
                        autoSnapSentence: e.target.checked,
                      })
                    }
                    className="rounded border-stone-300 text-[#da7756] focus:ring-[#da7756]"
                  />
                  <span className="text-xs text-stone-700 dark:text-stone-300">
                    智能选段：长按时默认按句号/感叹号/问号自动吸附完整句子
                  </span>
                </label>
              </div>
            </div>
          )}

          <div className="h-[1px] bg-[#e8e6df] dark:border-stone-800" />

          {/* Section 3: Data Backup & Restore */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300 uppercase tracking-wider">
              <Database className="w-4 h-4 text-[#da7756]" />
              <span>数据持久化与双模式备份</span>
            </div>
            <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed">
              本地优先存储（IndexedDB）。可随时导出离线标准 JSON 备份包。
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Full Backup */}
              <div className="p-3.5 bg-[#f5f4ee] dark:bg-stone-800/40 rounded-xl border border-[#e8e6df] dark:border-stone-800 space-y-2">
                <div className="font-medium text-xs text-[#141413] dark:text-stone-200 flex items-center gap-1.5">
                  <HardDrive className="w-4 h-4 text-stone-600 dark:text-stone-400" />
                  <span>完整备份 (Full)</span>
                </div>
                <p className="text-[11px] text-stone-500">
                  包含全部书籍源文件、章节正文、阅读进度、高亮、摘抄本与 AI 解读历史。
                </p>
                <button
                  type="button"
                  disabled={backupLoading}
                  onClick={() => handleExportBackup('full')}
                  className="w-full py-1.5 text-xs font-medium bg-white dark:bg-stone-700 hover:bg-[#e8e6df] dark:hover:bg-stone-600 text-[#141413] dark:text-stone-100 rounded-lg transition flex items-center justify-center gap-1.5 border border-[#e8e6df] dark:border-stone-600"
                >
                  <Download className="w-3.5 h-3.5" />
                  导出完整备份包
                </button>
              </div>

              {/* Data-only Backup */}
              <div className="p-3.5 bg-[#f5f4ee] dark:bg-stone-800/40 rounded-xl border border-[#e8e6df] dark:border-stone-800 space-y-2">
                <div className="font-medium text-xs text-[#141413] dark:text-stone-200 flex items-center gap-1.5">
                  <FileSpreadsheet className="w-4 h-4 text-stone-600 dark:text-stone-400" />
                  <span>轻量数据备份 (Data Only)</span>
                </div>
                <p className="text-[11px] text-stone-500">
                  仅导出摘抄本、高亮、书签与 AI 解读知识资产（不含大体积小说正文）。
                </p>
                <button
                  type="button"
                  disabled={backupLoading}
                  onClick={() => handleExportBackup('data-only')}
                  className="w-full py-1.5 text-xs font-medium bg-white dark:bg-stone-700 hover:bg-[#e8e6df] dark:hover:bg-stone-600 text-[#141413] dark:text-stone-100 rounded-lg transition flex items-center justify-center gap-1.5 border border-[#e8e6df] dark:border-stone-600"
                >
                  <Download className="w-3.5 h-3.5" />
                  导出轻量知识包
                </button>
              </div>
            </div>

            {/* Restore */}
            <div className="pt-2">
              <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1.5">
                从备份文件恢复
              </label>
              <div className="flex items-center gap-3">
                <label className="cursor-pointer px-4 py-2 text-xs font-medium bg-[#f5f4ee] hover:bg-[#e8e6df] dark:bg-stone-800 dark:hover:bg-stone-700 text-[#da7756] border border-[#da7756]/40 rounded-xl transition flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" />
                  <span>选择 .json 备份文件导入</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleRestoreFile}
                    className="hidden"
                  />
                </label>
                {restoreMessage && (
                  <span className="text-xs text-[#00c853] font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {restoreMessage}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#e8e6df] dark:border-stone-800 bg-[#f5f4ee]/80 dark:bg-stone-900/50">
          <div>
            {saveSuccess && (
              <span className="text-xs text-[#00c853] font-medium flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> 设置已保存
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-stone-600 dark:text-stone-400 hover:text-[#141413] dark:hover:text-stone-200 rounded-xl hover:bg-[#e8e6df]/50 dark:hover:bg-stone-800 transition"
            >
              关闭
            </button>
            <button
              onClick={handleSaveAISettings}
              className="px-5 py-2 text-xs font-medium bg-[#da7756] hover:bg-[#c86341] text-white rounded-xl shadow-xs transition"
            >
              保存配置
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
