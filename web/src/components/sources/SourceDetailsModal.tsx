import React, { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, GitBranch, Maximize2, Minimize2, RefreshCw, Rss, Trash2 } from 'lucide-react';
import { Button, Dialog, DialogContent, cn } from '@ki4jlu/design-system';
import type { FileEntry } from '../../types';
import { sourceDetailsTitle, type SourceDetailsTarget } from './sourceDetails';
import { useTheme } from '../../contexts/ThemeContext';
import { IngestStageIndicator } from '../sidebar/IngestStageIndicator';
import { PreviewHeaderBand } from '../PreviewDialog';
import { sourceIconFor } from '../sidebar/sourceIconFor';
import { useSourceFacts } from './sourceFacts';
import { SourceStatusDot, type SourceTone } from './SourceStatusDot';

/** An entry's file-type glyph, as in the source list. */
function EntryIcon({ file }: { file: FileEntry }) {
    return createElement(sourceIconFor(file), { className: 'size-[18px]', 'aria-hidden': true });
}

interface SourceDetailsModalProps {
    target: SourceDetailsTarget;
    /** The source's own files (its entries); omitted, no entry list. */
    files?: FileEntry[];
    /** Absent for a caller without capabilities.manageSources: no delete button. */
    onDeleteFile?: (fileId: string, e: React.MouseEvent) => void;
    /** Opens an entry's source preview on a row click; absent without
     *  capabilities.downloadSources (rows are then display-only). */
    onOpenFile?: (file: FileEntry) => void;
    onClose: () => void;
}

const KIND_ICON = { rss: Rss, confluence: BookOpen, git: GitBranch } as const;
/**
 * Everything about a synced source (RSS feed, Confluence space, git
 * repository) that the source list does not show: a header with its kind,
 * size and state, a strip with its schedule and its last and next sync, its
 * error, and — where the files can be attributed — its entries as a table
 * (entry, processing status, delete). The list row is the type chip and the
 * title alone. The dialog can be enlarged to nearly the full window.
 */
export const SourceDetailsModal: React.FC<SourceDetailsModalProps> = ({ target, files, onDeleteFile, onOpenFile, onClose }) => {
    const { t, language } = useTheme();
    const [maximized, setMaximized] = useState(false);
    // The width a classic (non-overlay) scrollbar takes from the entry list,
    // as `--scrollbar-w`: the delete column subtracts it, so its buttons stay
    // on the close button's right edge whether the list scrolls or not.
    // A callback ref: the dialog's content mounts after this component's
    // first effect (Radix portal), so an effect on a ref object would miss it.
    const observerRef = useRef<ResizeObserver | null>(null);
    const scrollRef = useCallback((el: HTMLDivElement | null) => {
        observerRef.current?.disconnect();
        observerRef.current = null;
        if (!el) return;
        const update = () => el.style.setProperty('--scrollbar-w', `${el.offsetWidth - el.clientWidth}px`);
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        if (el.firstElementChild) ro.observe(el.firstElementChild);
        observerRef.current = ro;
    }, []);
    useEffect(() => () => observerRef.current?.disconnect(), []);
    const s = target.source;
    const locale = language === 'en' ? 'en-GB' : 'de-DE';
    const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
    const {
        kindLabel, count, countLabel, statusLabel, statusTone, progress, schedule, lastLabel, lastAt, nextAt, dateTime,
    } = useSourceFacts(target);

    const entryStatus = (f: FileEntry): [string, SourceTone] =>
        f.status === 'completed' ? [t('entryStatusCompleted'), 'ok']
        : f.status === 'error' ? [t('entryStatusError'), 'error']
        : f.status === 'processing' ? [t('entryStatusProcessing'), 'busy']
        : [t('entryStatusPending'), 'busy'];

    const Icon = KIND_ICON[target.kind];
    const sep = <span aria-hidden="true" className="h-5 w-px shrink-0 bg-outline-variant" />;

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent
                className={cn(
                    'flex max-w-none flex-col gap-0 overflow-hidden p-0',
                    maximized ? 'h-[92vh] w-[96vw]' : 'h-[min(80vh,760px)] w-[min(90vw,880px)]',
                )}
                closeLabel={t('close')}
            >
                {/* The same header band as every preview (PreviewHeaderBand): the
                    entry list of a feed, a Confluence space or a repository reads
                    like the previews it opens. The strip's last button aligns with
                    the dialog's close button (DS Dialog `--dialog-close-inset`). */}
                <PreviewHeaderBand
                    kind="text"
                    icon={Icon}
                    title={sourceDetailsTitle(target)}
                    fileTitle={false}
                    subtitle={(
                        <span data-testid="source-details-summary">
                            {kindLabel}
                            <span aria-hidden="true"> · </span>
                            {count} {countLabel}
                            <span aria-hidden="true"> · </span>
                            <span className="inline-flex items-center gap-1.5 align-middle"><SourceStatusDot tone={statusTone} />{statusLabel}</span>
                            {progress && <><span aria-hidden="true"> · </span>{progress}</>}
                        </span>
                    )}
                    toolbar={(
                        <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 border-y border-outline-variant py-1.5 pr-[var(--dialog-close-inset)] pl-5 text-sm" data-testid="source-details-sync">
                            <span className="inline-flex items-center gap-2 text-on-surface">
                                <RefreshCw className="size-4 text-on-surface-variant" aria-hidden="true" />
                                {schedule}
                            </span>
                            {sep}
                            <span className="text-on-surface-variant">{lastLabel} <span className="text-on-surface">{dateTime(lastAt)}</span></span>
                            {nextAt && (
                                <>
                                    {sep}
                                    <span className="text-on-surface-variant">{t('nextRun')} <span className="text-on-surface">{dateTime(nextAt)}</span></span>
                                </>
                            )}
                            <Button
                                variant="ghost"
                                size="icon"
                                className="ml-auto text-on-surface-variant"
                                onClick={() => setMaximized(m => !m)}
                                aria-label={maximized ? t('dialogRestore') : t('dialogMaximize')}
                                title={maximized ? t('dialogRestore') : t('dialogMaximize')}
                            >
                                {maximized ? <Minimize2 className="size-4" aria-hidden="true" /> : <Maximize2 className="size-4" aria-hidden="true" />}
                            </Button>
                        </div>
                    )}
                />

                {s.status === 'error' && s.errorMessage && (
                    <p className="m-0 border-b border-outline-variant bg-error/10 px-6 py-2 text-sm text-error">{s.errorMessage}</p>
                )}

                {files && (
                    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
                        <table className="w-full border-collapse text-sm">
                            <thead className="sticky top-0 z-[1] bg-surface-container-low text-on-surface-variant">
                                <tr>
                                    <th className="w-12 p-0" aria-hidden="true" />
                                    <th className="h-10 px-0 text-left font-normal">{t('sourceEntry')}</th>
                                    <th className="w-56 px-4 text-left font-normal">{t('sourceStatus')}</th>
                                    <th className="w-[52px] p-0"><span className="sr-only">{t('columnActions')}</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {files.length === 0 && (
                                    <tr><td colSpan={4} className="p-8 text-center text-on-surface-variant">{t('rssNoEntries')}</td></tr>
                                )}
                                {files.map(file => {
                                    const [label, tone] = entryStatus(file);
                                    return (
                                        <tr
                                            key={file.id}
                                            className={cn('border-b border-outline-variant', onOpenFile && 'cursor-pointer hover:bg-surface-container-low')}
                                            onClick={onOpenFile ? () => onOpenFile(file) : undefined}
                                        >
                                            <td className="py-3 pr-3 pl-6 align-middle text-on-surface-variant">
                                                <EntryIcon file={file} />
                                            </td>
                                            <td className="max-w-0 py-3 align-middle">
                                                {onOpenFile ? (
                                                    // The row is the pointer target; this button is its keyboard path and name.
                                                    // eslint-disable-next-line design-system/no-raw-ui-elements -- a text-only row title, like SidebarCard's title button
                                                    <button
                                                        type="button"
                                                        className="block max-w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left text-on-surface focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
                                                        title={file.name}
                                                        onClick={(e) => { e.stopPropagation(); onOpenFile(file); }}
                                                    >
                                                        {file.name}
                                                    </button>
                                                ) : (
                                                    <span className="block truncate text-on-surface" title={file.name}>{file.name}</span>
                                                )}
                                                {file.currentStage && (
                                                    <IngestStageIndicator
                                                        stage={file.currentStage}
                                                        index={file.stageIndex}
                                                        total={file.stageTotal}
                                                        fileName={file.name}
                                                    />
                                                )}
                                            </td>
                                            <td className="px-4 py-3 align-middle">
                                                <span className={cn('inline-flex items-center gap-2 text-xs whitespace-nowrap', tone === 'error' ? 'text-error' : 'text-on-surface-variant')}>
                                                    <SourceStatusDot tone={tone} />{label} · {day(file.createdAt)}
                                                </span>
                                            </td>
                                            <td className="py-2 pr-[calc(var(--dialog-close-inset)_-_var(--scrollbar-w,0px))] text-right align-middle">
                                                {onDeleteFile && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="text-on-surface-variant hover:text-error"
                                                        onClick={(e) => { e.stopPropagation(); onDeleteFile(file.id, e); }}
                                                        title={t('delete')}
                                                        aria-label={`${t('delete')} ${file.name}`}
                                                    >
                                                        <Trash2 className="size-4" aria-hidden="true" />
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
