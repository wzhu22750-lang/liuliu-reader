import { TOMATO_MAPPINGS, TomatoMapping } from './tomatoMappings';

const PRIVATE_USE_START = 0xe000;
const PRIVATE_USE_END = 0xf8ff;

export type TomatoDecodeStatus = 'clean' | 'decoded' | 'partial' | 'unsupported';

export interface TomatoDecodeResult {
  content: string;
  status: TomatoDecodeStatus;
  mappingId?: string;
  privateUseCount: number;
  decodedCount: number;
  unknownCount: number;
}

export function isPrivateUseCodePoint(codePoint: number): boolean {
  return codePoint >= PRIVATE_USE_START && codePoint <= PRIVATE_USE_END;
}

export function countPrivateUseCharacters(text: string): number {
  let count = 0;
  for (const char of text) {
    if (isPrivateUseCodePoint(char.codePointAt(0) || 0)) count++;
  }
  return count;
}

function scoreMapping(text: string, mapping: TomatoMapping) {
  let privateUseCount = 0;
  let knownCount = 0;
  let unknownCount = 0;

  for (const char of text) {
    const codePoint = char.codePointAt(0) || 0;
    if (codePoint < mapping.start || codePoint > mapping.end) continue;
    privateUseCount++;
    const replacement = mapping.chars[codePoint - mapping.start];
    if (replacement && replacement !== '?') knownCount++;
    else unknownCount++;
  }

  return { privateUseCount, knownCount, unknownCount };
}

function chooseMapping(text: string): TomatoMapping | undefined {
  const candidates = TOMATO_MAPPINGS
    .map((mapping) => ({ mapping, score: scoreMapping(text, mapping) }))
    .filter(({ score }) => score.privateUseCount > 0)
    .sort((a, b) => {
      if (b.score.knownCount !== a.score.knownCount) return b.score.knownCount - a.score.knownCount;
      if (a.score.unknownCount !== b.score.unknownCount) return a.score.unknownCount - b.score.unknownCount;
      return b.score.privateUseCount - a.score.privateUseCount;
    });

  return candidates[0]?.mapping;
}

export function decodeTomatoText(text: string): TomatoDecodeResult {
  const privateUseCount = countPrivateUseCharacters(text);
  if (privateUseCount === 0) {
    return {
      content: text,
      status: 'clean',
      privateUseCount: 0,
      decodedCount: 0,
      unknownCount: 0,
    };
  }

  const mapping = chooseMapping(text);
  if (!mapping) {
    return {
      content: text,
      status: 'unsupported',
      privateUseCount,
      decodedCount: 0,
      unknownCount: privateUseCount,
    };
  }

  let decodedCount = 0;
  let unknownCount = 0;
  const content = Array.from(text, (char) => {
    const codePoint = char.codePointAt(0) || 0;
    if (codePoint < mapping.start || codePoint > mapping.end) return char;

    const replacement = mapping.chars[codePoint - mapping.start];
    if (!replacement || replacement === '?') {
      unknownCount++;
      return char;
    }

    decodedCount++;
    return replacement;
  }).join('');

  return {
    content,
    status: unknownCount === 0 ? 'decoded' : 'partial',
    mappingId: mapping.id,
    privateUseCount,
    decodedCount,
    unknownCount,
  };
}

export function assertTomatoTextExportable(text: string): void {
  const result = decodeTomatoText(text);
  if (result.status === 'unsupported' || result.status === 'partial') {
    throw new Error(
      `正文仍包含 ${result.unknownCount} 个未解码字符${result.mappingId ? `（映射 ${result.mappingId}）` : ''}，已阻止导出乱码文件。`
    );
  }
}
