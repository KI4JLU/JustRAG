import type { MessageSource } from '../types';
import { previewKindOf } from './previewKind';
import { formatPageRanges, sourceForCitation } from './citations';
import { MATH_SPAN_RE } from './markdownMath';

/**
 * How an answer's sources are shown: one display number per cited file,
 * 1…N in the order the answer first cites them, used by every surface (the
 * inline chips, the source list, the preview and the source panel). The
 * answer text keeps the backend's raw `[n]` markers (they index
 * `message.sources`); only the display is renumbered.
 */

export type SourceKind = 'pdf' | 'table' | 'markdown' | 'text' | 'word' | 'slides' | 'image' | 'audio' | 'video' | 'document';

/** The translation key of each kind's label ("Tabelle", "PDF", …). */
export const SOURCE_KIND_LABEL_KEY: Record<SourceKind, string> = {
    pdf: 'sourceKindPdf',
    table: 'sourceKindTable',
    markdown: 'sourceKindMarkdown',
    text: 'sourceKindText',
    word: 'sourceKindWord',
    slides: 'sourceKindSlides',
    image: 'sourceKindImage',
    audio: 'sourceKindAudio',
    video: 'sourceKindVideo',
    document: 'sourceKindDocument',
};

/**
 * A cited file's kind for its label and tile, by name (citations carry no
 * MIME type). The type decision is the preview's (utils/previewKind); this
 * only splits its `document` into Word and slides for the label, and keeps
 * a name without an extension a plain "Dokument".
 */
export function sourceKind(fileName: string): SourceKind {
    const lower = fileName.toLowerCase();
    if (/\.(docx?|odt|rtf)$/.test(lower)) return 'word';
    if (/\.(pptx?|odp)$/.test(lower)) return 'slides';
    switch (previewKindOf({ name: fileName })) {
        case 'pdf': return 'pdf';
        case 'spreadsheet': return 'table';
        case 'markdown': return 'markdown';
        case 'image': return 'image';
        case 'audio': return 'audio';
        case 'video': return 'video';
        case 'text': return /\.[a-z0-9]+$/.test(lower) ? 'text' : 'document';
        default: return 'document';
    }
}

/** A file name as a title: no extension, underscores as spaces. */
export function cleanSourceTitle(fileName: string): string {
    const base = fileName.split('/').pop() ?? fileName;
    const noExt = base.replace(/\.[a-z0-9]{1,8}$/i, '');
    const title = noExt.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
    return title || base;
}

/** One cited file of an answer. */
export interface CitedSource {
    /** Display number, 1-based. */
    n: number;
    key: string;
    fileName: string;
    fileId?: string;
    userFileId?: string;
    title: string;
    kind: SourceKind;
    dateIso?: string;
    /** Every page the cited passages are on, sorted. */
    pages: number[];
    /** The cited passages (chunks), in the order the answer first cites them. */
    passages: MessageSource[];
    /** The raw citation number of each passage, same order. */
    rawNumbers: number[];
}

export interface CitationModel {
    /** Cited files, ordered by display number. */
    cited: CitedSource[];
    /** Raw citation number → its file's display number. */
    displayOf: Map<number, number>;
    /** No sources, or the answer cites none of them. */
    noSources: boolean;
}

const fileKey = (s: MessageSource) => s.fileId || s.userFileId || s.fileName;

const PRESERVE_RE = new RegExp('```[\\s\\S]*?```|`[^`\\n]+`|' + MATH_SPAN_RE.source, 'g');
const MARKER_RE = /(?<![`[])\\?\[\s*(\d{1,3}(?:\s*,\s*\d{1,3})*)\s*\\?\](?!\()/g;

/** The raw citation numbers in the order they appear (code and math left out). */
export function citationOrder(content: string): number[] {
    const prose = content.replace(PRESERVE_RE, ' ');
    const out: number[] = [];
    for (const m of prose.matchAll(MARKER_RE)) {
        for (const part of m[1].split(',')) {
            const n = parseInt(part.trim(), 10);
            if (!Number.isNaN(n)) out.push(n);
        }
    }
    return out;
}

/**
 * The answer text that cites each raw number: every block (paragraph, list
 * item) carrying the marker, markers removed. Lets a passage without a
 * verified span still mark the sentence the answer drew on.
 */
export function citingTextByRaw(content: string): Map<number, string> {
    const out = new Map<number, string>();
    for (const block of content.replace(PRESERVE_RE, ' ').split(/\n\s*\n|\n(?=\s*(?:[-*+]|\d+\.)\s)/)) {
        const text = block.replace(MARKER_RE, ' ').replace(/[*_#>`]/g, '').trim();
        for (const m of block.matchAll(MARKER_RE)) {
            for (const part of m[1].split(',')) {
                const n = parseInt(part.trim(), 10);
                if (!Number.isNaN(n)) out.set(n, out.has(n) ? `${out.get(n)} ${text}` : text);
            }
        }
    }
    return out;
}

export function buildCitationModel(content: string, sources: readonly MessageSource[] | undefined): CitationModel {
    const cited = new Map<string, CitedSource>();
    const displayOf = new Map<number, number>();
    if (sources && sources.length > 0) {
        for (const raw of citationOrder(content)) {
            const s = sourceForCitation(sources, raw);
            if (!s || !s.fileName) continue;
            const key = fileKey(s);
            let g = cited.get(key);
            if (!g) {
                g = {
                    n: cited.size + 1, key, fileName: s.fileName, fileId: s.fileId, userFileId: s.userFileId,
                    title: cleanSourceTitle(s.fileName), kind: sourceKind(s.fileName),
                    dateIso: s.publishedAt ?? s.createdAt, pages: [], passages: [], rawNumbers: [],
                };
                cited.set(key, g);
            }
            if (!g.rawNumbers.includes(raw)) {
                g.passages.push(s);
                g.rawNumbers.push(raw);
                for (const p of s.pages ?? []) if (!g.pages.includes(p)) g.pages.push(p);
                g.pages.sort((x, y) => x - y);
                if (!g.dateIso) g.dateIso = s.publishedAt ?? s.createdAt;
            }
            displayOf.set(raw, g.n);
        }
    }
    return { cited: [...cited.values()], displayOf, noSources: cited.size === 0 };
}

/** A row of a spreadsheet chunk: its column labels and values with their rune offsets. */
export interface TableRecord {
    ordinal: number;
    fields: { label: string; value: string; start: number; end: number }[];
}

const ROWS_MARKER_RE = /^\[(?:tabular\.\S+ )?rows (\d+)[–-](\d+)\]$/;

/**
 * Parses a spreadsheet chunk ("[tabular.t rows 3–9]" then one
 * "Header: value | Header: value" line per row). null when the text is not
 * one. Offsets are runes into `content`, as the citation spans are.
 */
export function parseTableChunk(content: string): TableRecord[] | null {
    const lines = content.split('\n');
    let offset = 0;
    let ordinal = -1;
    const records: TableRecord[] = [];
    for (const line of lines) {
        const lineRunes = Array.from(line).length;
        const marker = ROWS_MARKER_RE.exec(line.trim());
        if (marker) {
            ordinal = parseInt(marker[1], 10);
        } else if (ordinal > 0 && line.includes(': ') && !line.startsWith('#')) {
            const fields: TableRecord['fields'] = [];
            let pos = offset;
            for (const part of line.split(' | ')) {
                const sep = part.indexOf(': ');
                const partRunes = Array.from(part).length;
                if (sep > 0) {
                    const label = part.slice(0, sep);
                    const value = part.slice(sep + 2);
                    const start = pos + Array.from(label).length + 2;
                    fields.push({ label, value, start, end: start + Array.from(value).length });
                }
                pos += partRunes + 3;
            }
            if (fields.length > 0) records.push({ ordinal: ordinal++, fields });
        }
        offset += lineRunes + 1;
    }
    return records.length > 0 ? records : null;
}

/** The record a span falls in, else the first. */
export function recordForSpan(records: TableRecord[], span?: { start: number; end: number }): TableRecord {
    if (span) {
        const hit = records.find(r => r.fields.some(f => f.start < span.end && f.end > span.start));
        if (hit) return hit;
    }
    return records[0];
}

const ORIGIN_LINE_RE = /^Source: (https?:\/\/\S+)\s*$/m;

/** The "Source: <url>" header line imported pages and feed items carry. */
export function originUrlOf(text: string): string | undefined {
    return ORIGIN_LINE_RE.exec(text)?.[1];
}

/** Text without that header line. */
export function withoutOriginLine(text: string): string {
    return text.replace(/^Source: https?:\/\/\S+\s*\n?/m, '');
}


/** Replaces `{name}` placeholders in a translated string. */
export function fillTemplate(text: string, values: Record<string, string | number>): string {
    return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

/** "Quelle 1 · Tabelle · S. 4" — the locator is the passage's pages. */
export function sourceMeta(t: (key: string) => string, source: CitedSource, passage?: MessageSource): string {
    const parts = [fillTemplate(t('sourceNumberLabel'), { n: source.n }), t(SOURCE_KIND_LABEL_KEY[source.kind])];
    const pages = passage?.pages?.length ? passage.pages : undefined;
    if (pages) parts.push(`${t('pageAbbrev')} ${formatPageRanges(pages)}`);
    return parts.join(' · ');
}
