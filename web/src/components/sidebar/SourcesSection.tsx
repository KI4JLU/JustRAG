import React, { createElement, memo } from 'react';
import {
    Download, Trash2, ListChecks,
    Rss, RefreshCw, Pause, Play, Eye, BookOpen, GitBranch, ShieldAlert
} from 'lucide-react';
import { Button, Checkbox, SidebarCard, SidebarCardList } from '@ki4jlu/design-system';
import type { FileEntry, RssFeed, ConfluenceSource, GitRepoSource, SyncSchedule } from '../../types';
import { useTheme } from '../../contexts/ThemeContext';
import { IngestStageIndicator } from './IngestStageIndicator';
import { SyncScheduleSelect } from './SyncScheduleSelect';
import { sourceIconFor, sourceTypeLabel } from './sourceIconFor';
import { SourceHoverPreview } from './SourceHoverPreview';
import { useSourcePreviews } from '../../hooks/sourcePreviews';
import { cardFiles, feedExcluded, feedKey, fileKey, type SourceKey } from './sourceSelection';

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
    onViewFeed: (feed: RssFeed) => void;
    confluenceSources: ConfluenceSource[];
    onUpdateConfluenceSource: (sourceId: string, updates: { includeAttachments?: boolean; syncSchedule?: SyncSchedule; status?: 'active' | 'paused' }) => void;
    onDeleteConfluenceSource: (sourceId: string) => void;
    onSyncConfluenceNow: (sourceId: string) => void;
    gitRepoSources: GitRepoSource[];
    onUpdateGitRepoSource: (sourceId: string, updates: { syncSchedule?: SyncSchedule; status?: 'active' | 'paused' }) => void;
    onDeleteGitRepoSource: (sourceId: string) => void;
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
    rssFeeds, onUpdateRssFeed, onPollFeedNow, onViewFeed,
    confluenceSources, onUpdateConfluenceSource, onDeleteConfluenceSource, onSyncConfluenceNow,
    gitRepoSources, onUpdateGitRepoSource, onDeleteGitRepoSource, onSyncGitRepoNow,
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

    return (
        <SidebarCardList className="sidebar-left__files-section">
                {nonRssFiles.map(file => {
                    const card = (
                        <SidebarCard
                            key={file.id}
                            icon={createElement(sourceIconFor(file), { 'aria-hidden': true })}
                            iconText={sourceTypeLabel(file) ?? undefined}
                            title={file.name}
                            onOpen={canDownload ? () => onPreviewSource(file) : undefined}
                            meta={<>
                                {/* Status only when it is news: queued or failed. A finished
                                    upload says nothing — the card being there is the status. */}
                                {file.status === 'pending' && !file.currentStage && (
                                    <div className="source-meta sidebar-left__file-meta">{t('fileStatusPending')}</div>
                                )}
                                {file.status === 'error' && (
                                    <div className="sidebar-left__rss-feed-error">
                                        {errorLabel(file)}
                                    </div>
                                )}
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
                                {file.currentStage && (
                                    <IngestStageIndicator
                                        stage={file.currentStage}
                                        index={file.stageIndex}
                                        total={file.stageTotal}
                                        fileName={file.name}
                                        detail={file.stageDetail}
                                    />
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
                    return canDownload
                        ? <SourceHoverPreview key={file.id} file={file}>{card}</SourceHoverPreview>
                        : card;
                })}

                {rssFeeds.map(feed => {
                    // Greyed out like a muted SidebarCard (opacity-50 on icon,
                    // title and meta; controls at full strength) when none of
                    // the feed's files is in the chat filter.
                    const feedMuted = !selecting && feedExcluded(feed.id, files);
                    return (
                    <li key={`rss-${feed.id}`} className="source-card sidebar-left__file-card" data-muted={feedMuted ? '' : undefined}>
                        <div className="sidebar-left__file-row">
                            <div className={`sidebar-left__file-origin-icon${feedMuted ? ' opacity-50' : ''}`}>
                                <Rss size={18} aria-hidden="true" />
                            </div>
                            <div className="sidebar-left__file-main sidebar-ui__item-main">
                                <div className={`sidebar-left__file-top-row sidebar-ui__item-row${feedMuted ? ' opacity-50' : ''}`}>
                                    <span className="text-button source-title sidebar-left__file-name sidebar-ui__item-title">
                                        {feed.title || feed.url}
                                    </span>
                                    <span className={`sidebar-left__rss-feed-status sidebar-left__rss-feed-status--${feed.status}`}>
                                        {feed.status === 'active' ? t('active') : feed.status === 'paused' ? t('paused') : t('feedError')}
                                    </span>
                                </div>
                                <div className={`sidebar-left__file-meta-row${feedMuted ? ' opacity-50' : ''}`}>
                                    <div className="source-meta sidebar-left__file-meta sidebar-ui__item-meta">
                                        {feed.itemCount > 0 && <span>{feed.itemCount} {t('items')}</span>}
                                        {feed.lastPolledAt && <span>{t('lastPolled')}: {new Date(feed.lastPolledAt).toLocaleString()}</span>}
                                        {feed.syncSchedule !== 'manual' && feed.nextSyncAt && (
                                            <span>{t('nextSync')}: {new Date(feed.nextSyncAt).toLocaleString()}</span>
                                        )}
                                    </div>
                                </div>
                                {feed.status === 'error' && feed.errorMessage && (
                                    <div className="sidebar-left__rss-feed-error">{feed.errorMessage}</div>
                                )}
                                {canManage && !selecting && (
                                    <SyncScheduleSelect
                                        id={`rss-row-schedule-${feed.id}`}
                                        value={feed.syncSchedule}
                                        onChange={(syncSchedule) => onUpdateRssFeed(feed.id, { syncSchedule })}
                                    />
                                )}
                                {!selecting && (
                                <div className="sidebar-left__rss-feed-actions">
                                    {/* eslint-disable-next-line design-system/no-raw-ui-elements -- same raw icon button as its siblings in this row; they move to the DS together with the feed row */}
                                    <button onClick={onStartSelection} title={t('selectSources')} aria-label={`${t('selectSources')} ${feed.title || feed.url}`}>
                                        <ListChecks size={14} />
                                    </button>
                                    {canManage && (<>
                                        <button onClick={() => onPollFeedNow(feed.id)} title={t('pollNow')} aria-label={t('pollNow')}>
                                            <RefreshCw size={14} />
                                        </button>
                                        <button onClick={() => onUpdateRssFeed(feed.id, {
                                            status: feed.status === 'active' ? 'paused' : 'active'
                                        })} title={feed.status === 'active' ? t('pause') : t('resume')} aria-label={feed.status === 'active' ? t('pause') : t('resume')}>
                                            {feed.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                                        </button>
                                    </>)}
                                    <button onClick={() => onViewFeed(feed)} title={t('rssViewEntries')} aria-label={t('rssViewEntries')}>
                                        <Eye size={14} />
                                    </button>
                                    {canManage && (
                                        <button onClick={() => onStartRemoval(feedKey(feed.id))} title={t('removeSource')} aria-label={`${t('removeSource')} ${feed.title || feed.url}`}>
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                                )}
                            </div>
                            {selecting && (
                                <Checkbox
                                    tone={selectionTone}
                                    checked={selection.has(feedKey(feed.id))}
                                    onCheckedChange={(on) => onToggleSelected(feedKey(feed.id), on === true)}
                                    aria-label={`${t('selectSource')} ${feed.title || feed.url}`}
                                />
                            )}
                        </div>
                    </li>
                    );
                })}

                {confluenceSources.map(source => (
                    <li key={`confluence-${source.id}`} className="source-card sidebar-left__file-card">
                        <div className="sidebar-left__file-row">
                            <div className="sidebar-left__file-origin-icon">
                                <BookOpen size={18} aria-hidden="true" />
                            </div>
                            <div className="sidebar-left__file-main sidebar-ui__item-main">
                                <div className="sidebar-left__file-top-row sidebar-ui__item-row">
                                    <span className="text-button source-title sidebar-left__file-name sidebar-ui__item-title">
                                        {source.spaceKey}{source.rootPageTitle ? ` / ${source.rootPageTitle}` : ''}
                                    </span>
                                    <span className={`sidebar-left__rss-feed-status sidebar-left__rss-feed-status--${source.status}`}>
                                        {source.status === 'active' ? t('active') : source.status === 'syncing' ? t('syncing') : source.status === 'paused' ? t('paused') : t('feedError')}
                                    </span>
                                </div>
                                <div className="sidebar-left__file-meta-row">
                                    <div className="source-meta sidebar-left__file-meta sidebar-ui__item-meta">
                                        {source.pageCount > 0 && <span>{source.pageCount} {t('pages')}</span>}
                                        {source.lastSyncedAt && <span>{t('lastSynced')}: {new Date(source.lastSyncedAt).toLocaleString()}</span>}
                                        {source.syncSchedule !== 'manual' && source.nextSyncAt && (
                                            <span>{t('nextSync')}: {new Date(source.nextSyncAt).toLocaleString()}</span>
                                        )}
                                    </div>
                                </div>
                                {source.status === 'syncing' && source.syncTotal > 0 && (
                                    <div style={{ marginTop: 4 }}>
                                        <div style={{
                                            height: 6, borderRadius: 3, background: 'var(--bg-tertiary)', overflow: 'hidden',
                                        }}>
                                            <div style={{
                                                height: '100%', borderRadius: 3, background: 'var(--accent-primary)',
                                                width: `${Math.round((source.syncProgress / source.syncTotal) * 100)}%`,
                                                transition: 'width 0.3s ease',
                                            }} />
                                        </div>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                            {source.syncProgress}/{source.syncTotal} {t('filesProcessed')}
                                        </span>
                                    </div>
                                )}
                                {source.status === 'error' && source.errorMessage && (
                                    <div className="sidebar-left__rss-feed-error">{source.errorMessage}</div>
                                )}
                                {canManage && (
                                <SyncScheduleSelect
                                    id={`confluence-row-schedule-${source.id}`}
                                    value={source.syncSchedule}
                                    onChange={(syncSchedule) => onUpdateConfluenceSource(source.id, { syncSchedule })}
                                />
                                )}
                                {canManage && (
                                <div className="sidebar-left__rss-feed-actions">
                                    <button onClick={() => onSyncConfluenceNow(source.id)} title={t('pollNow')} aria-label={t('pollNow')}>
                                        <RefreshCw size={14} />
                                    </button>
                                    <button onClick={() => onUpdateConfluenceSource(source.id, {
                                        status: source.status === 'active' ? 'paused' : 'active'
                                    })} title={source.status === 'active' ? t('pause') : t('resume')} aria-label={source.status === 'active' ? t('pause') : t('resume')}>
                                        {source.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                                    </button>
                                    <button onClick={() => onDeleteConfluenceSource(source.id)} title={t('removeSource')} aria-label={`${t('removeSource')} ${source.spaceKey}`}>
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                                )}
                            </div>
                        </div>
                    </li>
                ))}

                {gitRepoSources.map(source => {
                    const repoName = source.repoUrl.replace(/\.git$/, '').split('/').slice(-2).join('/');
                    return (
                        <li key={`gitrepo-${source.id}`} className="source-card sidebar-left__file-card">
                            <div className="sidebar-left__file-row">
                                <div className="sidebar-left__file-origin-icon">
                                    <GitBranch size={18} aria-hidden="true" />
                                </div>
                                <div className="sidebar-left__file-main sidebar-ui__item-main">
                                    <div className="sidebar-left__file-top-row sidebar-ui__item-row">
                                        <span className="text-button source-title sidebar-left__file-name sidebar-ui__item-title">
                                            {repoName}{source.branch ? ` @ ${source.branch}` : ''}
                                        </span>
                                        <span className={`sidebar-left__rss-feed-status sidebar-left__rss-feed-status--${source.status}`}>
                                            {source.status === 'active' ? t('active') : source.status === 'syncing' ? t('syncing') : source.status === 'paused' ? t('paused') : t('feedError')}
                                        </span>
                                    </div>
                                    <div className="sidebar-left__file-meta-row">
                                        <div className="source-meta sidebar-left__file-meta sidebar-ui__item-meta">
                                            {source.fileCount > 0 && <span>{source.fileCount} {t('gitFiles')}</span>}
                                            {source.lastSyncedAt && <span>{t('lastSynced')}: {new Date(source.lastSyncedAt).toLocaleString()}</span>}
                                            {source.syncSchedule !== 'manual' && source.nextSyncAt && (
                                                <span>{t('nextSync')}: {new Date(source.nextSyncAt).toLocaleString()}</span>
                                            )}
                                        </div>
                                    </div>
                                    {source.status === 'syncing' && source.syncTotal > 0 && (
                                        <div style={{ marginTop: 4 }}>
                                            <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                                                <div style={{ height: '100%', borderRadius: 3, background: 'var(--accent-primary)', width: `${Math.round((source.syncProgress / source.syncTotal) * 100)}%`, transition: 'width 0.3s ease' }} />
                                            </div>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                {source.syncProgress}/{source.syncTotal} {t('filesProcessed')}
                                            </span>
                                        </div>
                                    )}
                                    {source.status === 'error' && source.errorMessage && (
                                        <div className="sidebar-left__rss-feed-error">{source.errorMessage}</div>
                                    )}
                                    {canManage && (
                                    <SyncScheduleSelect
                                        id={`gitrepo-row-schedule-${source.id}`}
                                        value={source.syncSchedule}
                                        onChange={(syncSchedule) => onUpdateGitRepoSource(source.id, { syncSchedule })}
                                    />
                                    )}
                                    {canManage && (
                                    <div className="sidebar-left__rss-feed-actions">
                                        <button onClick={() => onSyncGitRepoNow(source.id)} title={t('pollNow')} aria-label={t('pollNow')}>
                                            <RefreshCw size={14} />
                                        </button>
                                        <button onClick={() => onUpdateGitRepoSource(source.id, { status: source.status === 'active' ? 'paused' : 'active' })} disabled={source.status === 'syncing'} title={source.status === 'active' ? t('pause') : t('resume')} aria-label={source.status === 'active' ? t('pause') : t('resume')}>
                                            {source.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                                        </button>
                                        <button onClick={() => onDeleteGitRepoSource(source.id)} title={t('removeSource')} aria-label={`${t('removeSource')} ${repoName}`}>
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                    )}
                                </div>
                            </div>
                        </li>
                    );
                })}
            {nonRssFiles.length === 0 && rssFeeds.length === 0 && confluenceSources.length === 0 && gitRepoSources.length === 0 && (
                <li className="sidebar-left__empty sidebar-ui__empty">{t('noSources')}</li>
            )}
        </SidebarCardList>
    );
};

export const SourcesSection = memo(SourcesSectionComp);
