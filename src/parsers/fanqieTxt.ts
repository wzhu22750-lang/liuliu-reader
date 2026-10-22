/**
 * The APK prefixes every export with a "书籍信息" block. The reader already has
 * canonical title/author from the directory response, so drop that block before
 * chapter splitting to avoid a fake "序章 / 前言" chapter holding the blurb.
 */
export function stripFanqieHeader(text: string): string {
  const normalized = text.replace(/^\uFEFF/, '');
  if (!/^\s*书籍信息/.test(normalized)) return normalized;

  const lines = normalized.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    if (/^[—\-─]{6,}\s*$/.test(lines[i].trim())) {
      const rest = lines.slice(i + 1).join('\n').trim();
      return rest || normalized;
    }
  }
  return normalized;
}
