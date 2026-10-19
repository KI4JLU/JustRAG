import type { Message, MessageSource } from '../types';
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

/**
 * The source citation number `n` refers to: the one whose `index` is `n`.
 * Sources stored without an index (old messages) are numbered by position.
 * Position and index differ only when sources were filtered out — e.g. a
 * reader without `seeCitations` keeps just their own attachments, which keep
 * their numbers.
 */
export function sourceForCitation(sources: readonly MessageSource[] | undefined, n: number): MessageSource | undefined {
  if (!sources || n < 1) return undefined;
  const byIndex = sources.find(s => s.index === n);
  if (byIndex) return byIndex;
  const byPosition = sources[n - 1];
  return byPosition && byPosition.index == null ? byPosition : undefined;
}

/** The highest citation number the sources can answer (see sourceForCitation). */
export function maxCitationNumber(sources: readonly MessageSource[] | undefined): number {
  if (!sources) return 0;
  return sources.reduce((m, s, i) => Math.max(m, s.index ?? i + 1), 0);
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
 * Numbers in `keep` survive: a marker citing only kept numbers stays, a
 * mixed one keeps just those ("[1, 5]" with 5 kept becomes "[5]").
 */
export function stripCitationMarkers(content: string, keep?: ReadonlySet<number>): string {
  const strip = (text: string) => text.replace(CITATION_MARKER_RE, (marker) => {
    if (!keep || keep.size === 0) return '';
    const nums = (marker.match(/\d{1,3}/g) ?? []).map(Number);
    const kept = nums.filter(n => keep.has(n));
    if (kept.length === 0) return '';
    if (kept.length === nums.length) return marker;
    return `${marker.match(/^[ \t]*/)?.[0] ?? ''}[${kept.join(', ')}]`;
  });
  let out = '';
  let last = 0;
  for (const m of content.matchAll(CODE_OR_MATH_RE)) {
    out += strip(content.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + strip(content.slice(last));
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
 *
 * The reader's own chat attachments (sources with a userFileId) are no KB
 * sources: they, their markers and their citation results stay.
 */
export function withoutCitations(message: Message): Message {
  const own = (message.sources ?? []).filter(s => s.userFileId);
  const keep = new Set(own.map(s => s.index).filter((n): n is number => typeof n === 'number' && n > 0));
  const keptCitations = message.verification?.citations?.filter(c => keep.has(c.n));
  return {
    ...message,
    content: stripCitationMarkers(message.content, keep),
    sources: own.length > 0 ? own : undefined,
    conflicts: undefined,
    verification: message.verification
      ? { ...message.verification, citations: keptCitations && keptCitations.length > 0 ? keptCitations : undefined }
      : message.verification,
    trajectory: message.trajectory?.map(e => (e.chunks ? { ...e, chunks: undefined } : e)),
    comparisonFindings: message.comparisonFindings?.map(f => ({ ...f, citedQuote: '', citedFileIds: [] })),
  };
}
