import React, { createElement, memo } from 'react';
import {
    Download, Trash2, ListChecks,
    RefreshCw, Pause, Play, Info, ShieldAlert, CalendarClock,
} from 'lucide-react';
import { Button, SidebarCard, SidebarCardList, type ActionMenuItem } from '@ki4jlu/design-system';
import type { FileEntry, RssFeed, ConfluenceSource, GitRepoSource, SyncSchedule } from '../../types';
import { useTheme } from '../../contexts/ThemeContext';
import { sourceIconFor, sourceTypeLabel } from './sourceIconFor';
import { SourceHoverPreview } from './SourceHoverPreview';
import { useSourcePreviews } from '../../hooks/sourcePreviews';
import { cardFiles, confluenceKey, feedExcluded, feedKey, fileKey, gitKey, syncedExcluded, type SourceKey } from './sourceSelection';
import { SOURCE_TYPE_CHIP, sourceDetailsTitle, type SourceDetailsTarget } from '../sources/sourceDetails';
import { INGEST_STAGE_LABEL_KEYS } from '../../utils/ingestStages';

interface SourcesSectionProps {
    files: FileEntry[];
    onPreviewSource: (file: FileEntry) => void;
    /** The open mode's ticked rows (see sourceSelection.ts): null = no mode,
     *  and then no card carries a checkbox. */
    selection: ReadonlySet<SourceKey> | null;
    /** `destructive` while the mode is a remove selection: ticked rows read red. */
    selectionTone: 'default' | 'destructive';
    /** Opens the filter mode ("Auswählen"). */
    onStartSelection: () => void;
    /** Opens the remove mode with this row ticked (a row's "Entfernen"). */
    onStartRemoval: (key: SourceKey) => void;
    onToggleSelected: (key: SourceKey, selected: boolean) => void;
    onDownloadFile: (id: string) => void;
    /** Whether the caller may change the KB's existing sources
     *  (capabilities.manageSources — role edit or better). false hides delete,
     *  retry, sync, pause and the schedule picker: the backend would refuse
     *  each of them with a 403. Required, so a new call site cannot forget it
     *  and show a viewer dead controls. */
    canManage: boolean;
    /** Whether the caller may download the KB's sources
     *  (capabilities.downloadSources). false drops the Download action, the
     *  hover preview (it is built from the downloaded file) and the preview on
     *  click — the card is then display-only (DS SidebarCard without onOpen:
     *  the title is plain text); in selection mode a click still ticks it. Required for
     *  the same reason as canManage. */
    canDownload: boolean;
    rssFeeds: RssFeed[];
    onUpdateRssFeed: (feedId: string, updates: { syncSchedule?: SyncSchedule; status?: 'active' | 'paused' }) => void;
    onPollFeedNow: (feedId: string) => void;
    /** Opens a synced source's details (state, counts, sync times, entries). */
    onViewSource: (target: SourceDetailsTarget) => void;
    confluenceSources: ConfluenceSource[];
    onUpdateConfluenceSource: (sourceId: string, updates: { includeAttachments?: boolean; syncSchedule?: SyncSchedule; status?: 'active' | 'paused' }) => void;
    onSyncConfluenceNow: (sourceId: string) => void;
    gitRepoSources: GitRepoSource[];
    onUpdateGitRepoSource: (sourceId: string, updates: { syncSchedule?: SyncSchedule; status?: 'active' | 'paused' }) => void;
    onSyncGitRepoNow: (sourceId: string) => void;
    onRetryFile: (id: string) => void;
}

// Stable empty list for useSourcePreviews when nothing may be previewed.
const NO_FILES: FileEntry[] = [];

// Maps files.error_stage values (backend vocabulary, see
// files.PGStore.MarkFileError) to translation keys. An unknown stage shows
// fileErrorUnknown: errorMessage is the backend's technical text and is
// never shown.
const ERROR_STAGE_KEYS: Record<string, string> = {
    unsupported_type: 'fileErrorUnsupportedType',
    parse: 'fileErrorParse',
    embedding: 'fileErrorEmbedding',
    canceled: 'fileErrorCanceled',
    processing: 'fileErrorProcessing',
    timeout: 'fileErrorTimeout',
    queue: 'fileErrorQueue',
};

// Extensions the spreadsheet parser handles (parser.SpreadsheetParser),
// deliberately excluding .xlsm (macro-enabled workbooks, out of scope) — the
// "Tabellen" file-detail button only makes sense for these.
const SourcesSectionComp: React.FC<SourcesSectionProps> = ({
    files, onPreviewSource, selection, selectionTone, onStartSelection, onStartRemoval, onToggleSelected,
    onDownloadFile, canManage, canDownload,
    rssFeeds, onUpdateRssFeed, onPollFeedNow, onViewSource,
    confluenceSources, onUpdateConfluenceSource, onSyncConfluenceNow,
    gitRepoSources, onUpdateGitRepoSource, onSyncGitRepoNow,
    onRetryFile
}) => {
    const { t } = useTheme();
    const selecting = selection !== null;

    const nonRssFiles = cardFiles(files);
    // Hover previews are prepared ahead of the hover (see sourcePreviews.ts) —
    // only for a caller who may download, since the preview IS the download.
    useSourcePreviews(canDownload ? nonRssFiles : NO_FILES);

    // Untrusted, document-derived text: it goes into title/aria-label as a
    // plain string and is never rendered as markup. The per-KB count of
    // flagged external-origin files is SourcesHeader's, above the list.
    const injectionLabel = (file: FileEntry) => {
        const snippet = file.injectionDetail?.snippet;
        return snippet ? `${t('fileInjectionFlagged')}: ${snippet}` : t('fileInjectionFlagged');
    };
    const errorLabel = (file: FileEntry) => {
        if (file.errorStage && ERROR_STAGE_KEYS[file.errorStage]) return t(ERROR_STAGE_KEYS[file.errorStage]);
        return t('fileErrorUnknown');
    };

    /* A Confluence / git row in either mode: ticked like any row. */
    const selectableRow = (key: SourceKey) => ({
        selectable: selecting,
        selectionMode: selecting,
        selectionTone,
        selected: selection?.has(key) ?? false,
        onSelectedChange: (sel: boolean) => onToggleSelected(key, sel),
        selectLabel: t('selectSource'),
    });

    const scheduleLabel: Record<SyncSchedule, string> = {
        manual: t('syncScheduleManual'),
        daily: t('syncScheduleDaily'),
        weekly: t('syncScheduleWeekly'),
    };

    /* A synced source's row is its type chip and title; everything else
       (state, counts, sync times, entries) is in its details dialog. Only a
       failure shows on the row — tinted red, the message as its tooltip —
       because it needs acting on. */
    // The tooltip of a row in progress: "3/4 Embeddings werden erzeugt", or queued.
    const busyLabel = (file: FileEntry) => {
        if (!file.currentStage) return t('fileStatusPending');
        const label = t(INGEST_STAGE_LABEL_KEYS[file.currentStage] ?? 'ingestStageGeneric');
        return file.stageIndex && file.stageTotal ? `${file.stageIndex}/${file.stageTotal} ${label}` : label;
    };
    const errorOf = (source: { status: string; errorMessage?: string | null }) => (source.status === 'error'
        ? (source.errorMessage || t('feedError'))
        : undefined);

    /* The management actions of a synced source, in its ⋯ menu: sync now,
       pause/resume, the schedule as a submenu, remove. */
    const manageActions = ({ status, schedule, onSync, syncLabel, onToggle, toggleDisabled, onSchedule, onRemove }: {
        status: string;
        schedule: SyncSchedule;
        onSync: () => void;
        syncLabel: string;
        onToggle: () => void;
        toggleDisabled?: boolean;
        onSchedule: (s: SyncSchedule) => void;
        onRemove: () => void;
    }): ActionMenuItem[] => [
        { label: syncLabel, icon: <RefreshCw size={16} aria-hidden="true" />, onSelect: onSync, separatorBefore: true },
        {
            label: status === 'active' ? t('pause') : t('resume'),
            icon: status === 'active' ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />,
            onSelect: onToggle,
            disabled: toggleDisabled,
        },
        {
            label: t('syncScheduleLabel'),
            icon: <CalendarClock size={16} aria-hidden="true" />,
            submenu: (['manual', 'daily', 'weekly'] as const).map((v) => ({
                label: scheduleLabel[v],
                checked: v === schedule,
                onSelect: () => onSchedule(v),
            })),
        },
        { label: t('removeSource'), icon: <Trash2 size={16} aria-hidden="true" />, destructive: true, separatorBefore: true, onSelect: onRemove },
    ];

    return (
        <SidebarCardList iconSlot="badge" className="sidebar-left__files-section">
                {nonRssFiles.map(file => {
                    const card = (
                        <SidebarCard
                            key={file.id}
                            icon={createElement(sourceIconFor(file), { 'aria-hidden': true })}
                            iconText={sourceTypeLabel(file) ?? undefined}
                            title={file.name}
                            // A failed ingest: the row is tinted red, the message is its tooltip.
                            error={file.status === 'error' ? errorLabel(file) : undefined}
                            // Queued or ingesting: a spinner on the tile, the stage as its tooltip.
                            busy={file.status === 'pending' || file.status === 'processing' ? busyLabel(file) : undefined}
                            onOpen={canDownload ? () => onPreviewSource(file) : undefined}
                            meta={<>
                                {file.injectionFlag && (
                                    <div
                                        className="sidebar-left__file-injection"
                                        title={injectionLabel(file)}
                                        aria-label={injectionLabel(file)}
                                        style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--warning-text, var(--text-secondary))', fontSize: '0.75rem' }}
                                    >
                                        <ShieldAlert size={12} aria-hidden="true" /> {t('fileInjectionFlagged')}
                                    </div>
                                )}
                            </>}
                            extra={<>
                                {canManage && file.status === 'error' && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={(e) => { e.stopPropagation(); onRetryFile(file.id); }}
                                        title={t('retrySource')}
                                        aria-label={`${t('retrySource')} ${file.name}`}
                                    >
                                        <RefreshCw size={16} aria-hidden="true" />
                                    </Button>
                                )}
                            </>}
                            actionsLabel={t('sourceActions')}
                            actions={[
                                { label: t('selectSources'), icon: <ListChecks size={16} aria-hidden="true" />, onSelect: onStartSelection },
                                ...(canDownload ? [
                                    { label: t('download'), icon: <Download size={16} aria-hidden="true" />, onSelect: () => onDownloadFile(file.id) },
                                ] : []),
                                ...(canManage ? [
                                    { label: t('removeSource'), icon: <Trash2 size={16} aria-hidden="true" />, destructive: true, separatorBefore: true,
                                      onSelect: () => onStartRemoval(fileKey(file.id)) },
                                ] : []),
                            ]}
                            // Outside selection mode the chat filter shows as a
                            // greyed-out card: the checkboxes that used to say it
                            // are gone (the count in the prompt bar sums it up).
                            muted={!selecting && file.selected === false}
                            selectable={selecting}
                            selectionMode={selecting}
                            selectionTone={selectionTone}
                            selected={selection?.has(fileKey(file.id)) ?? false}
                            onSelectedChange={(sel) => onToggleSelected(fileKey(file.id), sel)}
                            selectLabel={t('selectSource')}
                        />
                    );
                    // A row in progress or failed shows its status tooltip instead of the preview.
                    const ready = file.status !== 'error' && file.status !== 'pending' && file.status !== 'processing';
                    return canDownload && ready
                        ? <SourceHoverPreview key={file.id} file={file}>{card}</SourceHoverPreview>
                        : card;
                })}

                {rssFeeds.map(feed => {
                    const target: SourceDetailsTarget = { kind: 'rss', source: feed };
                    return (
                        <SidebarCard
                            key={`rss-${feed.id}`}
                            iconText={SOURCE_TYPE_CHIP.rss}
                            title={sourceDetailsTitle(target)}
                            onOpen={() => onViewSource(target)}
                            error={errorOf(feed)}
                            actionsLabel={t('sourceActions')}
                            actions={[
                                { label: t('sourceDetails'), icon: <Info size={16} aria-hidden="true" />, onSelect: () => onViewSource(target) },
                                { label: t('selectSources'), icon: <ListChecks size={16} aria-hidden="true" />, onSelect: onStartSelection },
                                ...(canManage ? manageActions({
                                    status: feed.status,
                                    schedule: feed.syncSchedule,
                                    onSync: () => onPollFeedNow(feed.id),
                                    syncLabel: t('pollNow'),
                                    onToggle: () => onUpdateRssFeed(feed.id, { status: feed.status === 'active' ? 'paused' : 'active' }),
                                    onSchedule: (syncSchedule) => onUpdateRssFeed(feed.id, { syncSchedule }),
                                    // A feed is removed through the remove selection, like a file.
                                    onRemove: () => onStartRemoval(feedKey(feed.id)),
                                }) : []),
                            ]}
                            // Greyed out when none of the feed's files is in the chat filter.
                            muted={!selecting && feedExcluded(feed.id, files)}
                            selectable={selecting}
                            selectionMode={selecting}
                            selectionTone={selectionTone}
                            selected={selection?.has(feedKey(feed.id)) ?? false}
                            onSelectedChange={(sel) => onToggleSelected(feedKey(feed.id), sel)}
                            selectLabel={t('selectSource')}
                        />
                    );
                })}

                {confluenceSources.map(source => {
                    const target: SourceDetailsTarget = { kind: 'confluence', source };
                    return (
                        <SidebarCard
                            key={`confluence-${source.id}`}
                            iconText={SOURCE_TYPE_CHIP.confluence}
                            title={sourceDetailsTitle(target)}
                            onOpen={() => onViewSource(target)}
                            error={errorOf(source)}
                            actionsLabel={t('sourceActions')}
                            actions={[
                                { label: t('sourceDetails'), icon: <Info size={16} aria-hidden="true" />, onSelect: () => onViewSource(target) },
                                { label: t('selectSources'), icon: <ListChecks size={16} aria-hidden="true" />, onSelect: onStartSelection },
                                ...(canManage ? manageActions({
                                    status: source.status,
                                    schedule: source.syncSchedule,
                                    onSync: () => onSyncConfluenceNow(source.id),
                                    syncLabel: t('pollNow'),
                                    onToggle: () => onUpdateConfluenceSource(source.id, { status: source.status === 'active' ? 'paused' : 'active' }),
                                    onSchedule: (syncSchedule) => onUpdateConfluenceSource(source.id, { syncSchedule }),
                                    // Removed through the remove selection, like every source.
                                    onRemove: () => onStartRemoval(confluenceKey(source.id)),
                                }) : []),
                            ]}
                            // Greyed out when none of its files is in the chat filter.
                            muted={!selecting && syncedExcluded('confluence', source.id, files)}
                            {...selectableRow(confluenceKey(source.id))}
                        />
                    );
                })}

                {gitRepoSources.map(source => {
                    const target: SourceDetailsTarget = { kind: 'git', source };
                    return (
                        <SidebarCard
                            key={`gitrepo-${source.id}`}
                            iconText={SOURCE_TYPE_CHIP.git}
                            title={sourceDetailsTitle(target)}
                            onOpen={() => onViewSource(target)}
                            error={errorOf(source)}
                            actionsLabel={t('sourceActions')}
                            actions={[
                                { label: t('sourceDetails'), icon: <Info size={16} aria-hidden="true" />, onSelect: () => onViewSource(target) },
                                { label: t('selectSources'), icon: <ListChecks size={16} aria-hidden="true" />, onSelect: onStartSelection },
                                ...(canManage ? manageActions({
                                    status: source.status,
                                    schedule: source.syncSchedule,
                                    onSync: () => onSyncGitRepoNow(source.id),
                                    syncLabel: t('pollNow'),
                                    // Pausing mid-sync is refused by the backend.
                                    toggleDisabled: source.status === 'syncing',
                                    onToggle: () => onUpdateGitRepoSource(source.id, { status: source.status === 'active' ? 'paused' : 'active' }),
                                    onSchedule: (syncSchedule) => onUpdateGitRepoSource(source.id, { syncSchedule }),
                                    onRemove: () => onStartRemoval(gitKey(source.id)),
                                }) : []),
                            ]}
                            muted={!selecting && syncedExcluded('git', source.id, files)}
                            {...selectableRow(gitKey(source.id))}
                        />
                    );
                })}
            {nonRssFiles.length === 0 && rssFeeds.length === 0 && confluenceSources.length === 0 && gitRepoSources.length === 0 && (
                <li className="sidebar-left__empty sidebar-ui__empty">{t('noSources')}</li>
            )}
        </SidebarCardList>
    );
};

export const SourcesSection = memo(SourcesSectionComp);
