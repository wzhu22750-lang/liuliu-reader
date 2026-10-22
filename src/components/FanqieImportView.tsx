import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  X,
  Search,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  DownloadCloud,
  Download,
  Loader2,
  RefreshCw,
  PlugZap,
  FileText,
} from 'lucide-react';
import { Book } from '../types';
import { getAllBooks, saveBook } from '../db/indexedDB';
import { createBookFromTxt, parseTxtContent } from '../parsers/txtParser';
import { parseNativeExport } from '../parsers/nativeExport';
import { stripFanqieHeader } from '../parsers/fanqieTxt';
import { isIntegratedRuntime, integratedPendingJobs, integratedForgetJob, integratedCancelJob } from '../platform/integratedFanqie';
import {
  FANQIE_TERMINAL_STATUSES,
  FanqieBook,
  FanqieFile,
  FanqieJob,
  FanqieSearchItem,
  FanqieStatus,
  fanqieFileUrl,
  getFanqieBook,
  getFanqieFileText,
  getFanqieJob,
  getFanqieStatus,
  searchFanqie,
  startFanqieDownload,
} from '../api/fanqie';

interface Props {
  onClose: () => void;
  onImported?: (book: Book) => void;
  onOpenBook: (book: Book) => void;
}

type Stage = 'search' | 'book' | 'downloading' | 'done';

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '下载中',
  done: '已完成',
  success: '已完成',
  completed: '已完成',
  partial: '部分完成',
  failed: '失败',
  error: '失败',
  canceled: '已取消',
  cancelled: '已取消',
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const formatCount = (value: string) => {
  const n = Number(String(value || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n.toLocaleString('zh-CN') : '';
};

const isDone = (status: string) => /^(done|success|completed)$/i.test(status);

export const FanqieImportView: React.FC<Props> = ({ onClose, onImported, onOpenBook }) => {
  const [status, setStatus] = useState<FanqieStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [serviceError, setServiceError] = useState<string | null>(null);

  const [keyword, setKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<FanqieSearchItem[]>([]);
  const [searchMeta, setSearchMeta] = useState('');

  const [stage, setStage] = useState<Stage>('search');
  const [detail, setDetail] = useState<FanqieBook | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(0);

  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<FanqieJob | null>(null);
  const [downloadedFile, setDownloadedFile] = useState<FanqieFile | null>(null);
  const [imported, setImported] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);

  const detailRef = useRef<FanqieBook | null>(null);
  const jobRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null);

  const loadStatus = async () => {
    setStatusLoading(true);
    try {
      const next = await getFanqieStatus();
      setStatus(next);
      setServiceError(null);
    } catch (err: any) {
      setStatus(null);
      setServiceError(err.message || '无法连接本地下载服务');
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    if (stage !== 'search') scrollRef.current?.scrollTo({ top: 0 });
  }, [stage]);

  const integrated = isIntegratedRuntime();
  const [pendingJobs, setPendingJobs] = useState(() => integrated ? integratedPendingJobs() : []);
  const nativeSearch = status?.backend === 'android-public-api';
  const downloadAvailable = status?.capabilities?.download !== false;
  const deviceReady = Boolean(status?.ok && (integrated || nativeSearch || status.device?.installed));

  const handleSearch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const q = keyword.trim();
    if (!q || searching) return;
    if (!deviceReady) {
      setError(status?.error || serviceError || '设备尚未就绪');
      return;
    }
    setSearching(true);
    setError(null);
    setResults([]);
    setSearchMeta(integrated || nativeSearch ? '正在查询书籍…' : '正在检索，首次调用需要唤醒设备上的 APK…');
    try {
      const data = await searchFanqie(q);
      setResults(data.items);
      setSearchMeta(`共 ${data.items.length} 条结果 · ${(data.elapsedMs / 1000).toFixed(1)} 秒`);
    } catch (err: any) {
      setSearchMeta('');
      setError(err.message || '搜索失败');
    } finally {
      setSearching(false);
    }
  };

  const handleSelectBook = async (item: FanqieSearchItem) => {
    if (loadingDetail) return;
    setLoadingDetail(true);
    setError(null);
    try {
      const book = await getFanqieBook(item.book_id);
      detailRef.current = book;
      setDetail(book);
      setStart(1);
      setEnd(book.chapterCount);
      setJob(null);
      setDownloadedFile(null);
      setImported(null);
      setStage('book');
    } catch (err: any) {
      setError(err.message || '目录加载失败');
    } finally {
      setLoadingDetail(false);
    }
  };

  const pollTimer = useRef<number | null>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    // StrictMode mounts effects twice in development; re-arm the flag on mount.
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, []);

  const importDownloadedFile = async (file: FanqieFile) => {
    const book = detailRef.current;
    if (!book) return;
    setDownloadedFile(file);
    try {
      const raw = await getFanqieFileText(file.id);
      const saved = integrated ? integratedPendingJobs().find(item => item.ticket.jobId === file.id) : null;
      const parsed = integrated
        ? parseNativeExport(raw, book.chapters.slice((saved?.ticket.start ?? start) - 1, saved?.ticket.end ?? end), book.book_name, book.author)
        : parseTxtContent(stripFanqieHeader(raw), `${book.book_name} - ${book.author}.txt`);
      if (integrated && parsed.chapters.length !== file.validation.expectedChapters) {
        throw new Error(`章节拆分结果与下载目录不一致（${parsed.chapters.length}/${file.validation.expectedChapters}），未自动入库`);
      }
      const existing = (await getAllBooks()).find(
        item => item.title === book.book_name && item.author === book.author,
      );
      const shouldImport = !existing || confirm(`书库中已有《${book.book_name}》（${book.author}），仍要再导入一份吗？`);
      if (shouldImport) {
        const created = createBookFromTxt(parsed, book.book_name, book.author);
        if (book.cover_url) created.coverUrl = book.cover_url;
        await saveBook(created);
        setImported(created);
        onImported?.(created);
      }
      if (integrated && jobRef.current) {
        integratedForgetJob(jobRef.current);
        setPendingJobs(integratedPendingJobs());
      }
      setStage('done');
    } catch (err: any) {
      setError(err.message || '导入书库失败');
      setStage('done');
    } finally {
      setBusy(false);
    }
  };

  const pollJob = async (jobId: string) => {
    if (cancelled.current) return;
    try {
      const next = await getFanqieJob(jobId);
      if (cancelled.current) return;
      setJob(next);
      if (next.file) {
        await importDownloadedFile(next.file);
        return;
      }
      if (FANQIE_TERMINAL_STATUSES.has(next.status.toLowerCase())) {
        setBusy(false);
        if (isDone(next.status)) {
          if (next.error) setError(next.error);
          setStage('done');
        } else {
          setError(next.error || `任务状态：${STATUS_LABELS[next.status] || next.status}`);
          setStage('done');
        }
        return;
      }
    } catch (err: any) {
      if (!cancelled.current) {
        setError(err.message || '读取任务进度失败');
        setBusy(false);
        setStage('done');
      }
      return;
    }
    pollTimer.current = window.setTimeout(() => void pollJob(jobId), 1500);
  };

  const handleDownload = async () => {
    if (!detail || busy) return;
    if (!downloadAvailable) { setError('当前版本支持搜索和目录查看，完整正文下载尚未接入'); return; }
    if (!(start >= 1 && end >= start && end <= detail.chapterCount)) {
      setError(`章节范围无效：应在 1–${detail.chapterCount} 之间`);
      return;
    }
    setBusy(true);
    setError(null);
    setJob(null);
    setDownloadedFile(null);
    setImported(null);

    const payload = { bookId: detail.book_id, start, end };
    try {
      let ticket;
      try {
        ticket = await startFanqieDownload(payload);
      } catch (err: any) {
        if (err?.status === 409 && err?.payload?.locked) {
          const confirmed = confirm(`${err.payload.error}\n\n${err.payload.hint}\n\n仍要尝试下载吗？`);
          if (!confirmed) {
            setBusy(false);
            return;
          }
          ticket = await startFanqieDownload({ ...payload, confirmLocked: true });
        } else {
          throw err;
        }
      }
      jobRef.current = ticket.jobId;
      if (integrated) setPendingJobs(integratedPendingJobs());
      setStage('downloading');
      void pollJob(ticket.jobId);
    } catch (err: any) {
      setError(err.message || '创建下载任务失败');
      setBusy(false);
    }
  };

  const resetToSearch = () => {
    setStage('search');
    setDetail(null);
    detailRef.current = null;
    setJob(null);
    setError(null);
    setDownloadedFile(null);
    setImported(null);
    setBusy(false);
  };

  const requestClose = () => {
    if (stage === 'downloading' && !imported) {
      const leave = confirm(integrated ? '下载任务会继续执行，下次打开在线找书可恢复查看，确定关闭吗？' : '下载任务仍在设备上执行。关闭本页后需要重新创建任务才能取回结果，确定关闭吗？');
      if (!leave) return;
    }
    onClose();
  };

  const backToBook = () => {
    setStage('book');
    setError(null);
    setJob(null);
    setDownloadedFile(null);
    setImported(null);
    setBusy(false);
  };

  const statusNotice = (() => {
    if (statusLoading) {
      return { tone: 'muted', text: integrated ? '正在初始化本机下载引擎…' : '正在检测本机设备与番茄器 APK…' };
    }
    if (serviceError) {
      return {
        tone: 'error',
        text: integrated || Capacitor.isNativePlatform()
          ? serviceError
          : `${serviceError}。在线找书需要电脑运行 Vite 服务并通过 ADB 连接 Android 下载器；纯静态部署不支持此功能。`,
      };
    }
    if (!status?.ok) {
      return { tone: 'error', text: status?.error || '设备尚未就绪' };
    }
    if (integrated) return { tone: 'ok', text: '本机引擎已就绪 · 搜索、下载与阅读均在此应用完成' };
    if (status.backend === 'android-public-api') return { tone: 'ok', text: '手机找书已就绪 · 支持搜索和目录查看' };
    if (!status.device?.installed) {
      return { tone: 'error', text: `设备 ${status.device?.serial} 未安装番茄器 APK，无法检索。` };
    }
    return { tone: 'ok', text: `已连接 ${status.device.serial} · 番茄器代理就绪` };
  })();

  const chapterRangeCount = detail ? Math.max(0, Math.min(detail.chapterCount, end) - Math.max(1, start) + 1) : 0;

  return (
    <section
      className="ink-fanqie-import fixed inset-0 z-[60] overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ink-fanqie-title"
      ref={scrollRef}
    >
      <div className="ink-fanqie-shell">
        <header className="ink-fanqie-header">
          <div>
            <p className="ink-eyebrow">LIULIU READER · ONLINE SEARCH</p>
            <h2 id="ink-fanqie-title">在线找书</h2>
            <p>{nativeSearch ? '在手机上检索书名、作者和章节目录。' : '检索书名、选择章节，TXT 下载完成后自动拆分入库。'}</p>
          </div>
          <button type="button" className="ink-icon-button" onClick={requestClose} aria-label="关闭在线找书">
            <X className="w-5 h-5" />
          </button>
        </header>

        <main className="ink-fanqie-body">
          <div className={`ink-fanqie-status is-${statusNotice.tone}`} role="status">
            <PlugZap className="w-4 h-4" aria-hidden="true" />
            <span>{statusNotice.text}</span>
            <button type="button" onClick={() => void loadStatus()} aria-label="重新检测设备">
              <RefreshCw className={`w-3.5 h-3.5 ${statusLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {error && (
            <div className="ink-fanqie-notice" role="alert">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}

          {stage === 'search' && (
            <>
              {integrated && pendingJobs.length > 0 && <section className="ink-fanqie-section" aria-label="待处理下载">
                <p>上次的下载任务</p>
                {pendingJobs.map(saved => <div key={saved.ticket.jobId} className="ink-fanqie-input-row">
                  <span>《{saved.book.book_name}》第 {saved.ticket.start}–{saved.ticket.end} 项</span>
                  <button type="button" onClick={() => {
                    detailRef.current = saved.book; setDetail(saved.book); setStart(saved.ticket.start); setEnd(saved.ticket.end);
                    jobRef.current = saved.ticket.jobId; setError(null); setImported(null); setDownloadedFile(null); setBusy(true);
                    setStage('downloading'); void pollJob(saved.ticket.jobId);
                  }}>查看进度 / 入库</button>
                  <button type="button" onClick={() => { integratedForgetJob(saved.ticket.jobId); setPendingJobs(integratedPendingJobs()); }}>移除记录</button>
                </div>)}
              </section>}
              <form className="ink-fanqie-section" onSubmit={handleSearch}>
                <div className="ink-fanqie-label-row">
                  <span>书名检索</span>
                  <span>{integrated ? '由应用内的番茄器引擎检索' : nativeSearch ? '直接查询，无需连接电脑' : '由设备上的番茄器完成检索'}</span>
                </div>
                <div className="ink-fanqie-input-row">
                  <Search className="w-4 h-4" aria-hidden="true" />
                  <input
                    type="search"
                    value={keyword}
                    onChange={event => setKeyword(event.target.value)}
                    placeholder="输入书名或关键词，例如：红楼梦"
                    aria-label="输入书名关键词"
                    disabled={searching}
                  />
                  <button type="submit" disabled={searching || !keyword.trim() || !deviceReady}>
                    {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    {searching ? '检索中' : '搜索'}
                  </button>
                </div>
                {searchMeta && <p className="ink-fanqie-meta">{searchMeta}</p>}
              </form>

              {loadingDetail && (
                <div className="ink-fanqie-loading">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>正在载入章节目录…</span>
                </div>
              )}

              {!loadingDetail && results.length > 0 && (
                <ul className="ink-fanqie-results" aria-label="搜索结果">
                  {results.map(item => (
                    <li key={item.book_id}>
                      <button type="button" className="ink-fanqie-result" onClick={() => void handleSelectBook(item)}>
                        <span className="ink-fanqie-cover" aria-hidden="true">
                          <span>{item.book_name.slice(0, 1)}</span>
                          {item.cover_url && (
                            <img
                              src={item.cover_url}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={event => { event.currentTarget.style.display = 'none'; }}
                            />
                          )}
                        </span>
                        <span className="ink-fanqie-result-copy">
                          <strong>{item.book_name}</strong>
                          <span>
                            {item.author || '佚名'}
                            {item.status ? ` · ${item.status}` : ''}
                            {formatCount(item.word_count) ? ` · ${formatCount(item.word_count)} 字` : ''}
                            {formatCount(item.read_count) ? ` · ${formatCount(item.read_count)} 阅读` : ''}
                          </span>
                          {item.abstract && <small>{item.abstract}</small>}
                        </span>
                        <DownloadCloud className="ink-fanqie-result-icon" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {!loadingDetail && !searching && results.length === 0 && (
                <div className="ink-fanqie-empty">
                  <BookOpen className="w-6 h-6" aria-hidden="true" />
                  <p>{nativeSearch ? '搜索结果会显示在这里。选择一本书查看简介和目录。' : '搜索结果会显示在这里。选择一本书后可限定章节范围再下载。'}</p>
                </div>
              )}
            </>
          )}

          {stage === 'book' && detail && (
            <>
              <button type="button" className="ink-fanqie-back" onClick={resetToSearch}>
                <ArrowLeft className="w-4 h-4" /> 返回搜索结果
              </button>

              <section className="ink-fanqie-book">
                <div className="ink-fanqie-book-head">
                  <span className="ink-fanqie-cover is-large" aria-hidden="true">
                    <span>{detail.book_name.slice(0, 1)}</span>
                    {detail.cover_url && (
                      <img
                        src={detail.cover_url}
                        alt=""
                        referrerPolicy="no-referrer"
                        onError={event => { event.currentTarget.style.display = 'none'; }}
                      />
                    )}
                  </span>
                  <div>
                    <h3>{detail.book_name}</h3>
                    <p>{detail.author || '佚名'}</p>
                    <p className="ink-fanqie-meta">
                      {detail.status ? `${detail.status} · ` : ''}
                      {formatCount(detail.word_count) ? `${formatCount(detail.word_count)} 字 · ` : ''}
                      {detail.chapterCount} 个目录项
                    </p>
                  </div>
                </div>
                {detail.abstract && <p className="ink-fanqie-abstract">{detail.abstract}</p>}
              </section>

              {downloadAvailable ? <section className="ink-fanqie-section" aria-labelledby="ink-fanqie-range-label">
                <div className="ink-fanqie-label-row">
                  <span id="ink-fanqie-range-label">下载范围</span>
                  <span>按目录顺序，包含起止两项</span>
                </div>
                <div className="ink-fanqie-range">
                  <label>
                    <span>起始章节</span>
                    <input
                      type="number"
                      min={1}
                      max={detail.chapterCount}
                      value={start}
                      onChange={event => setStart(Math.max(1, Number(event.target.value) || 1))}
                    />
                  </label>
                  <label>
                    <span>结束章节</span>
                    <input
                      type="number"
                      min={1}
                      max={detail.chapterCount}
                      value={end}
                      onChange={event => setEnd(Math.max(1, Number(event.target.value) || 1))}
                    />
                  </label>
                  <button
                    type="button"
                    className="ink-fanqie-ghost"
                    onClick={() => { setStart(1); setEnd(detail.chapterCount); }}
                  >
                    全部
                  </button>
                  <button
                    type="button"
                    className="ink-fanqie-primary"
                    onClick={() => void handleDownload()}
                    disabled={busy || chapterRangeCount <= 0}
                  >
                    <Download className="w-4 h-4" />
                    下载并入库
                  </button>
                </div>
                <p className="ink-fanqie-meta">
                  将下载 {chapterRangeCount} 项
                  {detail.lockedCount > 0 ? ` · 全书 ${detail.lockedCount} 项被来源标记受限，不会绕过` : ''}
                </p>
              </section> : (
                <section className="ink-fanqie-section">
                  <p className="ink-fanqie-meta">当前版本支持找书和目录查看，整本下载尚未接入。你仍可从书架导入本地 TXT / EPUB 阅读。</p>
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm">查看 {detail.chapterCount} 个目录项 · {detail.lockedCount} 项受限</summary>
                    <ol className="mt-3 max-h-80 overflow-y-auto text-xs leading-7">
                      {detail.chapters.map(chapter => <li key={chapter.item_id}>{chapter.title}{chapter.locked ? ' · 受限' : ''}</li>)}
                    </ol>
                  </details>
                </section>
              )}

            </>
          )}

          {stage === 'downloading' && detail && (
            <section className="ink-fanqie-progress" aria-live="polite">
              <div className="ink-fanqie-progress-heading">
                <div>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>{job?.message || '正在创建下载任务'}</span>
                </div>
                <strong>{Math.max(0, Math.min(100, Number(job?.progress) || 0))}%</strong>
              </div>
              <div
                className="ink-fanqie-meter"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.max(0, Math.min(100, Number(job?.progress) || 0))}
              >
                <span style={{ width: `${Math.max(0, Math.min(100, Number(job?.progress) || 0))}%` }} />
              </div>
              <p>
                《{detail.book_name}》第 {start}–{end} 项 · 共 {chapterRangeCount} 项
              </p>
              <p>{integrated ? '任务在本应用内执行。关闭此页后，可从在线找书恢复查看。' : '任务在设备上的番茄器内执行，完成前请保持本页打开。'}</p>
              {integrated && jobRef.current && <button type="button" className="ink-fanqie-ghost" onClick={async () => { try { await integratedCancelJob(jobRef.current!); } catch (err: any) { setError(err.message); } }}>取消任务</button>}
            </section>
          )}

          {stage === 'done' && detail && (
            <section className="ink-fanqie-done" aria-live="polite">
              <div className="ink-fanqie-done-heading">
                {imported ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                <h3>{imported ? '已下载并加入书架' : '下载结束，未导入'}</h3>
              </div>
              <p className="ink-fanqie-meta">
                《{detail.book_name}》第 {start}–{end} 项
                {job?.file ? ` · ${formatBytes(job.file.bytes)}` : ''}
                {imported ? ` · 识别 ${imported.chapters.length} 章` : ''}
              </p>
              {job?.file?.validation && (
                <p className="ink-fanqie-meta">
                  结构校验：{job.file.validation.verifiedChapters}/{job.file.validation.expectedChapters} 项标题按序命中
                  {job.file.validation.warnings.length > 0 ? ` · ${job.file.validation.warnings.length} 条提示` : ''}
                </p>
              )}
              {job?.file?.validation?.warnings?.length ? (
                <ul className="ink-fanqie-warnings">
                  {job.file.validation.warnings.slice(0, 4).map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              {error && (
                <div className="ink-fanqie-notice" role="alert">
                  <AlertCircle className="w-4 h-4" />
                  <span>{error}</span>
                </div>
              )}
              <div className="ink-fanqie-done-actions">
                {imported && (
                  <button type="button" className="ink-fanqie-primary" onClick={() => onOpenBook(imported)}>
                    <BookOpen className="w-4 h-4" /> 开始阅读
                  </button>
                )}
                {downloadedFile && !integrated && (
                  <a className="ink-fanqie-ghost" href={fanqieFileUrl(downloadedFile.id)} download={downloadedFile.name}>
                    <FileText className="w-4 h-4" /> 下载 TXT
                  </a>
                )}
                <button type="button" className="ink-fanqie-ghost" onClick={resetToSearch}>
                  继续找书
                </button>
                <button type="button" className="ink-fanqie-ghost" onClick={backToBook}>
                  重新选择范围
                </button>
              </div>
            </section>
          )}
        </main>
      </div>
    </section>
  );
};
