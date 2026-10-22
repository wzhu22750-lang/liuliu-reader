import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import 'fake-indexeddb/auto';
import { parseTxtContent, createBookFromTxt } from '../src/parsers/txtParser';
import { parseEpubFile, createBookFromEpub } from '../src/parsers/epubParser';
import { saveBook, getBookById } from '../src/db/indexedDB';

// Original synthetic fixtures exercise local file imports, not network success.
test('existing TXT import preserves Chinese chapter order and commits readable books', async () => {
  const parsed = parseTxtContent('第一章 初见\r\n本章是导入回归测试的原创短文。\r\n\r\n第二章 重逢\r\n后续内容同样使用测试文字。', 'TXT回归.txt');
  assert.deepEqual(parsed.chapters.map(chapter => chapter.title), ['第一章 初见', '第二章 重逢']);
  const book = createBookFromTxt(parsed, 'TXT回归', '测试作者');
  await saveBook(book);
  const saved = await getBookById(book.id);
  assert.equal(saved?.totalChapters, 2);
  assert.equal(saved?.chapters[1].content, '后续内容同样使用测试文字。');
  assert.equal(saved?.progress.chapterIndex, 0);
  assert.equal(saved?.sourceType, 'txt');
});

test('existing EPUB import honors metadata, spine order and entity decoding', async () => {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', '<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>EPUB &amp; 回归</dc:title><dc:creator>测试作者</dc:creator></metadata><manifest><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>');
  zip.file('OEBPS/one.xhtml', '<html><body><h1>第一章</h1><p>这是第一章的原创回归测试文字。</p><p>甲 &amp; 乙。</p></body></html>');
  zip.file('OEBPS/two.xhtml', '<html><body><h1>第二章</h1><p>这是第二章的原创回归测试文字，内容足够识别为正常章节。</p></body></html>');
  const parsed = await parseEpubFile(await zip.generateAsync({ type: 'arraybuffer' }), 'original.epub');
  assert.equal(parsed.title, 'EPUB & 回归');
  assert.equal(parsed.author, '测试作者');
  assert.deepEqual(parsed.chapters.map(chapter => chapter.title), ['第一章', '第二章']);
  assert.match(parsed.chapters[0].content, /甲 & 乙/);
  const book = createBookFromEpub(parsed);
  await saveBook(book);
  assert.equal((await getBookById(book.id))?.sourceType, 'epub');
  await assert.rejects(parseEpubFile(await new JSZip().generateAsync({ type: 'arraybuffer' }), 'broken.epub'), /container.xml/);
});
