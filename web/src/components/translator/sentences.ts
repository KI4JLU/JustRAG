/**
 * Sentences of a text: the text is sent sentence by sentence,
 * so a result lines up with its source, a live edit only redoes the sentences that changed, and a
 * click on a sentence of the result can offer other wordings of just that sentence.
 */

/** Abbreviations after which a full stop does not end a sentence. */
const ABBREVIATIONS = [
  'z.b',
  'u.a',
  'd.h',
  'bzw',
  'etc',
  'vgl',
  'usw',
  'ca',
  'inkl',
  'exkl',
  'm.e',
  'i.d.r',
  'u.v.m',
  'o.ä',
  'u.ä',
  's.o',
  'v.a',
  'dr',
  'prof',
  'st',
  'fr',
  'hr',
  'dipl',
  'ing',
  'mag',
  'nr',
  'no',
  'jan',
  'feb',
  'mrz',
  'mär',
  'apr',
  'mai',
  'jun',
  'jul',
  'aug',
  'sep',
  'okt',
  'nov',
  'dez',
  'min',
  'std',
  'sek',
  'tel',
  's',
  'p.a',
  'v.v',
  'a.d',
  'o.g',
];

/** Titles, after which a sentence never ends. */
const TITLE = /^(dr|prof|st|fr|hr|dipl|ing|mag|nr|no)$/i;

/** A text with markup is split after closing block tags instead, to keep its layout. */
const MARKUP = /<[a-z/][^>]*>/i;
const MARKUP_CHUNKS =
  /[\s\S]*?(?:<\/(?:p|h[1-6]|div|li|tr|section|article|header|footer|td|table|ul|ol|blockquote|pre|hr)>|-->)\s*|[\s\S]+/g;

/** Whether a text looks like HTML, which the sentence tools then leave in blocks. */
export function isMarkup(text: string): boolean {
  return text.includes('<') && text.includes('>') && MARKUP.test(text);
}

/**
 * Splits a text into sentences, each keeping its punctuation and the whitespace after it, so
 * that joined they give the text back. Abbreviations, titles, ordinals and initials do not end a
 * sentence unless the next word starts with a capital letter. A line break always ends a
 * sentence: a heading or a list item has no full stop, and a model asked to translate a sentence
 * that spans lines hands it back on one line, which loses the paragraphs of the text.
 */
export function splitIntoSentences(text: string): string[] {
  if (!text) return [];
  if (isMarkup(text)) {
    const chunks = text.match(MARKUP_CHUNKS);
    return chunks && chunks.length > 0 ? chunks : [text];
  }

  const sentences: string[] = [];
  // Blank lines at the start have no sentence before them to end with; they join the first one.
  let leading = '';
  // A line with the line breaks after it.
  for (const line of text.match(/[^\n]*\n+|[^\n]+$/g) ?? [text]) {
    if (line.trim()) {
      sentences.push(...splitLine(leading + line));
      leading = '';
    } else if (sentences.length > 0) {
      // A line of spaces only belongs to the whitespace after the sentence before it.
      sentences[sentences.length - 1] += line;
    } else {
      leading += line;
    }
  }
  if (sentences.length === 0) return [text.trim()];
  return sentences;
}

/** The sentences of one line (with the line breaks after it), by their punctuation. */
function splitLine(text: string): string[] {
  const parts = text.match(/.*?([.!?]+(?:\s+|$))|.+$/gs) ?? [];
  const result: string[] = [];
  let buffer = '';
  parts.forEach((part, index) => {
    buffer += part;
    const current = buffer.trim();
    const next = parts[index + 1] ?? '';
    const nextTrimmed = next.trim();
    const nextFirst = nextTrimmed.charAt(0);
    const nextUpper = !!nextFirst && /[A-ZÄÖÜ]/.test(nextFirst);

    const words = current.split(/\s+/);
    const lastPart = words[words.length - 1] ?? '';
    const lastWord = lastPart.toLowerCase().replace(/\.+$/, '');
    const secondLast = words.length > 1 ? (words[words.length - 2] ?? '').toLowerCase().replace(/\.+$/, '') : '';
    const nextWord = (nextTrimmed.split(/\s+/)[0] ?? '').replace(/\.+$/, '');
    const lookahead = `${lastWord}.${nextWord}`.replace(/\s/g, '').toLowerCase();

    let abbreviation =
      ABBREVIATIONS.includes(lastWord) || ABBREVIATIONS.includes(lastPart.toLowerCase().replace(/[.]$/, ''));
    if (!abbreviation && lastWord.length === 1 && /[a-z]/i.test(lastWord)) abbreviation = true;
    if (ABBREVIATIONS.includes(`${secondLast}.${lastWord}`.replace(/\s/g, ''))) abbreviation = true;
    const digit = /^\d+$/.test(lastWord);
    if (digit) abbreviation = true;

    let breaks = true;
    if (ABBREVIATIONS.includes(lookahead) || lookahead === 'z.b') breaks = false;
    else if (abbreviation) {
      if (TITLE.test(lastWord)) breaks = false;
      else if (!nextUpper && next) breaks = false;
      else if (digit && nextUpper && next.length > 1) breaks = false;
    }

    if (breaks || !next) {
      result.push(buffer);
      buffer = '';
    }
  });
  if (buffer) result.push(buffer);
  return result.length > 0 ? result : [text.trim()];
}

/** Comments, tags, links, words (Unicode letters, numbers, marks), punctuation, whitespace, and any other character alone. */
const TOKEN =
  /<!--[\s\S]*?-->|<\/?[A-Za-z][^<>]*>|https?:\/\/[^\s<]+|[\p{L}\p{N}\p{M}_]+(?:[-.'\u2019][\p{L}\p{N}\p{M}_]+)*|[^\p{L}\p{N}\p{M}_\s<]+|\s+|[\s\S]/gu;

/**
 * A sentence as words, tags, links, punctuation and the whitespace between them. Lossless: a
 * character that is none of those (a `<` that starts no tag, a stray control character) is a
 * token of its own, so the tokens joined give the sentence back, and offsets into them are
 * offsets into the sentence.
 */
export function sentenceTokens(sentence: string): string[] {
  if (!sentence) return [];
  return sentence.match(TOKEN) ?? [];
}

/** The words of a sentence, lower-cased, for the overlap of two sentences. */
function wordsOf(sentence: string): string[] {
  return sentence.toLowerCase().split(/\s+/);
}

/** Share of words two lists have in common (Jaccard over their words). */
function overlap(wordsA: readonly string[], setA: ReadonlySet<string>, wordsB: readonly string[]): number {
  let shared = 0;
  for (const word of wordsB) if (setA.has(word)) shared++;
  const union = wordsA.length + wordsB.length - shared;
  return union === 0 ? 0 : shared / union;
}

/** Share of words two sentences have in common (Jaccard over their words). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const wordsA = wordsOf(a);
  return overlap(wordsA, new Set(wordsA), wordsOf(b));
}

/**
 * Cells of the alignment table at most. A larger changed middle is not aligned by the words it
 * shares but sentence by sentence in place: a text of the page's limit (5,000 sentences) edited
 * all over would otherwise take seconds on every render.
 */
export const MAPPING_CELLS_MAX = 250_000;

/** What `sentenceMapping` did, for tests that guard its cost. */
export interface MappingStats {
  /** Word overlaps computed between a sentence and a baseline. */
  comparisons: number;
}

/**
 * Which sentence of `baselines` each of `sentences` comes from, `-1` for a sentence of its own
 * (one the user added). Sentences that did not change at the start and at the end are paired
 * directly; what lies between is aligned in order by the words they share (lists of equal
 * length fall back to pairing by position where nothing matched).
 */
export function sentenceMapping(
  sentences: readonly string[],
  baselines: readonly string[],
  stats?: MappingStats,
): number[] {
  if (baselines.length === 0) return sentences.map((_, index) => index);
  const n = sentences.length;
  const m = baselines.length;
  const mapping = new Array<number>(n).fill(-1);
  const same = (i: number, j: number): boolean => sentences[i]!.trim() === baselines[j]!.trim();

  let start = 0;
  while (start < n && start < m && same(start, start)) {
    mapping[start] = start;
    start++;
  }
  let end = 0;
  while (end < n - start && end < m - start && same(n - 1 - end, m - 1 - end)) {
    mapping[n - 1 - end] = m - 1 - end;
    end++;
  }
  alignMiddle(sentences, baselines, start, n - end, start, m - end, mapping, stats);

  if (n === m) {
    for (let k = 0; k < n; k++) if (mapping[k] === -1) mapping[k] = k;
  }
  return mapping;
}

/** Aligns `sentences[fromS..toS)` with `baselines[fromB..toB)` into `mapping`. */
function alignMiddle(
  sentences: readonly string[],
  baselines: readonly string[],
  fromS: number,
  toS: number,
  fromB: number,
  toB: number,
  mapping: number[],
  stats?: MappingStats,
): void {
  const n = toS - fromS;
  const m = toB - fromB;
  if (n === 0 || m === 0) return;
  const textsS = sentences.slice(fromS, toS).map((sentence) => sentence.trim());
  const textsB = baselines.slice(fromB, toB).map((baseline) => baseline.trim());
  const wordsS = textsS.map((text) => (text ? wordsOf(text) : []));
  const wordsB = textsB.map((text) => (text ? wordsOf(text) : []));
  const setsS = wordsS.map((words) => new Set(words));
  const score = (i: number, j: number): number => {
    const s = textsS[i - 1]!;
    const b = textsB[j - 1]!;
    if (!s && !b) return 1;
    if (!s || !b) return 0;
    if (stats) stats.comparisons++;
    return s === b ? 1 : overlap(wordsS[i - 1]!, setsS[i - 1]!, wordsB[j - 1]!);
  };

  if (n * m > MAPPING_CELLS_MAX) {
    // Too much changed to align by words: sentences keep their place where they still resemble it.
    for (let k = 1; k <= Math.min(n, m); k++) if (score(k, k) > 0.2) mapping[fromS + k - 1] = fromB + k - 1;
    return;
  }

  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const choice = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sim = score(i, j);
      let best = dp[i - 1]![j]!;
      let direction = 2;
      if (dp[i]![j - 1]! > best) {
        best = dp[i]![j - 1]!;
        direction = 3;
      }
      const match = sim > 0.2 ? dp[i - 1]![j - 1]! + sim : -1;
      if (match >= best && match > dp[i - 1]![j - 1]!) {
        best = match;
        direction = 1;
      }
      dp[i]![j] = best;
      choice[i]![j] = direction;
    }
  }
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (choice[i]![j] === 1) {
      if (score(i, j) > 0.2) mapping[fromS + i - 1] = fromB + j - 1;
      i--;
      j--;
    } else if (choice[i]![j] === 2) i--;
    else j--;
  }
}

/** Sentences that end with their punctuation: live editing sends a text once one more is done. */
export function completeSentenceCount(text: string): number {
  if (!text) return 0;
  return splitIntoSentences(text).filter((sentence) => /[.!?]+(\s*['"»”]*\s*)$/.test(sentence)).length;
}

/** `result` with the whitespace that followed `source` at its end, when the engine dropped it. */
export function withTrailingWhitespace(result: string, source: string): string {
  const trailing = /\s+$/.exec(source)?.[0] ?? '';
  return trailing && !result.endsWith(trailing) ? result.trimEnd() + trailing : result;
}
