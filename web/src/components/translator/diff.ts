/**
 * The word diff behind "show changes": words and punctuation each keep the spaces
 * after them, and compare without those spaces, so a moved space does not mark a word.
 */

/**
 * Cells of the LCS table at most (4 MB). Up to a thousand tokens on each side, about a page of
 * text, get a word diff; beyond that the changed middle is marked as replaced as a whole.
 */
export const DIFF_TABLE_MAX = 1_000_000;

export type DiffPart = { type: 'equal' | 'insert' | 'delete'; text: string };

/**
 * Words (Unicode letters, numbers and marks, with apostrophes and hyphens), runs of punctuation
 * and line breaks, each with the spaces after it; any other character (leading spaces, a lone
 * carriage return) alone. Lossless, so offsets into the tokens are offsets into the text.
 */
const TOKEN =
  /[\p{L}\p{N}\p{M}_'\u2019-]+[ \t]*|\r?\n[ \t]*|[^\p{L}\p{N}\p{M}_'\u2019\s-]+[ \t]*|[\s\S]/gu;

function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

const norm = (token: string): string => token.trimEnd();

function merge(parts: DiffPart[]): DiffPart[] {
  const merged: DiffPart[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last?.type === part.type) last.text += part.text;
    else merged.push({ ...part });
  }
  return merged;
}

/**
 * What changed from `before` to `after`, as the longest common subsequence of their tokens.
 * Adjacent parts of one type are merged; the text of `equal` parts is the new text's.
 */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  // The common start and end need no table; texts that were only edited in places stay cheap.
  let start = 0;
  while (start < a.length && start < b.length && norm(a[start]!) === norm(b[start]!)) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    norm(a[a.length - 1 - end]!) === norm(b[b.length - 1 - end]!)
  ) {
    end++;
  }
  const midA = a.slice(start, a.length - end);
  const midB = b.slice(start, b.length - end);
  const rows = midA.length;
  const cols = midB.length;
  const parts: DiffPart[] = b.slice(0, start).map((text) => ({ type: 'equal', text }));

  if (rows * cols > DIFF_TABLE_MAX) {
    if (rows > 0) parts.push({ type: 'delete', text: midA.join('') });
    if (cols > 0) parts.push({ type: 'insert', text: midB.join('') });
  } else {
    // LCS lengths of every pair of prefixes, midA[..i] and midB[..j].
    const width = cols + 1;
    const table = new Uint32Array((rows + 1) * width);
    for (let i = 1; i <= rows; i++) {
      for (let j = 1; j <= cols; j++) {
        table[i * width + j] =
          norm(midA[i - 1]!) === norm(midB[j - 1]!)
            ? table[(i - 1) * width + j - 1]! + 1
            : Math.max(table[(i - 1) * width + j]!, table[i * width + j - 1]!);
      }
    }
    const middle: DiffPart[] = [];
    let i = rows;
    let j = cols;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && norm(midA[i - 1]!) === norm(midB[j - 1]!)) {
        middle.push({ type: 'equal', text: midB[j - 1]! });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || table[i * width + j - 1]! >= table[(i - 1) * width + j]!)) {
        middle.push({ type: 'insert', text: midB[j - 1]! });
        j--;
      } else {
        middle.push({ type: 'delete', text: midA[i - 1]! });
        i--;
      }
    }
    parts.push(...middle.reverse());
  }
  parts.push(...b.slice(b.length - end).map((text) => ({ type: 'equal' as const, text })));
  return merge(parts);
}

/** One piece of the full diff view: unchanged text, a deletion, an insertion, or the arrow between. */
export type ChangePiece =
  { type: 'equal'; text: string } | { type: 'delete' | 'insert'; text: string; trailing: string } | { type: 'arrow' };

/** Text with its trailing spaces apart, so marks cover the words only. */
function split(text: string): { text: string; trailing: string } {
  const trimmed = text.replace(/[ \t]+$/, '');
  return { text: trimmed, trailing: text.slice(trimmed.length) };
}

/**
 * The diff as the full view shows it: each run of deletions paired with the insertions that
 * replace it, `deleted → inserted`, one pair after another.
 */
export function changePieces(parts: readonly DiffPart[]): ChangePiece[] {
  const pieces: ChangePiece[] = [];
  let k = 0;
  while (k < parts.length) {
    const part = parts[k]!;
    if (part.type === 'equal') {
      pieces.push({ type: 'equal', text: part.text });
      k++;
      continue;
    }
    const deletes: DiffPart[] = [];
    while (k < parts.length && parts[k]!.type === 'delete') deletes.push(parts[k++]!);
    const inserts: DiffPart[] = [];
    while (k < parts.length && parts[k]!.type === 'insert') inserts.push(parts[k++]!);
    for (let p = 0; p < Math.max(deletes.length, inserts.length); p++) {
      const deleted = deletes[p];
      const inserted = inserts[p];
      if (deleted) pieces.push({ type: 'delete', ...split(deleted.text) });
      if (deleted && inserted) pieces.push({ type: 'arrow' });
      if (inserted) pieces.push({ type: 'insert', ...split(inserted.text) });
    }
  }
  return pieces;
}

/** For each character of `after`, whether it was inserted or changed since `before`. */
export function insertedCharacters(before: string, after: string): boolean[] {
  const mask = new Array<boolean>(after.length).fill(false);
  let offset = 0;
  for (const part of diffWords(before, after)) {
    if (part.type === 'delete') continue;
    if (part.type === 'insert') mask.fill(true, offset, offset + part.text.length);
    offset += part.text.length;
  }
  return mask;
}
