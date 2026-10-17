import type { Message } from '../types';
import { MATH_SPAN_RE } from './markdownMath';

// Extracts 1-based source indices that appear as [N] or [N, M, ...] markers
// in the answer text. The regex is intentionally slightly more lenient than
// the Go-side `citationMarkerRe` in
// go-backend/internal/chat/citation_validator.go:40 — it additionally
// tolerates whitespace between the bracket delimiter and the first/last
// digit (`[ 1 ]`, `[ 1, 2 ]`). The Go regex already allows whitespace
// around commas; this extension handles off-format LLM output without
// falling back to the full top-N. The TS side is a display filter; the
// Go side is a trust validator — slight TS-side leniency is the safer
// direction.
//
// Used by MessageBubble to filter the per-message source list down to
// actually-cited sources, with graceful fallback to the full list when this
// returns an empty set.
//
// sourceCount is the length of message.sources; out-of-range indices are
// dropped here so the caller can use `result.size === 0` as an unambiguous
// "fall back to all sources" signal.
// formatPageRanges renders a sorted, de-duplicated page list as compact
// ranges: [4, 5, 6, 9] → "4-6, 9". Shared by the per-message source list
// (MessageBubble) and the inline citation label (MessageContent) so the two
// can't drift apart on how a multi-page citation reads.
export function formatPageRanges(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  if (sorted.length === 1) return String(sorted[0]);
  const ranges: string[] = [];
  let start = sorted[0], end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      ranges.push(start === end ? String(start) : `${start}-${end}`);
      start = end = sorted[i];
    }
  }
  ranges.push(start === end ? String(start) : `${start}-${end}`);
  return ranges.join(', ');
}

export function extractCitedSourceIndices(
  content: string,
  sourceCount: number,
): Set<number> {
  const out = new Set<number>();
  if (sourceCount <= 0) return out;
  // `\\?` on each bracket tolerates markdown-escaped citations (`\[1\]`),
  // which some LLMs emit intermittently when generating prose. Without this
  // the filter would fall back to "show all sources" on those answers.
  const re = /\\?\[\s*(\d+(?:\s*,\s*\d+)*)\s*\\?\]/g;
  for (const match of content.matchAll(re)) {
    for (const part of match[1].split(',')) {
      const n = parseInt(part.trim(), 10);
      if (!isNaN(n) && n >= 1 && n <= sourceCount) {
        out.add(n);
      }
    }
  }
  return out;
}

// Code and math spans keep their brackets: `arr[1]` is not a citation. The
// same cut-out MessageContent makes before it renders citation pills, plus the
// LaTeX delimiters \( … \) and \[ … \] that MessageContent first rewrites to
// dollars (normalizeMathDelimiters). \[1\] with a citation body stays a marker.
const LATEX_MATH_RE = /\\\[(?!\s*\d{1,3}(?:\s*,\s*\d{1,3})*\s*\\\])[\s\S]+?\\\]|\\\([^\n]+?\\\)/;
const CODE_OR_MATH_RE = new RegExp(
  '```[\\s\\S]*?```|`[^`\\n]+`|' + MATH_SPAN_RE.source + '|' + LATEX_MATH_RE.source, 'g');
// The marker shapes MessageContent renders as pills (its addCitationRefs
// regex), plus the blank in front of one, so "Text [1]." becomes "Text.".
const CITATION_MARKER_RE = /[ \t]*(?<![`[])\\?\[\s*\d{1,3}(?:\s*,\s*\d{1,3})*\s*\\?\](?!\()/g;

/**
 * stripCitationMarkers removes every inline citation marker ([1], [1, 2],
 * escaped \[1\]) from an answer's markdown, outside code and math spans.
 */
export function stripCitationMarkers(content: string): string {
  let out = '';
  let last = 0;
  for (const m of content.matchAll(CODE_OR_MATH_RE)) {
    out += content.slice(last, m.index).replace(CITATION_MARKER_RE, '') + m[0];
    last = m.index + m[0].length;
  }
  return out + content.slice(last).replace(CITATION_MARKER_RE, '');
}

/**
 * withoutCitations is an answer as a caller without `seeCitations` sees it:
 * no inline markers, no source list, and nothing else that names or quotes
 * the KB's sources — the conflict report (it names two files), the citation
 * validator's per-citation results, the trajectory's retrieved-file lists and
 * a comparison finding's KB quote and files. The rest of the answer, the
 * fact-check verdict included, is unchanged.
 *
 * The copy/export actions read the same object, so they cannot leak what the
 * screen hides.
 */
export function withoutCitations(message: Message): Message {
  return {
    ...message,
    content: stripCitationMarkers(message.content),
    sources: undefined,
    conflicts: undefined,
    verification: message.verification ? { ...message.verification, citations: undefined } : message.verification,
    trajectory: message.trajectory?.map(e => (e.chunks ? { ...e, chunks: undefined } : e)),
    comparisonFindings: message.comparisonFindings?.map(f => ({ ...f, citedQuote: '', citedFileIds: [] })),
  };
}
