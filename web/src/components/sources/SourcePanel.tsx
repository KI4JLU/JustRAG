import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import axios from 'axios';
import { ChevronDown, ChevronUp, ExternalLink, Maximize2, X } from 'lucide-react';
import {
    Button, Dialog, DialogContent, DialogDescription, DialogTitle, buttonVariants, cn,
} from '@ki4jlu/design-system';
import { API_BASE_URL } from '../../api';
import { useTheme } from '../../contexts/ThemeContext';
import type { SourcePanelTarget } from '../../contexts/SourcePanelContext';
import { formatPageRanges } from '../../utils/citations';
import { SOURCE_KIND_LABEL_KEY, fillTemplate, originUrlOf } from '../../utils/sourceDisplay';
import { SourceExcerpt } from './SourceExcerpt';
import { SourceNumber } from './SourcePreview';

const PANEL_WIDTH = 480;

interface SourcePanelProps {
    target: SourcePanelTarget;
    onClose: () => void;
    /** Moves to another cited passage (an index into target.source.passages). */
    onPassage: (passage: number) => void;
    /** The file's origin (`files.origin`: confluence, rss, upload, …), when the source list is visible. */
    fileOrigin?: string;
    /** Opens the document preview modal (needs downloadSources). */
    onPdfOpen?: (fileId: string, fileName: string, page: number) => void;
    onPreviewSource?: (fileId: string, fileName: string) => void;
    /** Whether the original may be downloaded (downloadSources). */
    canDownload: boolean;
    /** Full screen instead of a pane beside the answer (narrow or touch layout). */
    fullScreen?: boolean;
}

async function downloadFile(fileId: string, fileName: string) {
    const res = await axios.get(`${API_BASE_URL}/api/files/${fileId}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
}

// Feed items and imported pages carry their origin as a "Source: <url>"
// header line in the stored text; a cited passage often is not the first
// one, so the file is read once when it may carry it.
function useOriginUrl(target: SourcePanelTarget, fileOrigin: string | undefined, canDownload: boolean): string | undefined {
    const { source } = target;
    const inPassages = useMemo(() => source.passages.map(p => originUrlOf(p.content ?? '')).find(Boolean), [source]);
    const mayCarry = !inPassages && canDownload && !!source.fileId
        && (fileOrigin === 'confluence' || fileOrigin === 'rss')
        && (source.kind === 'markdown' || source.kind === 'text' || source.kind === 'document');
    const [fetched, setFetched] = useState<{ fileId: string; url?: string } | null>(null);
    useEffect(() => {
        if (!mayCarry || !source.fileId) return;
        let cancelled = false;
        const fileId = source.fileId;
        axios.get(`${API_BASE_URL}/api/files/${fileId}/download`, { responseType: 'text' })
            .then((res) => { if (!cancelled) setFetched({ fileId, url: originUrlOf(String(res.data).slice(0, 4000)) }); })
            .catch(() => { if (!cancelled) setFetched({ fileId }); });
        return () => { cancelled = true; };
    }, [mayCarry, source.fileId]);
    return inPassages ?? (fetched && fetched.fileId === source.fileId ? fetched.url : undefined);
}

/**
 * „In Quelle öffnen": one cited source beside the answer (non-modal, the
 * answer stays readable and its cited paragraph marked). It opens at the
 * passage the chip pointed at; every passage the answer cites from this
 * source is listed in document order, the active one strong, the others
 * light, with "1 von N" to step through them. ⤢ opens the full document
 * preview.
 */
export function SourcePanel({ target, onClose, onPassage, fileOrigin, onPdfOpen, onPreviewSource, canDownload, fullScreen = false }: SourcePanelProps) {
    const { t } = useTheme();
    const { source, passage, spans, citing, focus } = target;
    const originUrl = useOriginUrl(target, fileOrigin, canDownload);

    // Document order where the pages say it, else the order the answer cites them.
    const order = useMemo(() => source.passages
        .map((p, i) => ({ i, page: p.pages?.[0] ?? Number.MAX_SAFE_INTEGER }))
        .sort((a, b) => a.page - b.page || a.i - b.i)
        .map(x => x.i), [source]);
    const position = Math.max(0, order.indexOf(passage));
    const total = order.length;

    const refs = useRef<Map<number, HTMLElement>>(new Map());
    // Scroll to the first highlight of the active passage (the passage itself
    // when nothing is marked) — after the panel has laid out, and once more
    // when its slide-in has settled, so a tall passage does not leave the
    // mark below the fold.
    useEffect(() => {
        const go = () => {
            const section = refs.current.get(passage);
            (section?.querySelector('mark') ?? section)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        };
        const frame = requestAnimationFrame(go);
        const late = setTimeout(go, 350);
        return () => { cancelAnimationFrame(frame); clearTimeout(late); };
    }, [passage, source, focus]);

    const activePages = source.passages[passage]?.pages;
    // The full view (preview modal) renders PDF, spreadsheet, Markdown and plain
    // text only; for Word, slides and other files ⤢ would just raise the
    // "no preview" toast, so it is not offered and the panel stays the view.
    const FULL_VIEW_KINDS = ['pdf', 'table', 'markdown', 'text'];
    const canFullView = !!source.fileId && FULL_VIEW_KINDS.includes(source.kind)
        && (source.kind === 'pdf' ? !!onPdfOpen : !!onPreviewSource);
    const openFullView = () => {
        if (!source.fileId) return;
        if (source.kind === 'pdf') onPdfOpen?.(source.fileId, source.fileName, activePages?.[0] || 1);
        else onPreviewSource?.(source.fileId, source.fileName);
    };
    const canDownloadFile = canDownload && !!source.fileId;
    const meta = `${t(SOURCE_KIND_LABEL_KEY[source.kind])} · ${t('sourcePanelReadOnly')}`;

    const headerActions = (
        <>
            {canFullView && (
                <Button type="button" variant="ghost" size="icon" aria-label={t('sourcePanelFullView')} title={t('sourcePanelFullView')} onClick={openFullView}>
                    <Maximize2 className="size-4" aria-hidden="true" />
                </Button>
            )}
        </>
    );

    const title = (titleNode: ReactNode, metaNode: ReactNode) => (
        <div className="flex min-w-0 flex-1 items-center gap-3">
            <SourceNumber n={source.n} active />
            <div className="min-w-0 flex-1">
                {titleNode}
                {metaNode}
            </div>
            {headerActions}
        </div>
    );

    const body = (
        <>
            <div className="flex shrink-0 items-center gap-2 border-b border-outline-variant bg-surface-container-low px-4 py-2 text-sm text-on-surface-variant">
                <span className="min-w-0 flex-1 truncate">
                    {total === 1 ? t('sourcePanelPassagesOne') : fillTemplate(t('sourcePanelPassages'), { count: total })}
                </span>
                {total > 1 && (
                    <>
                        <span className="shrink-0 tabular-nums text-on-surface" aria-live="polite">
                            {fillTemplate(t('sourcePanelPosition'), { current: position + 1, total })}
                        </span>
                        <Button type="button" variant="outline" size="icon" aria-label={t('sourcePanelPrevious')} disabled={position === 0} onClick={() => onPassage(order[position - 1])}>
                            <ChevronUp className="size-4" aria-hidden="true" />
                        </Button>
                        <Button type="button" variant="outline" size="icon" aria-label={t('sourcePanelNext')} disabled={position >= total - 1} onClick={() => onPassage(order[position + 1])}>
                            <ChevronDown className="size-4" aria-hidden="true" />
                        </Button>
                    </>
                )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <ol className="m-0 flex list-none flex-col gap-2 p-0">
                    {order.map((pi) => {
                        const p = source.passages[pi];
                        const active = pi === passage;
                        const raw = source.rawNumbers[pi];
                        return (
                            <li key={raw} className="flex flex-col gap-2">
                                <span className="px-4 text-xs text-on-surface-variant" aria-hidden="true">[…]</span>
                                <section
                                    ref={(el) => { if (el) refs.current.set(pi, el); else refs.current.delete(pi); }}
                                    aria-current={active ? 'location' : undefined}
                                    className={cn(
                                        'rounded-lg p-4 text-sm text-on-surface',
                                        active ? 'bg-surface-container-lowest' : 'cursor-pointer bg-surface-container-low',
                                    )}
                                    onClick={active ? undefined : () => onPassage(pi)}
                                    onKeyDown={active ? undefined : (e) => { if (e.key === 'Enter') onPassage(pi); }}
                                    tabIndex={active ? -1 : 0}
                                >
                                    {p.pages && p.pages.length > 0 && (
                                        <div className="mb-2 text-xs text-on-surface-variant">{t('pageAbbrev')} {formatPageRanges(p.pages)}</div>
                                    )}
                                    <SourceExcerpt content={p.content ?? ''} span={spans?.get(raw)} focus={(active && focus) || citing?.get(raw)} />
                                </section>
                            </li>
                        );
                    })}
                    <li className="px-4 text-xs text-on-surface-variant" aria-hidden="true">[…]</li>
                </ol>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-outline-variant px-4 py-3">
                <Button type="button" variant="outline" size="sm" onClick={onClose}>{t('sourcePanelBack')}</Button>
                {/* An online source (Confluence, crawl, RSS …) is opened at its origin; only a
                    file without one is offered for download. */}
                {originUrl ? (
                    <a href={originUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: 'sm' })}>
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                        {fileOrigin === 'confluence' ? t('openInConfluence') : t('openOriginal')}
                    </a>
                ) : canDownloadFile && (
                    <Button type="button" size="sm" onClick={() => { void downloadFile(source.fileId!, source.fileName).catch(() => {}); }}>
                        {t('sourcePanelDownload')}
                    </Button>
                )}
            </div>
        </>
    );

    if (fullScreen) {
        return (
            <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
                <DialogContent
                    closeLabel={t('sourcePanelClose')}
                    className="flex h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0"
                >
                    <div className="flex h-16 shrink-0 items-center gap-3 border-b border-outline-variant pr-14 pl-4">
                        {title(
                            <DialogTitle className="truncate text-base font-semibold">{source.title}</DialogTitle>,
                            <DialogDescription className="truncate text-xs">{meta}</DialogDescription>,
                        )}
                    </div>
                    {body}
                </DialogContent>
            </Dialog>
        );
    }

    // A dismissible panel, not a collapsible column: no SidePanel rail or
    // collapse toggle, just ✕ at the right end of the header.
    return (
        <aside
            aria-label={t('sourcePanelLabel')}
            style={{ width: PANEL_WIDTH }}
            className="flex h-full max-w-full shrink-0 flex-col border-l border-outline-variant bg-surface"
        >
            <div className="flex h-16 shrink-0 items-center gap-2 border-b border-outline-variant px-4">
                {title(
                    <div className="truncate text-base font-semibold text-on-surface" title={source.title}>{source.title}</div>,
                    <div className="truncate text-xs text-on-surface-variant">{meta}</div>,
                )}
                <Button type="button" variant="ghost" size="icon" aria-label={t('sourcePanelClose')} title={t('sourcePanelClose')} onClick={onClose}>
                    <X className="size-4" aria-hidden="true" />
                </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{body}</div>
        </aside>
    );
}
