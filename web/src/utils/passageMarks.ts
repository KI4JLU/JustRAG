import { isValidSpan } from './verification';

/** A passage to mark in the PDF preview (the DS PdfViewer's `highlights`): its text, optionally on one page. */
export type PdfHighlight = { text: string; page?: number };

/** What the full PDF view of a citation shows: only the cited pages, with the passage marked. */
export type PdfFocus = { highlights: PdfHighlight[]; pages?: number[] };

/** A stretch of a passage, in rune offsets (as a verified citation span). */
export type Span = { start: number; end: number };

const words = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []));

// matchedSentences finds the lines or sentences of `content` that share at
// least two words with `focus` (best match first), as RUNE offsets like a
// verified span, so a passage without one still marks what the answer drew on.
export function matchedSentences(content: string, focus: string | undefined): Span[] {
    if (!focus) return [];
    const want = words(focus);
    const hits: (Span & { score: number })[] = [];
    const re = /[^\n.!?]+[.!?]?/g;
    for (let m = re.exec(content); m; m = re.exec(content)) {
        let score = 0;
        for (const w of words(m[0])) if (want.has(w)) score++;
        if (score < 2) continue;
        const lead = m[0].length - m[0].trimStart().length;
        const start = [...content.slice(0, m.index + lead)].length;
        hits.push({ start, end: start + [...m[0].trim()].length, score });
    }
    const best = Math.max(0, ...hits.map(h => h.score));
    return hits
        .filter(h => h.score * 2 >= best)
        .sort((a, b) => b.score - a.score || a.start - b.start)
        .map(({ start, end }) => ({ start, end }));
}

/**
 * The text a passage marks, as SourceExcerpt marks it: the verified citation
 * span, else the sentences matching the citing statement. With neither, the
 * whole passage — the full PDF view then still shows where the source was cited.
 */
export function passageMarkTexts(content: string, span: Span | undefined, focus: string | undefined): string[] {
    const runes = [...content];
    const slice = (sp: Span) => runes.slice(sp.start, sp.end).join('');
    if (span && isValidSpan(content, span)) return [slice(span)];
    // Dedented first, as SourceExcerpt does before it matches.
    const dedented = content.replace(/^[ \t]{4,}/gm, '');
    const matched = matchedSentences(dedented, focus);
    if (matched.length > 0) {
        const chars = [...dedented];
        return matched.map(sp => chars.slice(sp.start, sp.end).join(''));
    }
    return content.trim() ? [content] : [];
}
