/**
 * Splits a `GET /api/search` message snippet into plain and highlighted runs
 * (card KI-837).
 *
 * THE CONTRACT (API.md `### Search`): `messages[].snippet` is PLAIN TEXT.
 * Every matched word is wrapped in U+E000 (start) and U+E001 (end), two
 * private-use characters the backend strips from the content before cutting
 * the snippet, so every occurrence is a marker. Any `<` or `&` in the text is
 * literal. That is why this returns runs of text for the caller to render as
 * React text nodes — never a string of markup, and never through
 * `dangerouslySetInnerHTML`.
 *
 * Unbalanced markers are tolerated rather than trusted: a stray end marker
 * just ends nothing, and an unclosed start highlights to the end of the
 * snippet. Markers never survive into the output text.
 */

export const SNIPPET_HIGHLIGHT_START = '';
export const SNIPPET_HIGHLIGHT_END = '';

export interface SnippetPart {
  text: string;
  highlight: boolean;
}

export function splitSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let current = '';
  let highlight = false;
  const flush = () => {
    if (current) parts.push({ text: current, highlight });
    current = '';
  };
  for (const ch of snippet) {
    if (ch === SNIPPET_HIGHLIGHT_START) {
      flush();
      highlight = true;
    } else if (ch === SNIPPET_HIGHLIGHT_END) {
      flush();
      highlight = false;
    } else {
      current += ch;
    }
  }
  flush();
  return parts;
}
