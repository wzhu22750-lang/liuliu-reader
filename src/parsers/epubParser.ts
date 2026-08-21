import JSZip from 'jszip';
import { Book, Chapter } from '../types';

export interface EpubParseResult {
  title: string;
  author: string;
  chapters: Chapter[];
  totalWords: number;
  coverDataUrl?: string;
}

export async function parseEpubFile(fileData: ArrayBuffer, fileName: string): Promise<EpubParseResult> {
  const zip = await JSZip.loadAsync(fileData);

  // 1. Locate container.xml
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) {
    throw new Error('无效的 EPUB 文件：未找到 META-INF/container.xml');
  }
  const containerXml = await containerFile.async('text');

  // Parse rootfile path
  const rootfilePathMatch = containerXml.match(/full-path=["']([^"']+)["']/i);
  const opfPath = rootfilePathMatch ? rootfilePathMatch[1] : 'OEBPS/content.opf';
  const opfFile = zip.file(opfPath);
  if (!opfFile) {
    throw new Error(`未找到 EPUB 元数据文件：${opfPath}`);
  }

  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
  const opfXml = await opfFile.async('text');

  // 2. Extract title & author
  let title = fileName.replace(/\.epub$/i, '').trim();
  let author = '佚名';

  const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
  if (titleMatch && titleMatch[1].trim()) {
    title = decodeXmlEntities(titleMatch[1].trim());
  }

  const creatorMatch = opfXml.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
  if (creatorMatch && creatorMatch[1].trim()) {
    author = decodeXmlEntities(creatorMatch[1].trim());
  }

  // 3. Parse manifest
  const manifestItems: Record<string, { href: string; mediaType: string }> = {};
  const manifestRegex = /<item\s+[^>]*id=["']([^"']+)["'][^>]*href=["']([^"']+)["'][^>]*media-type=["']([^"']+)["'][^>]*\/?>/gi;
  let itemMatch: RegExpExecArray | null;
  while ((itemMatch = manifestRegex.exec(opfXml)) !== null) {
    manifestItems[itemMatch[1]] = {
      href: itemMatch[2],
      mediaType: itemMatch[3],
    };
  }

  // Also try reversed attribute order if not matched
  if (Object.keys(manifestItems).length === 0) {
    const itemTagRegex = /<item\b([^>]+)>/gi;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = itemTagRegex.exec(opfXml)) !== null) {
      const tagContent = tagMatch[1];
      const idM = tagContent.match(/id=["']([^"']+)["']/i);
      const hrefM = tagContent.match(/href=["']([^"']+)["']/i);
      const mediaM = tagContent.match(/media-type=["']([^"']+)["']/i);
      if (idM && hrefM) {
        manifestItems[idM[1]] = {
          href: hrefM[1],
          mediaType: mediaM ? mediaM[1] : 'application/xhtml+xml',
        };
      }
    }
  }

  // 4. Parse Spine
  const spineItemRefs: string[] = [];
  const spineRegex = /<itemref\s+[^>]*idref=["']([^"']+)["'][^>]*\/?>/gi;
  let spineMatch: RegExpExecArray | null;
  while ((spineMatch = spineRegex.exec(opfXml)) !== null) {
    spineItemRefs.push(spineMatch[1]);
  }

  // 5. Process spine items into chapters
  const chapters: Chapter[] = [];
  let chapterIndex = 0;

  for (const idref of spineItemRefs) {
    const manifestItem = manifestItems[idref];
    if (!manifestItem) continue;

    // Decode URI path in href
    const decodedHref = decodeURIComponent(manifestItem.href);
    const chapterPath = opfDir + decodedHref;
    const chapterFile = zip.file(chapterPath) || zip.file(decodedHref);
    if (!chapterFile) continue;

    const htmlContent = await chapterFile.async('text');
    const { cleanText, chapterTitle } = extractCleanTextAndTitle(htmlContent, chapterIndex);

    if (cleanText.length < 15 && chapterIndex > 0) {
      // Skip empty or tiny placeholder page
      continue;
    }

    chapters.push({
      id: `ch_epub_${chapterIndex}`,
      index: chapterIndex,
      title: chapterTitle || `第 ${chapterIndex + 1} 节`,
      content: cleanText,
      wordCount: cleanText.replace(/\s+/g, '').length,
    });
    chapterIndex++;
  }

  if (chapters.length === 0) {
    // Fallback: search for any html/xhtml files in the zip
    const htmlFiles = Object.keys(zip.files).filter((p) => p.endsWith('.xhtml') || p.endsWith('.html'));
    for (let i = 0; i < htmlFiles.length; i++) {
      const f = zip.file(htmlFiles[i]);
      if (!f) continue;
      const html = await f.async('text');
      const { cleanText, chapterTitle } = extractCleanTextAndTitle(html, i);
      if (cleanText.length > 20) {
        chapters.push({
          id: `ch_epub_${i}`,
          index: i,
          title: chapterTitle || `章节 ${i + 1}`,
          content: cleanText,
          wordCount: cleanText.replace(/\s+/g, '').length,
        });
      }
    }
  }

  const totalWords = chapters.reduce((acc, c) => acc + c.wordCount, 0);

  return {
    title,
    author,
    chapters,
    totalWords,
  };
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function extractCleanTextAndTitle(
  html: string,
  chapterIndex: number
): { cleanText: string; chapterTitle: string } {
  let title = '';

  // Try extracting from <title> or <h1> - <h3>
  const titleTagMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleTagMatch && titleTagMatch[1].trim() && !titleTagMatch[1].toLowerCase().includes('untitled')) {
    title = decodeXmlEntities(titleTagMatch[1].trim());
  }

  const headingMatch = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  if (headingMatch && headingMatch[1].trim()) {
    const rawHeading = headingMatch[1].replace(/<[^>]+>/g, '').trim();
    if (rawHeading && rawHeading.length < 50) {
      title = decodeXmlEntities(rawHeading);
    }
  }

  // Clean HTML to pure text paragraphs
  let bodyContent = html;
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    bodyContent = bodyMatch[1];
  }

  // Remove <script>, <style>, <svg>, <nav>
  bodyContent = bodyContent
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');

  // Convert block tags to linebreaks
  bodyContent = bodyContent
    .replace(/<(?:p|div|section|article|blockquote|h[1-6]|li)[^>]*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n');

  // Strip remaining tags
  let text = bodyContent.replace(/<[^>]+>/g, '');
  text = decodeXmlEntities(text);

  // Normalize whitespace & paragraphs
  const paragraphs = text
    .split(/\r?\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const cleanText = paragraphs.join('\n\n');

  if (!title && paragraphs.length > 0 && paragraphs[0].length < 40) {
    title = paragraphs[0];
  }

  return {
    cleanText,
    chapterTitle: title || `第 ${chapterIndex + 1} 节`,
  };
}

export function createBookFromEpub(parseResult: EpubParseResult): Book {
  const now = Date.now();
  const colors = [
    'from-indigo-600 to-purple-800',
    'from-teal-600 to-emerald-900',
    'from-blue-600 to-slate-800',
    'from-rose-600 to-amber-800',
    'from-violet-600 to-cyan-900',
  ];
  const coverColor = colors[Math.abs(parseResult.title.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % colors.length];

  return {
    id: `book_epub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: parseResult.title,
    author: parseResult.author,
    coverColor,
    sourceType: 'epub',
    totalChapters: parseResult.chapters.length,
    totalWords: parseResult.totalWords,
    chapters: parseResult.chapters,
    progress: {
      chapterIndex: 0,
      chapterTitle: parseResult.chapters[0]?.title || '开始阅读',
      percentage: 0,
      scrollOffset: 0,
      lastReadTime: now,
    },
    createdAt: now,
    updatedAt: now,
    isArchived: false,
  };
}
