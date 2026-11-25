import { changePieces, diffWords, insertedCharacters } from './diff';
import { isMarkup, sentenceTokens } from './sentences';

/**
 * The HTML of the result board and of the source overlay: every sentence a span that can be
 * clicked, every word a span of its own, so a click finds both. Built as a string and set on
 * the editable element directly: React must not re-render an element the user is typing in.
 */

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Classes of the board's pieces; tokens only, so both themes work.
 *
 * The pieces are spans inside the text's own flow (a Badge is an inline-flex chip and would break
 * the text's wrapping), so they take the tokens the design system uses for those states: the
 * menu rows' hover fill (`surface-container-high`), the selected row's `secondary-container`,
 * the success/error container pairs of Badge, and the smallest radius token (`radius-DEFAULT`).
 */
export const BOARD_CLASSES = {
  sentence:
    'sentence-item cursor-pointer rounded-DEFAULT transition-colors hover:bg-surface-container-high data-active:bg-secondary-container data-active:text-on-secondary-container',
  loading: 'animate-pulse rounded-DEFAULT bg-surface-container-high text-transparent',
  word: 'word-item',
  tag: 'word-item font-mono text-on-surface-variant',
  highlight: 'word-item border-b-2 border-success',
  inserted: 'rounded-DEFAULT bg-success-container px-0.5 text-on-success-container',
  deleted: 'rounded-DEFAULT bg-error-container px-0.5 text-on-error-container line-through',
  arrow: 'text-on-surface-variant',
  sourceSentence: 'rounded-DEFAULT',
  sourceActive: 'rounded-DEFAULT bg-secondary-container text-on-secondary-container',
  sourceHover: 'rounded-DEFAULT bg-surface-container-high',
} as const;

/**
 * The insets and text size the source field, its overlays and the result board share, so they
 * lie exactly over each other: room for the clear button at the end, and a large text while
 * both texts are short. Textarea's `inline` variant leaves the insets to the call site.
 */
export const BOARD_INSET = 'py-5 ps-6 pe-14';
export const boardTextSize = (small: boolean): string => (small ? 'text-body-base' : 'text-xl');

interface BoardOptions {
  sentences: readonly string[];
  /** Which original sentence each one comes from (`-1`: added by the user). */
  mapping: readonly number[] | null;
  /** The source as processed, to highlight what rewriting changed; `null`: no highlight. */
  highlightAgainst: string | null;
  /** Sentences being redone right now. */
  loading: readonly number[];
}

function tokenSpan(token: string, index: number, highlighted: boolean): string {
  if (!token.trim()) return escapeHtml(token);
  const tag = (token.startsWith('<') && token.endsWith('>')) || token.startsWith('<!--');
  const className = tag ? BOARD_CLASSES.tag : highlighted ? BOARD_CLASSES.highlight : BOARD_CLASSES.word;
  return `<span class="${className}" data-token-index="${index}">${escapeHtml(token)}</span>`;
}

/** The interactive board: sentences and words, what rewriting added underlined. */
export function boardHtml({ sentences, mapping, highlightAgainst, loading }: BoardOptions): string {
  const full = sentences.join('');
  const mask = highlightAgainst !== null && !isMarkup(full) ? insertedCharacters(highlightAgainst, full) : null;
  let offset = 0;
  return sentences
    .map((sentence, index) => {
      if (!sentence) return '';
      const tokens = sentenceTokens(sentence);
      const inner = tokens
        .map((token, tokenIndex) => {
          const start = offset;
          offset += token.length;
          const highlighted = mask ? mask.slice(start, start + token.length).some(Boolean) : false;
          return tokenSpan(token, tokenIndex, highlighted);
        })
        .join('');
      const source = mapping ? mapping[index] : index;
      const sourceAttr = source !== undefined && source !== -1 ? ` data-source-index="${source}"` : '';
      const className = loading.includes(index)
        ? `${BOARD_CLASSES.sentence} ${BOARD_CLASSES.loading}`
        : BOARD_CLASSES.sentence;
      return `<span class="${className}" data-index="${index}"${sourceAttr}>${inner}</span>`;
    })
    .join('');
}

/** "Show changes": the rewritten text with each replaced part as `old → new`. */
export function changesHtml(before: string, after: string, labels: { deleted: string; inserted: string }): string {
  return changePieces(diffWords(before, after))
    .map((piece) => {
      switch (piece.type) {
        case 'equal':
          return escapeHtml(piece.text);
        case 'arrow':
          return `<span class="${BOARD_CLASSES.arrow}" aria-hidden="true">&nbsp;→&nbsp;</span>`;
        case 'delete':
          return `<del class="${BOARD_CLASSES.deleted}"><span class="sr-only">${escapeHtml(labels.deleted)} </span>${escapeHtml(piece.text)}</del>${escapeHtml(piece.trailing)}`;
        case 'insert':
          return `<ins class="${BOARD_CLASSES.inserted} no-underline"><span class="sr-only">${escapeHtml(labels.inserted)} </span>${escapeHtml(piece.text)}</ins>${escapeHtml(piece.trailing)}`;
      }
    })
    .join('');
}

/**
 * The source as sentences, one of them marked while its result sentence is pointed at. Built from
 * the sentences' tokens so a lone `<` that starts no tag is not shown.
 */
export function sourceBoardHtml(
  source: string,
  sentences: readonly string[],
  active: number | null,
  hovered: number | null,
): string {
  const leading = /^\s+/.exec(source)?.[0] ?? '';
  return (
    escapeHtml(leading) +
    sentences
      .map((sentence, index) => {
        const className =
          index === active
            ? BOARD_CLASSES.sourceActive
            : index === hovered
              ? BOARD_CLASSES.sourceHover
              : BOARD_CLASSES.sourceSentence;
        const text = sentenceTokens(sentence).join('');
        return `<span class="${className}" data-index="${index}">${escapeHtml(text)}</span>`;
      })
      .join('')
  );
}

/** Where the caret is in `root`, as a character offset. */
export function caretOffset(root: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}

/** Puts the caret back at a character offset after the content was rebuilt. */
export function restoreCaret(root: HTMLElement, offset: number): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (offset <= seen + length) {
      const range = document.createRange();
      range.setStart(node, offset - seen);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    seen += length;
  }
}
