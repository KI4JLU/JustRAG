import { memo, lazy, Suspense, useMemo, useRef, useState, useCallback, useEffect } from 'react';
import ReactMarkdown, { type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { normalizeMathDelimiters } from '../utils/markdownMath';
import { Loader2, X } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import type { MessageSource, TrajectoryEvent, FlaggedClaimStatus } from '../types';
import { buildCitationModel, citingTextByRaw, fillTemplate, type CitationModel } from '../utils/sourceDisplay';
import { PRESERVE_RE, addCitationRefs } from '../utils/citationRefs';
import { useFinePointer } from '../hooks/useFinePointer';
import { CitationChip } from './sources/CitationChip';
import { CITED_BLOCK_SELECTOR, CitationChipContext, passageFor, type ChipSheet, type CitationChipContextValue } from './sources/citationChipContext';
import { citingRange } from '../utils/citingRange';
import { useSourcePanel } from '../contexts/SourcePanelContext';
import { SourcePreview } from './sources/SourcePreview';
import { TrajectoryPanel } from './TrajectoryPanel';
import {
    Button, CodeBlock, Drawer, DrawerClose, DrawerContent, DrawerTitle, Reasoning, ReasoningContent, ReasoningTrigger, Shimmer,
} from '@ki4jlu/design-system';
import { MarkdownTable } from './MarkdownTable';

// Lazy load ChartRenderer
const ChartRenderer = lazy(() => import('./ChartRenderer'));

interface MessageContentProps {
    content: string;
    reasoning?: string;
    isThinking?: boolean;
    sources?: MessageSource[];
    /**
     * Raw citation numbers the deterministic n-gram validator marked as
     * suspect: their chips are amber (colour only, no icon). Undefined when
     * validation didn't run.
     */
    suspectCitations?: ReadonlyMap<number, 'out_of_range' | 'no_overlap'>;
    /**
     * Raw citation numbers with a verified span (method = "span"), mapped to
     * the RUNE offsets into that source's `content`: the preview marks the
     * quoted passage. Undefined renders every preview without a mark.
     */
    citationSpans?: Map<number, { start: number; end: number }>;
    /** The answer's per-answer numbering (utils/sourceDisplay); built from content + sources when omitted. */
    citationModel?: CitationModel;
    /**
     * Streaming trajectory: one entry per orchestrator decision point. When
     * present and non-empty, a collapsible "Reasoning steps" panel is rendered
     * above the answer body. The list is intentionally append-only — the
     * useChatStream hook owns mutation.
     */
    trajectory?: TrajectoryEvent[];
    /**
     * Flagged claims from the Phase 3 §3.3 factuality verifier. Each
     * matching substring in the answer is wrapped with a suspect-style
     * amber dashed underline + tooltip explaining the reason. Empty or
     * undefined skips the highlight pass entirely.
     */
    flaggedClaims?: FlaggedClaimStatus[];
    /** "In Quelle öffnen" in a preview: the source panel at that passage. */
    onOpenPanel?: (n: number, raw: number, focus?: string, occ?: number) => void;
    /** "Alle N Quellen" in a preview: the answer's source list. */
    onShowAllSources?: () => void;
    /**
     * The passage the source panel shows, when it is this answer's: its chips
     * stay filled and the paragraph citing it is marked.
     */
    activeCitation?: { n: number; raw: number; occ?: number } | null;
    /**
     * Whether the chain-of-thought panel is expanded. Controlled from the chat
     * view (keyed by message id) rather than left to the native <details> DOM
     * state: the message list is virtualized, so the node is destroyed when the
     * message scrolls out of view and would come back collapsed — changing the
     * item's measured height mid-scroll and jerking the scroll position.
     */
    reasoningOpen?: boolean;
    onToggleReasoning?: () => void;
}

// escapeAttr keeps tooltip text safe to inline as an HTML attribute. The
// downstream rehype-sanitize would already strip dangerous attributes, but
// we still want the tooltip readable, not garbled.
function escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// escapeRegex protects a literal claim string from being interpreted as
// regex metacharacters when we build the flagged-claim matcher.
function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// addFlaggedClaimHighlights wraps every literal occurrence of a flagged
// claim text in <mark> with a suspect-styled className + reason tooltip.
// The match is case-insensitive on a word boundary; verbatim quotes
// emitted by the verifier almost always survive as substrings of the
// answer prose, so a simple substring match is enough.
//
// Code blocks and inline code are preserved (same protection pattern as
// addCitationRefs) so a flagged claim that happens to contain a
// backtick doesn't break syntax highlighting.
function addFlaggedClaimHighlights(content: string, flagged?: FlaggedClaimStatus[], language: 'de' | 'en' = 'de'): string {
    if (!flagged || flagged.length === 0) return content;

    const preserved: string[] = [];
    const placeholder = (i: number) => `\x00FACT_PRESERVE_${i}\x00`;
    let safe = content.replace(PRESERVE_RE, (match) => {
        const idx = preserved.length;
        preserved.push(match);
        return placeholder(idx);
    });

    for (const claim of flagged) {
        const text = claim.claim_text.trim();
        if (text.length < 4) continue; // sub-word matches are noise
        const re = new RegExp(escapeRegex(text), 'i');
        const reasonLabel: Record<FlaggedClaimStatus['reason'], { en: string; de: string }> = {
            unsupported: { en: 'unsupported by sources', de: 'durch Quellen nicht gestützt' },
            contradicted: { en: 'contradicted by sources', de: 'widerspricht den Quellen' },
            out_of_scope: { en: 'outside the scope of the sources', de: 'außerhalb des Themas der Quellen' },
        };
        const localized = reasonLabel[claim.reason] ?? reasonLabel.unsupported;
        const tooltip = language === 'en'
            ? `Factuality verifier: ${localized.en}.`
            : `Faktenprüfer: ${localized.de}.`;
        safe = safe.replace(re, (m) => `<mark class="claim-flagged" data-reason="${escapeAttr(claim.reason)}" title="${escapeAttr(tooltip)}">${m}<span class="claim-flagged-warn" aria-hidden="true"> ⚠</span></mark>`);
    }

    for (let i = 0; i < preserved.length; i++) {
        safe = safe.replace(placeholder(i), () => preserved[i]);
    }
    return safe;
}

// Sanitization schema: extend the default to allow citation <sup> elements with data attributes.
//
// rehype-sanitize (via hast-util-sanitize 6.x) matches allowlist entries
// against HAST property names, NOT raw HTML attribute names. HAST converts
// `data-n` → `dataN`, `aria-hidden` → `ariaHidden`, `class` → `className`.
// Using the hyphenated form here silently strips the attribute, which loses
// the chip placeholder's numbers. See hast-util-sanitize's default schema for
// precedent (e.g. `section: ['dataFootnotes', ...]`).
const sanitizeSchema = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames || []), 'sup', 'sub', 'details', 'summary', 'mark'],
    attributes: {
        ...defaultSchema.attributes,
        sup: ['className', 'dataN', 'dataRaw', 'dataOcc'],
        mark: ['className', 'dataReason', 'title'],
        span: ['className', 'ariaHidden'],
        code: ['className'],
        img: ['src', 'alt', 'loading'],
    },
};

// Optimization: Define static configuration outside component to prevent unnecessary re-renders
// rehype-katex runs AFTER rehype-sanitize: the sanitizer would strip KaTeX's
// markup (spans with inline styles, MathML), and KaTeX output is generated
// from the formula source with trust off, so it needs no sanitizing.
const REMARK_PLUGINS: import('unified').PluggableList = [remarkGfm, remarkMath];
const REHYPE_PLUGINS: import('unified').PluggableList = [rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeKatex];

// A citation placeholder (addCitationRefs) becomes its chip; any other <sup>
// stays one.
function MarkdownSup(supProps: React.ComponentProps<'sup'> & ExtraProps) {
    const { node, className, ...rest } = supProps;
    void node;
    const data = rest as Record<string, unknown>;
    if (typeof className === 'string' && className.split(' ').includes('source-ref')) {
        const n = parseInt(String(data['data-n'] ?? ''), 10);
        const raws = String(data['data-raw'] ?? '').split(',').map(Number).filter(Number.isFinite);
        const occ = parseInt(String(data['data-occ'] ?? ''), 10);
        if (Number.isNaN(n)) return null;
        return <CitationChip n={n} raws={raws} occ={occ} />;
    }
    return <sup className={className} {...rest} />;
}

/** The text of a hast node (a code fence's `<code>`), as written. */
function hastText(node: { type: string; value?: string; children?: unknown[] }): string {
    if (node.type === 'text') return node.value ?? '';
    return (node.children ?? []).map(c => hastText(c as { type: string })).join('');
}

function buildMarkdownComponents(language: 'de' | 'en') {
    const loadingChartLabel = language === 'en' ? 'Loading chart...' : 'Lade Diagramm...';
    const copyCodeLabel = language === 'en' ? 'Copy code' : 'Code kopieren';
    const copiedCodeLabel = language === 'en' ? 'Copied' : 'Kopiert';
    const collapseCodeLabel = language === 'en' ? 'Collapse code' : 'Code einklappen';
    const expandCodeLabel = language === 'en' ? 'Expand code' : 'Code ausklappen';
    return {
        sup: MarkdownSup,
        // A code fence is the DS CodeBlock (editor look, copy button). A
        // ```chart fence renders through `code` below (ChartRenderer), so its
        // <pre> is dropped rather than framing the chart in a code box.
        pre: (preProps: React.ComponentProps<'pre'> & ExtraProps) => {
            const { node, children } = preProps;
            const first = node?.children?.[0];
            if (!first || first.type !== 'element' || first.tagName !== 'code') return <pre>{children}</pre>;
            const cls = first.properties?.className;
            const lang = Array.isArray(cls)
                ? cls.map(String).find(c => c.startsWith('language-'))?.slice('language-'.length)
                : undefined;
            if (lang === 'chart') return <>{children}</>;
            return (
                <CodeBlock
                    className="my-4"
                    code={hastText(first).replace(/\n$/, '')}
                    language={lang}
                    collapsible
                    copyLabel={copyCodeLabel}
                    copiedLabel={copiedCodeLabel}
                    collapseLabel={collapseCodeLabel}
                    expandLabel={expandCodeLabel}
                />
            );
        },
        table: (tableProps: React.ComponentProps<'table'> & ExtraProps) => {
            const { node, children } = tableProps;
            return <MarkdownTable node={node} filename="table.xlsx">{children}</MarkdownTable>;
        },
        img: (imgProps: React.ComponentProps<'img'> & ExtraProps) => {
            // Strip the react-markdown AST `node` so it isn't spread onto the DOM element.
            const { node, ...props } = imgProps;
            void node;
            // loading="eager", NOT lazy: the message list is virtualized, so the
            // DOM already only holds what is near the viewport and lazy buys
            // nothing. It costs correctness — a lazy image is re-fetched/laid out
            // from zero height on every remount, so a message that scrolls out
            // and back comes back a different height and shifts the scroll
            // position. Eager lets the cached image lay out immediately.
            return <img {...props} alt={props.alt || ''} loading="eager" style={{ maxWidth: '100%', height: 'auto' }} />;
        },
        code({ inline, className, children, ...props }: React.HTMLAttributes<HTMLElement> & { inline?: boolean; node?: unknown }) {
            const match = /language-(\w+)/.exec(className || '');
            // Only a ```chart fence resolves to a chart; every other language
            // falls through ChartRenderer to a plain <pre>. Reserving the chart
            // box for those would make a 3-line snippet flash 350px tall and
            // then collapse — the same height churn this reservation exists to
            // prevent.
            const isChart = match?.[1] === 'chart';
            // Other fences never reach here as blocks: `pre` above renders them.
            return !inline && isChart ? (
                <Suspense fallback={
                    // Reserves the same box the resolved chart occupies
                    // (.chart-container: min-height 350 + 1rem margins), so the
                    // item isn't measured at the spinner's height and then
                    // jumped when the lazy chunk lands.
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'var(--text-secondary)',
                        ...(isChart
                            ? { minHeight: 350, marginTop: '1rem', marginBottom: '1rem' }
                            : { padding: '2rem' }),
                    }}>
                        <Loader2 className="animate-spin" size={24} />
                        <span style={{ marginLeft: '8px' }}>{loadingChartLabel}</span>
                    </div>
                }>
                    <ChartRenderer
                        content={String(children).replace(/\n$/, '')}
                        language={match[1]}
                        {...props}
                    />
                </Suspense>
            ) : (
                <code className={className} {...props}>
                    {children}
                </code>
            );
        }
    };
}

// KI-912 preview: English labels for the DS Reasoning trigger (its defaults are German).
const englishThinkingMessage = (isStreaming: boolean, duration?: number) => {
    if (isStreaming) return <Shimmer as="span" duration={1}>Thinking…</Shimmer>;
    if (duration === undefined) return <span>Thought for a few seconds</span>;
    if (duration < 1) return <span>Thought for less than a second</span>;
    return <span>Thought for {duration === 1 ? '1 second' : `${duration} seconds`}</span>;
};

const MessageContent = memo(({ content, reasoning, isThinking, sources, suspectCitations, citationSpans, citationModel, trajectory, flaggedClaims, onOpenPanel, onShowAllSources, activeCitation, reasoningOpen = false, onToggleReasoning }: MessageContentProps) => {
    const { language, t } = useTheme();
    const markdownComponents = useMemo(() => buildMarkdownComponents(language), [language]);
    const finePointer = useFinePointer();
    const model = useMemo(() => citationModel ?? buildCitationModel(content, sources), [citationModel, content, sources]);
    const bodyRef = useRef<HTMLDivElement>(null);
    const sourcePanel = useSourcePanel();

    // Touch: one bottom sheet per answer, for whichever chip was tapped.
    const [sheet, setSheet] = useState<ChipSheet | null>(null);
    const sheetSource = sheet ? model.cited[sheet.n - 1] : undefined;

    const chipContext = useMemo<CitationChipContextValue>(() => ({
        model,
        spans: citationSpans,
        suspect: suspectCitations,
        activeN: activeCitation?.n ?? null,
        panelOpen: !!sourcePanel?.target,
        finePointer,
        onOpenPanel,
        onShowAll: onShowAllSources,
        openSheet: setSheet,
        sheetOcc: sheet?.occ ?? null,
    }), [model, citationSpans, suspectCitations, activeCitation?.n, sourcePanel?.target, finePointer, onOpenPanel, onShowAllSources, sheet?.occ]);


    // While the source panel shows one of this answer's citations, the
    // sentences that cite that passage are highlighted in the answer — the
    // panel marks the passage, this marks the claim, so the two read as one
    // link. A CSS Custom Highlight (no DOM change); browsers without the API
    // simply show no highlight.
    // Opened from a chip (or stepped to one), the panel names that chip's
    // occurrence: only its sentence is marked, and it is scrolled into view.
    // Opened from the source list, every sentence citing the passage is.
    const activeRaw = activeCitation?.raw;
    const activeOcc = activeCitation?.occ;
    useEffect(() => {
        const root = bodyRef.current;
        if (!root || activeOcc == null) return;
        root.querySelector<HTMLElement>(`.citation-chip[data-occ="${activeOcc}"]`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }, [activeOcc]);
    useEffect(() => {
        const root = bodyRef.current;
        const highlights = typeof CSS !== 'undefined' ? (CSS as unknown as { highlights?: Map<string, unknown> }).highlights : undefined;
        if (!root || activeRaw == null || !highlights || typeof Highlight === 'undefined') return;
        const ranges = [...root.querySelectorAll<HTMLElement>('.citation-chip[data-raw]')]
            .filter(chip => (activeOcc != null
                ? chip.dataset.occ === String(activeOcc)
                : (chip.dataset.raw ?? '').split(',').includes(String(activeRaw))))
            .map(chip => citingRange(chip, CITED_BLOCK_SELECTOR, '.citation-chip'))
            .filter((r): r is Range => r !== null);
        if (ranges.length === 0) return;
        highlights.set('citation-focus', new Highlight(...ranges));
        return () => { highlights.delete('citation-focus'); };
    }, [activeRaw, activeOcc, content]);

    const closeSheet = useCallback(() => setSheet(null), []);
    const sheetPassage = sheet && sheetSource ? passageFor(sheetSource, sheet.raw) : undefined;
    const sheetReason = sheet ? suspectCitations?.get(sheet.raw) : undefined;
    const citing = useMemo(() => citingTextByRaw(content), [content]);

    return (
        <>
            {trajectory && trajectory.length > 0 && (
                <TrajectoryPanel trajectory={trajectory} language={language} />
            )}
            {reasoning && (
                <Reasoning
                    className="mb-4"
                    isStreaming={!!isThinking}
                    defaultOpen={reasoningOpen || !!isThinking}
                    onOpenChange={(open) => { if (open !== reasoningOpen) onToggleReasoning?.(); }}
                >
                    <ReasoningTrigger getThinkingMessage={language === 'en' ? englishThinkingMessage : undefined} />
                    <ReasoningContent lang={/[äöüß]/i.test(reasoning) ? undefined : 'en'}>
                        <div className="markdown-content">
                            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={markdownComponents}>
                                {normalizeMathDelimiters(reasoning)}
                            </ReactMarkdown>
                        </div>
                    </ReasoningContent>
                </Reasoning>
            )}
            <CitationChipContext.Provider value={chipContext}>
                <div className="markdown-content" ref={bodyRef}>
                    <ReactMarkdown
                        remarkPlugins={REMARK_PLUGINS}
                        rehypePlugins={REHYPE_PLUGINS}
                        components={markdownComponents}
                    >
                        {addFlaggedClaimHighlights(addCitationRefs(normalizeMathDelimiters(content), model), flaggedClaims, language)}
                    </ReactMarkdown>
                </div>
            </CitationChipContext.Provider>
            {!finePointer && (
                <Drawer open={sheetSource != null} onOpenChange={(open) => { if (!open) closeSheet(); }}>
                    <DrawerContent
                        aria-describedby={undefined}
                        className="px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
                        onCloseAutoFocus={(e) => {
                            // No DrawerTrigger: hand focus back to the chip by hand.
                            const occ = sheet?.occ;
                            if (occ == null) return;
                            e.preventDefault();
                            bodyRef.current?.querySelector<HTMLElement>(`.citation-chip[data-occ="${occ}"]`)?.focus();
                        }}
                    >
                        {sheetSource && sheet && sheetPassage && (
                            <>
                                <DrawerTitle className="sr-only">{fillTemplate(t('citationChipLabel'), { n: sheetSource.n, title: sheetSource.title })}</DrawerTitle>
                                <div className="flex justify-end">
                                    <DrawerClose asChild>
                                        <Button type="button" variant="ghost" size="icon" aria-label={t('close')}>
                                            <X className="size-5" aria-hidden="true" />
                                        </Button>
                                    </DrawerClose>
                                </div>
                                <SourcePreview
                                    variant="sheet"
                                    source={sheetSource}
                                    passage={sheetSource.passages[sheetPassage.index]}
                                    span={citationSpans?.get(sheetPassage.raw)}
                                    focus={citing.get(sheetPassage.raw)}
                                    notice={sheetReason ? t(sheetReason === 'out_of_range' ? 'citationSuspectOutOfRange' : 'citationSuspectNoOverlap') : undefined}
                                    totalSources={model.cited.length}
                                    onShowAll={onShowAllSources ? () => { closeSheet(); onShowAllSources(); } : undefined}
                                    onOpenSource={onOpenPanel ? () => { closeSheet(); onOpenPanel(sheetSource.n, sheetPassage.raw, undefined, sheet.occ); } : undefined}
                                />
                            </>
                        )}
                    </DrawerContent>
                </Drawer>
            )}
        </>
    );
});

export default MessageContent;
