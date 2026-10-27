import { MATH_SPAN_RE } from './markdownMath';
import type { CitationModel } from './sourceDisplay';

/* The answer's inline citation markers, turned into chip placeholders
   (`addCitationRefs`, rendered by MessageContent) and listed in reading order
   (`citationMarkers`, the source panel's „next / previous marker"). One
   module, so the panel's sequence is exactly the chips the reader sees. */

// Code spans and math spans are cut out before the citation / flagged-claim
// rewriters run and restored afterwards: both inject raw HTML, which would
// break code and formulas alike.
export const PRESERVE_RE = new RegExp('```[\\s\\S]*?```|`[^`\\n]+`|' + MATH_SPAN_RE.source, 'g');

// One marker: [1], [1, 2], [150], markdown-escaped \[1\], inner blanks
// tolerated — the shapes utils/citations.ts and utils/sourceDisplay.ts read.
// A run is markers next to each other, optionally comma-separated
// ("[1][2]", "[1], [3]"): its chips render side by side, without commas.
const MARKER_SRC = String.raw`(?<![\`[])\\?\[\s*\d{1,3}(?:\s*,\s*\d{1,3})*\s*\\?\](?!\()`;
const RUN_RE = new RegExp(`([ \\t]*)(${MARKER_SRC}(?:\\s*,?\\s*${MARKER_SRC})*)`, 'g');
// The same run with the punctuation right after it ("…werden [1]."): the
// rewrite glues word gap, chips and punctuation into one no-wrap span, so a
// line never breaks between a sentence's last word, its chips and its full
// stop (a chip is an atomic inline, after which browsers allow a break).
const RUN_PUNCT_RE = new RegExp(`${RUN_RE.source}([.,;:!?…)»"“”'’]*)`, 'g');
// A line that is its own unit: list item, table row, heading, quote.
const STRUCTURAL_LINE_RE = /^\s*(?:[-*+]\s|\d+[.)]\s|\||#{1,6}\s|>)/;

// Paragraphs, and every structural line on its own: within one unit a
// source is cited once.
function citationUnits(text: string): string[] {
    const out: string[] = [];
    let cur = '';
    let curBreaks = false;
    for (const line of text.split(/(?<=\n)/)) {
        const blank = line.trim() === '';
        const structural = STRUCTURAL_LINE_RE.test(line);
        if (cur && (blank || structural || curBreaks)) {
            out.push(cur);
            cur = '';
        }
        cur += line;
        curBreaks = blank || structural;
    }
    if (cur) out.push(cur);
    return out;
}

/**
 * Turns the answer's raw `[n]` markers into chip placeholders carrying the
 * per-answer display number (utils/sourceDisplay): `<sup class="source-ref"
 * data-n data-raw data-occ>`, which the `sup` component below renders as a
 * CitationChip. Within one paragraph (or list item / table row) a source is
 * marked once, at its last citation, carrying every raw number it had there.
 * A marker that resolves to no source is dropped. Code and math are left
 * alone.
 */
export function addCitationRefs(content: string, model: CitationModel): string {
    const preserved: string[] = [];
    const placeholder = (i: number) => `\x00CITE_PRESERVE_${i}\x00`;
    const safe = content.replace(PRESERVE_RE, (match) => {
        preserved.push(match);
        return placeholder(preserved.length - 1);
    });

    let occ = 0;
    let out = citationUnits(safe).map((unit) => {
        const runs = [...unit.matchAll(RUN_RE)].map((m) => {
            const byN = new Map<number, number[]>();
            for (const d of m[2].match(/\d{1,3}/g) ?? []) {
                const raw = parseInt(d, 10);
                const n = model.displayOf.get(raw);
                if (!n) continue;
                byN.set(n, [...(byN.get(n) ?? []), raw]);
            }
            return byN;
        });
        if (runs.length === 0) return unit;
        const last = new Map<number, number>();
        const raws = new Map<number, number[]>();
        runs.forEach((byN, i) => byN.forEach((rs, n) => {
            last.set(n, i);
            raws.set(n, [...new Set([...(raws.get(n) ?? []), ...rs])]);
        }));
        let i = -1;
        return unit.replace(RUN_PUNCT_RE, (_m, ws: string, _run: string, punct: string) => {
            i += 1;
            const ns = [...runs[i].keys()].filter(n => last.get(n) === i);
            if (ns.length === 0) return punct;
            const chips = ns.map(n => `<sup class="source-ref" data-n="${n}" data-raw="${raws.get(n)!.join(',')}" data-occ="${occ++}"></sup>`).join('');
            return `<span class="cite-glue">${ws}${chips}${punct}</span>`;
        });
    }).join('');

    for (let i = 0; i < preserved.length; i++) {
        out = out.replace(placeholder(i), () => preserved[i]);
    }
    return out;
}

/** One inline chip of the answer, in reading order. */
export interface CitationMarker {
    /** Display number of the cited file. */
    n: number;
    /** The raw citation number the chip opens (its first). */
    raw: number;
    /** The chip's occurrence index — `data-occ` on the chip. */
    occ: number;
}

const CHIP_RE = /<sup class="source-ref" data-n="(\d+)" data-raw="([\d,]+)" data-occ="(\d+)"><\/sup>/g;

/** Every chip the answer renders, in reading order — read off the same
 *  placeholders `addCitationRefs` emits, so the two cannot disagree. */
export function citationMarkers(content: string, model: CitationModel): CitationMarker[] {
    return [...addCitationRefs(content, model).matchAll(CHIP_RE)].map(m => ({
        n: Number(m[1]),
        raw: Number(m[2].split(',')[0]),
        occ: Number(m[3]),
    }));
}
