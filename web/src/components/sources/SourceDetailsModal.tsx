import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, FileText, GitBranch, Maximize2, Minimize2, RefreshCw, Rss, Trash2 } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogTitle, cn } from '@ki4jlu/design-system';
import type { FileEntry, SyncSchedule } from '../../types';
import { sourceDetailsTitle, type SourceDetailsTarget } from './sourceDetails';
import { useTheme } from '../../contexts/ThemeContext';
import { IngestStageIndicator } from '../sidebar/IngestStageIndicator';

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
const KIND_LABEL = { rss: 'sourceKindRss', confluence: 'sourceKindConfluence', git: 'sourceKindGit' } as const;

type Tone = 'ok' | 'error' | 'busy';

/** A coloured status dot: green done, red failed, amber still running. */
function Dot({ tone }: { tone: Tone }) {
    return (
        <span
            aria-hidden="true"
            data-tone={tone}
            className={cn(
                'inline-block size-2 shrink-0 rounded-full',
                tone === 'ok' ? 'bg-success' : tone === 'error' ? 'bg-error' : 'bg-warning',
            )}
        />
    );
}

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
    const dateTime = (iso: string | null) => (iso
        ? new Date(iso).toLocaleString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '–');
    const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
    const scheduleLabel: Record<SyncSchedule, string> = {
        manual: t('syncScheduleManual'),
        daily: t('syncScheduleDaily'),
        weekly: t('syncScheduleWeekly'),
    };
    const statusLabel = s.status === 'active' ? t('active')
        : s.status === 'paused' ? t('paused')
        : s.status === 'syncing' ? t('syncing')
        : t('feedError');
    const statusTone: Tone = s.status === 'error' ? 'error' : s.status === 'active' ? 'ok' : 'busy';

    const [count, countLabel, lastLabel, lastAt] = target.kind === 'rss'
        ? [target.source.itemCount, t('items'), t('lastPolled'), target.source.lastPolledAt]
        : target.kind === 'confluence'
            ? [target.source.pageCount, t('pages'), t('lastSynced'), target.source.lastSyncedAt]
            : [target.source.fileCount, t('gitFiles'), t('lastSynced'), target.source.lastSyncedAt];
    const progress = (target.kind === 'confluence' || target.kind === 'git') && target.source.status === 'syncing' && target.source.syncTotal > 0
        ? `${target.source.syncProgress}/${target.source.syncTotal} ${t('filesProcessed')}`
        : null;
    // Only a scheduled source has a next run; a manual one may still carry a stale value.
    const nextAt = s.syncSchedule !== 'manual' ? s.nextSyncAt : null;

    const entryStatus = (f: FileEntry): [string, Tone] =>
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
                aria-describedby={undefined}
            >
                {/* Header actions and the strip's last button align with the dialog's close
                    button through its custom properties (DS Dialog): the header keeps
                    `--dialog-close-reserve` clear, the strip ends at `--dialog-close-inset`. */}
                <div className="flex items-center gap-3 pt-5 pr-[calc(var(--dialog-close-reserve)_+_0.5rem)] pb-4 pl-6">
                    <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-primary-fixed text-primary">
                        <Icon className="size-5" />
                    </span>
                    <div className="min-w-0">
                        <DialogTitle className="truncate">{sourceDetailsTitle(target)}</DialogTitle>
                        <p className="m-0 flex flex-wrap items-center gap-x-1.5 text-sm text-on-surface-variant" data-testid="source-details-summary">
                            <span>{t(KIND_LABEL[target.kind])}</span>
                            <span aria-hidden="true">·</span>
                            <span>{count} {countLabel}</span>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1.5"><Dot tone={statusTone} />{statusLabel}</span>
                            {progress && <><span aria-hidden="true">·</span><span>{progress}</span></>}
                        </p>
                    </div>
                </div>

                <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 border-y border-outline-variant py-1.5 pr-[var(--dialog-close-inset)] pl-6 text-sm" data-testid="source-details-sync">
                    <span className="inline-flex items-center gap-2 text-on-surface">
                        <RefreshCw className="size-4 text-on-surface-variant" aria-hidden="true" />
                        {scheduleLabel[s.syncSchedule]}
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
                                                <FileText className="size-[18px]" aria-hidden="true" />
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
                                                    <Dot tone={tone} />{label} · {day(file.createdAt)}
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
