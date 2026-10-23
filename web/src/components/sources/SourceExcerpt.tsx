import { memo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { cn } from '@ki4jlu/design-system';
import { excerptAroundSpan, isValidSpan } from '../../utils/verification';
import { parseTableChunk, recordForSpan, withoutOriginLine } from '../../utils/sourceDisplay';

/**
 * The text of one cited passage, as the source preview and the source panel
 * show it: Markdown rendered (not raw `**…**` or `\_`), a spreadsheet chunk as
 * label/value pairs of the cited row, and the verified citation span marked.
 *
 * Without a verified span, the sentence that shares the most words with the
 * citing statement (`focus`) is marked instead. `clamp` cuts prose to a few
 * lines around the mark, with a fade at the bottom edge; the source panel shows
 * the passage whole.
 */

const MARK_CLASS = 'rounded-sm bg-primary-fixed px-0.5 text-on-primary-fixed';

const schema = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames || []), 'mark'],
    attributes: { ...defaultSchema.attributes, mark: [] },
};
const REMARK = [remarkGfm];
const REHYPE: import('unified').PluggableList = [rehypeRaw, [rehypeSanitize, schema]];

// Headings inside a passage are part of the quoted text, not page structure:
// they render at the passage's own size.
const heading = ({ children }: { children?: ReactNode }) => <p className="m-0 font-semibold">{children}</p>;
const COMPONENTS = {
    h1: heading, h2: heading, h3: heading, h4: heading, h5: heading, h6: heading,
    mark: ({ children }: { children?: ReactNode }) => <mark className={MARK_CLASS}>{children}</mark>,
    p: ({ children }: { children?: ReactNode }) => <p className="m-0 [&+*]:mt-2">{children}</p>,
    // A horizontal rule inside a quoted passage is page layout, not content.
    hr: () => null,
    a: ({ children }: { children?: ReactNode }) => <span className="underline">{children}</span>,
};

// `<` / `&` in the quoted text must stay text once a raw <mark> is spliced in.
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const WINDOW = 420;
const words = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []));

type Span = { start: number; end: number };

// matchedSentences finds the lines or sentences of `content` that share at
// least two words with `focus` (best match first), as RUNE offsets like a
// verified span, so a passage without one still marks what the answer drew on.
function matchedSentences(content: string, focus: string | undefined): Span[] {
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

// markAll wraps every span (rune offsets, non-overlapping) of `content` in <mark>.
function markAll(content: string, spans: Span[]): string {
    const runes = [...content];
    let out = '';
    let at = 0;
    for (const sp of [...spans].sort((a, b) => a.start - b.start)) {
        if (sp.start < at) continue;
        out += runes.slice(at, sp.start).join('') + `<mark>${escapeHtml(runes.slice(sp.start, sp.end).join(''))}</mark>`;
        at = sp.end;
    }
    return out + runes.slice(at).join('');
}

function clampText(text: string): string {
    if (text.length <= WINDOW) return text;
    const cut = text.slice(0, WINDOW);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), WINDOW - 80))} …`;
}

function proseMarkdown(content: string, span: Span | undefined, clamp: boolean, extra: Span[] = []): string {
    if (!clamp && extra.length > 0) return withoutOriginLine(markAll(content, extra)).trim();
    if (span) {
        const { before, quote, after } = excerptAroundSpan(content, span, clamp ? 60 : Number.MAX_SAFE_INTEGER);
        // Clamped: open on the marked line, so the mark is never pushed under the fade.
        const lead = clamp && before.includes('\n') ? `… ${before.slice(before.lastIndexOf('\n') + 1)}` : before;
        return `${withoutOriginLine(lead)}<mark>${escapeHtml(quote)}</mark>${after}`;
    }
    const text = withoutOriginLine(content).trim();
    return clamp ? clampText(text) : text;
}

interface SourceExcerptProps {
    content: string;
    span?: { start: number; end: number };
    clamp?: boolean;
    /** The citing statement: without a span, the excerpt starts where it matches best. */
    focus?: string;
    /** Label/value pairs side by side (desktop) or one under the other (sheet). */
    layout?: 'grid' | 'stack';
    /**
     * Prose as ONE run of text, its lines joined with „ · " and cut after
     * three lines with an ellipsis — the compact hover preview. Without it
     * each line is its own paragraph.
     */
    inline?: boolean;
    className?: string;
}

/** One line of text from the passage's lines: Markdown block markers
 *  (headings, list bullets, quotes) dropped, lines joined with „ · ". */
function inlineMarkdown(md: string): string {
    return md
        .split(/\n+/)
        .map(line => line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '').trim())
        .filter(Boolean)
        .join(' · ');
}

const INLINE_COMPONENTS = {
    ...COMPONENTS,
    p: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
};

function SourceExcerptComp({ content, span, clamp = false, focus, layout = 'grid', inline = false, className }: SourceExcerptProps) {
    const verified = span && isValidSpan(content, span) ? span : undefined;
    // Without a verified span: the matching sentences — the best one frames a
    // clamped excerpt, the full passage marks all of them. Extracted text
    // (PDF) often indents lines by four or more spaces, which Markdown reads
    // as a code block where a <mark> would show as literal text: dedent first.
    if (!verified) content = content.replace(/^[ \t]{4,}/gm, '');
    const matched = verified ? [] : matchedSentences(content, focus);
    const validSpan = verified ?? matched[0];
    const records = parseTableChunk(content);

    if (records) {
        const spans = verified ? [verified] : matched;
        const marked = (f: { start: number; end: number }) => spans.some(sp => f.start < sp.end && f.end > sp.start);
        const renderFields = (fields: typeof records[number]['fields'], key?: number) => (
            <dl
                key={key}
                className={cn(
                    'm-0 grid gap-x-6 gap-y-3',
                    layout === 'grid' && 'grid-cols-[repeat(auto-fit,minmax(180px,1fr))]',
                    !clamp && 'border-b border-outline-variant pb-3 last:border-b-0 last:pb-0',
                    className,
                )}
            >
                {fields.map((f, i) => (
                    <div key={`${f.label}-${i}`} className="min-w-0">
                        <dt className="text-xs text-on-surface-variant">{f.label}</dt>
                        <dd className="m-0 break-words">{marked(f) ? <mark className={MARK_CLASS}>{f.value}</mark> : f.value}</dd>
                    </div>
                ))}
            </dl>
        );
        // The full panel shows every row of the passage; a compact preview the
        // cited row only, marked cells first, up to six.
        if (!clamp) return <div className="flex flex-col gap-3">{records.map((r, i) => renderFields(r.fields, i))}</div>;
        const record = recordForSpan(records, validSpan);
        const top = [...record.fields.filter(marked), ...record.fields.filter(f => !marked(f))].slice(0, 6);
        return renderFields(record.fields.filter(f => top.includes(f)));
    }

    if (inline) {
        return (
            <div className={cn('min-w-0 break-words line-clamp-3', className)}>
                <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={INLINE_COMPONENTS}>
                    {inlineMarkdown(proseMarkdown(content, validSpan, clamp, matched))}
                </ReactMarkdown>
            </div>
        );
    }

    return (
        <div
            className={cn(
                'min-w-0 break-words',
                clamp && 'max-h-[5lh] overflow-hidden [mask-image:linear-gradient(to_bottom,black_80%,transparent)]',
                className,
            )}
        >
            <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={COMPONENTS}>
                {proseMarkdown(content, validSpan, clamp, matched)}
            </ReactMarkdown>
        </div>
    );
}

export const SourceExcerpt = memo(SourceExcerptComp);
