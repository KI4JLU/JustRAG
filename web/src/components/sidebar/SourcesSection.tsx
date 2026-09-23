import React, { memo } from 'react';
import {
    Link, Globe, Bot, FileText, Download, Trash2, MoreVertical,
    Rss, RefreshCw, Pause, Play, Eye, BookOpen, GitBranch
} from 'lucide-react';
import {
    Button, Checkbox,
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@ki4jlu/design-system';
import type { FileEntry, RssFeed, ConfluenceSource, GitRepoSource } from '../../types';
import { useTheme } from '../../contexts/ThemeContext';
import { IngestStageIndicator } from './IngestStageIndicator';
import { isCardControlClick } from './cardClick';
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

    const nonRssFiles = files.filter(f => f.origin !== 'rss' && f.origin !== 'confluence' && f.origin !== 'git');
    // Hover previews are prepared ahead of the hover (see sourcePreviews.ts).
    useSourcePreviews(nonRssFiles);
    const rssFeedFiles = (feedId: string) => files.filter(f => f.rssFeedId === feedId);

    const errorLabel = (file: FileEntry) => {
        if (file.errorStage && ERROR_STAGE_KEYS[file.errorStage]) return t(ERROR_STAGE_KEYS[file.errorStage]);
        return file.errorMessage || t('fileErrorUnknown');
    };

    return (
        <ul className="sidebar-left__files-section sidebar-ui__list">
                {nonRssFiles.map(file => (
                    <SourceHoverPreview key={file.id} file={file}>
                        {/* Whole-plane click is a pointer convenience; the title button inside is the keyboard path. */}
                        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
                    <li
                        className="source-card sidebar-left__file-card"
                        onClick={(e) => { if (!isCardControlClick(e)) onPreviewSource(file); }}
                    >
                        <div className="sidebar-left__file-origin-icon">
                            {file.origin === 'websearch' ? <Link size={18} aria-hidden="true" /> : file.origin === 'crawl' ? <Globe size={18} aria-hidden="true" /> : file.origin === 'research' ? <Bot size={18} aria-hidden="true" /> : file.origin === 'rss' ? <Rss size={18} aria-hidden="true" /> : <FileText size={18} aria-hidden="true" />}
                        </div>
                        <div className="sidebar-left__file-main">
                            <button
                                onClick={() => onPreviewSource(file)}
                                className="text-button source-title sidebar-left__file-name"
                            >
                                {file.name}
                            </button>
                            {/* Status only when it is news: queued or failed. A finished
                                upload says nothing — the card being there is the status. */}
                            {file.status === 'pending' && !file.currentStage && (
                                <div className="source-meta sidebar-left__file-meta">{t('fileStatusPending')}</div>
                            )}
                            {file.status === 'error' && (
                                <div
                                    className="sidebar-left__rss-feed-error"
                                    title={file.errorMessage || undefined}
                                >
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
                        </div>
                        {file.status === 'error' && (
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
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" aria-label={`${t('sourceActions')} ${file.name}`}>
                                    <MoreVertical size={16} aria-hidden="true" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => onDownloadFile(file.id)}>
                                    <Download size={16} aria-hidden="true" />
                                    {t('download')}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={(e) => onDeleteFile(file.id, e as unknown as React.MouseEvent)}
                                >
                                    <Trash2 size={16} aria-hidden="true" />
                                    {t('delete')}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Checkbox
                            checked={file.selected !== false}
                            onCheckedChange={(checked) => onToggleFilesSelection([file.id], checked === true)}
                            aria-label={`${t('selectSource')} ${file.name}`}
                        />
                    </li>
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
        </ul>
    );
};

export const SourcesSection = memo(SourcesSectionComp);
