import React, { createElement, memo, useLayoutEffect, useRef } from 'react';
import {
    Download, Trash2,
    Rss, RefreshCw, Pause, Play, Eye, BookOpen, GitBranch
} from 'lucide-react';
import { Button, Checkbox, SidebarCard, SidebarCardList } from '@ki4jlu/design-system';
import type { FileEntry, RssFeed, ConfluenceSource, GitRepoSource } from '../../types';
import { useTheme } from '../../contexts/ThemeContext';
import { IngestStageIndicator } from './IngestStageIndicator';
import { sourceIconFor, sourceTypeLabel } from './sourceIconFor';
import { SourceHoverPreview } from './SourceHoverPreview';
import { useSourcePreviews } from '../../hooks/sourcePreviews';

interface SourcesSectionProps {
    files: FileEntry[];
    onPreviewSource: (file: FileEntry) => void;
    onToggleFilesSelection: (fileIds: string[], selected: boolean) => void;
    onDownloadFile: (id: string) => void;
    onDeleteFile: (id: string, e: React.MouseEvent) => void;
    rssFeeds: RssFeed[];
    onUpdateRssFeed: (feedId: string, updates: { pollInterval?: number; status?: 'active' | 'paused' }) => void;
    onDeleteRssFeed: (feedId: string) => void;
    onPollFeedNow: (feedId: string) => void;
    onViewFeed: (feed: RssFeed) => void;
    confluenceSources: ConfluenceSource[];
    onUpdateConfluenceSource: (sourceId: string, updates: { includeAttachments?: boolean; syncInterval?: number | null; status?: 'active' | 'paused' }) => void;
    onDeleteConfluenceSource: (sourceId: string) => void;
    onSyncConfluenceNow: (sourceId: string) => void;
    gitRepoSources: GitRepoSource[];
    onUpdateGitRepoSource: (sourceId: string, updates: { status?: 'active' | 'paused' }) => void;
    onDeleteGitRepoSource: (sourceId: string) => void;
    onSyncGitRepoNow: (sourceId: string) => void;
    onRetryFile: (id: string) => void;
}

// Maps files.error_stage values (backend vocabulary, see
// files.PGStore.MarkFileError) to translation keys. Unknown stages fall
// back to the raw errorMessage, then to fileErrorUnknown.
const ERROR_STAGE_KEYS: Record<string, string> = {
    unsupported_type: 'fileErrorUnsupportedType',
    parse: 'fileErrorParse',
    embedding: 'fileErrorEmbedding',
    canceled: 'fileErrorCanceled',
    processing: 'fileErrorProcessing',
    timeout: 'fileErrorTimeout',
    queue: 'fileErrorQueue',
};

const SourcesSectionComp: React.FC<SourcesSectionProps> = ({
    files, onPreviewSource, onToggleFilesSelection,
    onDownloadFile, onDeleteFile,
    rssFeeds, onUpdateRssFeed, onDeleteRssFeed, onPollFeedNow, onViewFeed,
    confluenceSources, onUpdateConfluenceSource, onDeleteConfluenceSource, onSyncConfluenceNow,
    gitRepoSources, onUpdateGitRepoSource, onDeleteGitRepoSource, onSyncGitRepoNow,
    onRetryFile
}) => {
    const { t } = useTheme();

    // The list scrolls on its own, and a classic (non-overlay) scrollbar takes
    // its width out of the content box — the cards came out narrower than the
    // "add sources" grid above. The scrollbar is moved into the right gutter
    // instead: the right padding shrinks by exactly its width (0 for overlay
    // scrollbars), measured, since it differs per OS and browser.
    const listRef = useRef<HTMLUListElement>(null);
    useLayoutEffect(() => {
        const el = listRef.current;
        if (!el) return;
        const GUTTER = 16; // = the column's 1rem inset (`.sidebar-left__files-section`)
        const fit = () => {
            const bar = el.offsetWidth - el.clientWidth;
            el.style.paddingRight = `${Math.max(0, GUTTER - bar)}px`;
        };
        fit();
        const ro = new ResizeObserver(fit);
        ro.observe(el);
        for (const child of Array.from(el.children)) ro.observe(child);
        return () => ro.disconnect();
    });

    const nonRssFiles = files.filter(f => f.origin !== 'rss' && f.origin !== 'confluence' && f.origin !== 'git');
    // Hover previews are prepared ahead of the hover (see sourcePreviews.ts).
    useSourcePreviews(nonRssFiles);
    const rssFeedFiles = (feedId: string) => files.filter(f => f.rssFeedId === feedId);

    const errorLabel = (file: FileEntry) => {
        if (file.errorStage && ERROR_STAGE_KEYS[file.errorStage]) return t(ERROR_STAGE_KEYS[file.errorStage]);
        return file.errorMessage || t('fileErrorUnknown');
    };

    return (
        <SidebarCardList ref={listRef} className="sidebar-left__files-section">
                {nonRssFiles.map(file => (
                    <SourceHoverPreview key={file.id} file={file}>
                        <SidebarCard
                            icon={createElement(sourceIconFor(file), { 'aria-hidden': true })}
                            iconText={sourceTypeLabel(file) ?? undefined}
                            title={file.name}
                            onOpen={() => onPreviewSource(file)}
                            meta={<>
                                {/* Status only when it is news: queued or failed. A finished
                                    upload says nothing — the card being there is the status. */}
                                {file.status === 'pending' && !file.currentStage && (
                                    <div className="source-meta sidebar-left__file-meta">{t('fileStatusPending')}</div>
                                )}
                                {file.status === 'error' && (
                                    <div className="sidebar-left__rss-feed-error" title={file.errorMessage || undefined}>
                                        {errorLabel(file)}
                                    </div>
                                )}
                                {file.currentStage && (
                                    <IngestStageIndicator
                                        stage={file.currentStage}
                                        index={file.stageIndex}
                                        total={file.stageTotal}
                                        fileName={file.name}
                                    />
                                )}
                            </>}
                            extra={file.status === 'error' && (
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
                            actionsLabel={t('sourceActions')}
                            actions={[
                                { label: t('download'), icon: <Download size={16} aria-hidden="true" />, onSelect: () => onDownloadFile(file.id) },
                                { label: t('delete'), icon: <Trash2 size={16} aria-hidden="true" />, destructive: true, separatorBefore: true,
                                  onSelect: (e) => onDeleteFile(file.id, e as unknown as React.MouseEvent) },
                            ]}
                            selectable
                            selected={file.selected !== false}
                            onSelectedChange={(sel) => onToggleFilesSelection([file.id], sel)}
                            selectLabel={t('selectSource')}
                        />
                    </SourceHoverPreview>
                ))}

                {rssFeeds.map(feed => (
                    <li key={`rss-${feed.id}`} className="source-card sidebar-left__file-card">
                        <div className="sidebar-left__file-row">
                            <div className="sidebar-left__file-origin-icon">
                                <Rss size={18} aria-hidden="true" />
                            </div>
                            <div className="sidebar-left__file-main sidebar-ui__item-main">
                                <div className="sidebar-left__file-top-row sidebar-ui__item-row">
                                    <span className="text-button source-title sidebar-left__file-name sidebar-ui__item-title">
                                        {feed.title || feed.url}
                                    </span>
                                    <span className={`sidebar-left__rss-feed-status sidebar-left__rss-feed-status--${feed.status}`}>
                                        {feed.status === 'active' ? t('active') : feed.status === 'paused' ? t('paused') : t('feedError')}
                                    </span>
                                </div>
                                <div className="sidebar-left__file-meta-row">
                                    <div className="source-meta sidebar-left__file-meta sidebar-ui__item-meta">
                                        {feed.itemCount > 0 && <span>{feed.itemCount} {t('items')}</span>}
                                        {feed.lastPolledAt && <span>{t('lastPolled')}: {new Date(feed.lastPolledAt).toLocaleString()}</span>}
                                    </div>
                                </div>
                                {feed.status === 'error' && feed.errorMessage && (
                                    <div className="sidebar-left__rss-feed-error">{feed.errorMessage}</div>
                                )}
                                <div className="sidebar-left__rss-feed-actions">
                                    <button onClick={() => onPollFeedNow(feed.id)} title={t('pollNow')} aria-label={t('pollNow')}>
                                        <RefreshCw size={14} />
                                    </button>
                                    <button onClick={() => onUpdateRssFeed(feed.id, {
                                        status: feed.status === 'active' ? 'paused' : 'active'
                                    })} title={feed.status === 'active' ? t('pause') : t('resume')} aria-label={feed.status === 'active' ? t('pause') : t('resume')}>
                                        {feed.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                                    </button>
                                    <button onClick={() => onViewFeed(feed)} title={t('rssViewEntries')} aria-label={t('rssViewEntries')}>
                                        <Eye size={14} />
                                    </button>
                                    <button onClick={() => onDeleteRssFeed(feed.id)} title={t('delete')} aria-label={`${t('delete')} ${feed.title || feed.url}`}>
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                            <Checkbox
                                checked={rssFeedFiles(feed.id).length > 0 && rssFeedFiles(feed.id).every(f => f.selected !== false)}
                                onCheckedChange={() => {
                                    const feedFileList = rssFeedFiles(feed.id);
                                    const allSelected = feedFileList.every(f => f.selected !== false);
                                    onToggleFilesSelection(feedFileList.map(f => f.id), !allSelected);
                                }}
                                aria-label={`${t('selectSource')} ${feed.title || feed.url}`}
                            />
                        </div>
                    </li>
                ))}

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
                                <div className="sidebar-left__rss-feed-actions">
                                    <button onClick={() => onSyncConfluenceNow(source.id)} title={t('pollNow')} aria-label={t('pollNow')}>
                                        <RefreshCw size={14} />
                                    </button>
                                    <button onClick={() => onUpdateConfluenceSource(source.id, {
                                        status: source.status === 'active' ? 'paused' : 'active'
                                    })} title={source.status === 'active' ? t('pause') : t('resume')} aria-label={source.status === 'active' ? t('pause') : t('resume')}>
                                        {source.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                                    </button>
                                    <button onClick={() => onDeleteConfluenceSource(source.id)} title={t('delete')} aria-label={`${t('delete')} ${source.spaceKey}`}>
                                        <Trash2 size={14} />
                                    </button>
                                </div>
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
                                    <div className="sidebar-left__rss-feed-actions">
                                        <button onClick={() => onSyncGitRepoNow(source.id)} title={t('pollNow')} aria-label={t('pollNow')}>
                                            <RefreshCw size={14} />
                                        </button>
                                        <button onClick={() => onUpdateGitRepoSource(source.id, { status: source.status === 'active' ? 'paused' : 'active' })} disabled={source.status === 'syncing'} title={source.status === 'active' ? t('pause') : t('resume')} aria-label={source.status === 'active' ? t('pause') : t('resume')}>
                                            {source.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                                        </button>
                                        <button onClick={() => onDeleteGitRepoSource(source.id)} title={t('delete')} aria-label={`${t('delete')} ${repoName}`}>
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
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
