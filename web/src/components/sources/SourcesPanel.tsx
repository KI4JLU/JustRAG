import React, { memo, useState, useCallback } from 'react';
import type { RssFeed } from '../../types';
import { useKbCore } from '../../contexts/KbCoreContext';
import { useKbData } from '../../contexts/KbDataContext';
import { useTheme } from '../../contexts/ThemeContext';
import { Check, CheckCheck, Trash2 } from 'lucide-react';
import { Button, FileDropzone, SidebarPanel, SidebarSelectionBar, useWindowFileDrag } from '@ki4jlu/design-system';
import { useModalContext } from '../../contexts/ModalContext';
import '../sidebar-primitives.css';
import { RssFeedEntriesModal } from '../RssFeedEntriesModal';
import { SourcesSection } from '../sidebar/SourcesSection';
import { SourcesHeader } from './SourcesHeader';
import { SourcesGrid } from '../sidebar/SourcesGrid';
import type { SourceType } from '../sidebar/SourcesGrid';
import { CrawlModal } from '../sidebar/CrawlModal';
import { RssModal } from '../sidebar/RssModal';
import { FileUploadModal } from '../sidebar/FileUploadModal';
import { TextSourceModal } from '../sidebar/TextSourceModal';
import { ConfluenceModal } from '../sidebar/ConfluenceModal';
import { GitRepoModal } from '../sidebar/GitRepoModal';
import { ACCEPTED_FILE_TYPES } from '../../constants';
import { useKbSourceRights } from '../../hooks/useKbSourceRights';
import { deleteTargets, filterKeepsFiles, filterKeys, filterUpdate, liveSelection, selectableKeys, type SourceKey } from '../sidebar/sourceSelection';
import './SourcesPanel.css';

const SourcesPanelComp: React.FC = () => {
    const { t } = useTheme();
    const { currentKb, setKbView } = useKbCore();
    const { showConfirm } = useModalContext();
    const {
        fileMgmt, webTools,
        rssFeeds, rssLoading, addRssFeed, updateRssFeed, deleteRssFeeds, pollFeedNow,
        confluenceSources, updateConfluenceSource, deleteConfluenceSource, syncConfluenceNow,
        confluenceConnection, confluenceLoading,
        gitRepoSources, gitRepoLoading, addGitRepoSource, updateGitRepoSource, deleteGitRepoSource, syncGitRepoNow,
        saveConfluenceConnection, addConfluenceSource,
        fetchConfluenceSpaces, fetchConfluenceSpacePages, fetchConfluencePageChildren, fetchConfluenceAllSpacePages,
    } = useKbData();

    const {
        files, filesLoaded, fileInputRef,
        handleToggleFilesSelection,
        handleDownloadFile, handleDeleteFile, deleteFiles, handleFileUpload,
        retryFile,
        isDragging, textSourceTitle, setTextSourceTitle,
        textSourceContent, setTextSourceContent,
        handleDragOver, handleDragEnter, handleDragLeave, handleDrop, handleTextSourceAdd, uploadFiles,
        showUploadModal, setShowUploadModal,
    } = fileMgmt;

    const {
        setToolTab, toolInput, setToolInput,
        crawlMaxPages, setCrawlMaxPages,
        toolLoading, handleToolSubmit, crawlResults, searchResults,
        handlePreviewSource,
        webResearchRunning, webResearchStatus, webResearchProgress, handleCancelWebResearch,
        setShowWebWorkspace, sourcesAddedCount,
    } = webTools;

    // What the caller may do with the sources (backend capabilities, see
    // kbSourceRights). A control they cannot use is not rendered at all. The
    // panel itself is mounted only with seeSources (KbWorkspaceLayout).
    //  - addSources: the add grid, the upload dropzone, the window drag. The
    //    backend's add routes take a global KB like any other (only its file
    //    limit differs), so the KB kind is no extra condition.
    //  - manageSources: delete, retry, sync, pause, schedule.
    //  - downloadSources: download, the preview on click and on hover.
    const { addSources: canAdd, manageSources: canManage, downloadSources: canDownload } = useKbSourceRights();
    // Files dragged anywhere over the workspace turn the source list into a
    // dropzone.
    const fileDragActive = useWindowFileDrag(canAdd);
    // A KB with no sources at all keeps the dropzone as its list (the empty
    // workspace placeholder); it opens the file picker on click / Enter too.
    const noSourcesYet = canAdd && filesLoaded && files.length === 0
        && rssFeeds.length === 0 && confluenceSources.length === 0 && gitRepoSources.length === 0;
    const handleOpenWorkspace = useCallback(() => setShowWebWorkspace(true), [setShowWebWorkspace]);

    const [activeSourceModal, setActiveSourceModal] = useState<SourceType | null>(null);
    const [viewingFeed, setViewingFeed] = useState<RssFeed | null>(null);
    const rssFeedFiles = (feedId: string) => files.filter(f => f.rssFeedId === feedId);

    const handleSourceSelect = useCallback((type: SourceType) => {
        if (type === 'upload') {
            setShowUploadModal(true);
            return;
        }
        if (type === 'confluence') {
            setActiveSourceModal('confluence');
            return;
        }
        if (type === 'gitrepo') {
            setActiveSourceModal('gitrepo');
            return;
        }
        if (type === 'crawl') {
            setToolTab(type);
        }
        setActiveSourceModal(type);
    }, [setKbView, setShowUploadModal, setToolTab]);

    const closeSourceModal = useCallback(() => setActiveSourceModal(null), []);

    // Two modes over the list, both off by default, so the cards carry no
    // checkbox (sourceSelection.ts):
    //  - filter ("Auswählen"): opens with the current chat filter ticked;
    //    Confirm writes it, Cancel leaves the filter as it was.
    //  - remove (a card's "Entfernen"): opens with that card ticked, in the
    //    error colour; Remove asks once and deletes the ticked sources.
    const [mode, setMode] = useState<{ kind: 'filter' | 'remove'; keys: Set<SourceKey> } | null>(null);
    // Another KB's list is a different set of rows: leave the mode.
    const [modeKbId, setModeKbId] = useState(currentKb.id);
    if (currentKb.id !== modeKbId) {
        setModeKbId(currentKb.id);
        setMode(null);
    }
    const startSelection = useCallback(
        () => setMode({ kind: 'filter', keys: new Set(filterKeys(files, rssFeeds)) }),
        [files, rssFeeds],
    );
    const startRemoval = useCallback((key: SourceKey) => setMode({ kind: 'remove', keys: new Set([key]) }), []);
    const toggleSelected = useCallback((key: SourceKey, on: boolean) => {
        setMode(prev => {
            if (!prev) return prev;
            const keys = new Set(prev.keys);
            if (on) keys.add(key); else keys.delete(key);
            return { ...prev, keys };
        });
    }, []);
    const cancelMode = useCallback(() => setMode(null), []);
    const ticked = mode ? liveSelection(mode.keys, files, rssFeeds) : [];
    const allKeys = selectableKeys(files, rssFeeds);
    const allTicked = ticked.length > 0 && ticked.length === allKeys.length;
    const toggleAll = () => setMode(prev => prev && { ...prev, keys: allTicked ? new Set() : new Set(allKeys) });
    const confirmSelection = useCallback(() => {
        if (mode?.kind !== 'filter') return;
        const { select, deselect } = filterUpdate(mode.keys, files, rssFeeds);
        handleToggleFilesSelection(select, true);
        handleToggleFilesSelection(deselect, false);
        setMode(null);
    }, [mode, files, rssFeeds, handleToggleFilesSelection]);
    const removeSelected = useCallback(async () => {
        if (mode?.kind !== 'remove') return;
        const { fileIds, feedIds } = deleteTargets(mode.keys, files, rssFeeds);
        const count = fileIds.length + feedIds.length;
        if (count === 0) return;
        const message = t('confirmRemoveSources').replace('{count}', String(count))
            + (feedIds.length > 0 ? ` ${t('deleteRssFeedConfirm')}` : '');
        if (!await showConfirm(message, t('removeSelected'), { tone: 'destructive', confirmLabel: t('removeSource') })) return;
        setMode(null);
        // In turn, not in parallel: removing a feed re-reads the file list,
        // and a read that lands before a file's DELETE would bring it back.
        await deleteFiles(fileIds);
        await deleteRssFeeds(feedIds);
    }, [mode, files, rssFeeds, showConfirm, t, deleteFiles, deleteRssFeeds]);

    // Close modal when sources are successfully added.
    // Adjust-state-during-render pattern (react.dev "You Might Not Need an Effect"):
    // compare against the previous value instead of reacting in an effect.
    const [prevSourcesAddedCount, setPrevSourcesAddedCount] = useState(sourcesAddedCount);
    if (sourcesAddedCount !== prevSourcesAddedCount) {
        setPrevSourcesAddedCount(sourcesAddedCount);
        if (sourcesAddedCount > 0) setActiveSourceModal(null);
    }

    return (
        <>
            {/* The same frame as the history column (DS SidebarPanel): fixed
                head — heading, web search, source types, retry-all — and only
                the source list below it scrolls. */}
            <SidebarPanel
                title={canAdd ? t('addSources') : t('sources')}
                head={(
                    <>
                        {canAdd && (
                            <SourcesGrid
                                onSelect={handleSourceSelect}
                                webSearch={{
                                    toolInput,
                                    setToolInput,
                                    toolLoading,
                                    onSubmit: handleToolSubmit,
                                    setToolTab,
                                    webResearchRunning,
                                    webResearchStatus,
                                    webResearchProgress,
                                    onCancelWebResearch: handleCancelWebResearch,
                                    hasResults: searchResults.length > 0 || crawlResults.length > 0,
                                    onOpenWorkspace: handleOpenWorkspace,
                                }}
                            />
                        )}
                        <SourcesHeader />
                        {mode?.kind === 'filter' && (
                            <SidebarSelectionBar
                                aria-label={t('selectSources')}
                                countLabel={t('selectedCount').replace('{count}', String(ticked.length))}
                                onCancel={cancelMode}
                                cancelLabel={t('cancel')}
                            >
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={toggleAll}
                                    aria-label={allTicked ? t('deselectAll') : t('selectAll')}
                                    title={allTicked ? t('deselectAll') : t('selectAll')}
                                    aria-pressed={allTicked}
                                >
                                    <CheckCheck size={16} aria-hidden="true" />
                                </Button>
                                {/* A turn needs at least one file
                                    (chatSourceSelection), so a filter that
                                    leaves none is not one to confirm. */}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={confirmSelection}
                                    disabled={!filterKeepsFiles(mode.keys, files, rssFeeds)}
                                    aria-label={t('confirmSourceSelection')}
                                    title={t('confirmSourceSelection')}
                                >
                                    <Check size={16} aria-hidden="true" />
                                </Button>
                            </SidebarSelectionBar>
                        )}
                        {mode?.kind === 'remove' && (
                            <SidebarSelectionBar
                                aria-label={t('removeSources')}
                                countLabel={t('selectedCount').replace('{count}', String(ticked.length))}
                                onCancel={cancelMode}
                                cancelLabel={t('cancel')}
                            >
                                <Button
                                    variant="ghost-destructive"
                                    size="icon"
                                    onClick={removeSelected}
                                    disabled={ticked.length === 0}
                                    aria-label={t('removeSelected')}
                                    title={t('removeSelected')}
                                >
                                    <Trash2 size={16} aria-hidden="true" />
                                </Button>
                            </SidebarSelectionBar>
                        )}
                    </>
                )}
            >
                {fileDragActive || noSourcesYet ? (
                    <FileDropzone
                        id="sources-dropzone"
                        className="h-full min-h-48"
                        title={fileDragActive ? t('dropFilesHere') : t('dropzoneTitle')}
                        hint={t('dropzoneTypes')}
                        onFiles={uploadFiles}
                        onBrowse={() => fileInputRef.current?.click()}
                        aria-label={t('uploadFile')}
                    />
                ) : (
                <SourcesSection
                    files={files}
                    onPreviewSource={handlePreviewSource}
                    selection={mode?.keys ?? null}
                    selectionTone={mode?.kind === 'remove' ? 'destructive' : 'default'}
                    onStartSelection={startSelection}
                    onStartRemoval={startRemoval}
                    onToggleSelected={toggleSelected}
                    onDownloadFile={handleDownloadFile}
                    canManage={canManage}
                    canDownload={canDownload}
                    rssFeeds={rssFeeds}
                    onUpdateRssFeed={updateRssFeed}
                    onPollFeedNow={pollFeedNow}
                    onViewFeed={setViewingFeed}
                    confluenceSources={confluenceSources}
                    onUpdateConfluenceSource={updateConfluenceSource}
                    onDeleteConfluenceSource={deleteConfluenceSource}
                    onSyncConfluenceNow={syncConfluenceNow}
                    onRetryFile={retryFile}
                    gitRepoSources={gitRepoSources}
                    onUpdateGitRepoSource={updateGitRepoSource}
                    onDeleteGitRepoSource={deleteGitRepoSource}
                    onSyncGitRepoNow={syncGitRepoNow}
                />
                )}
            </SidebarPanel>

            <input
                type="file"
                ref={fileInputRef}
                className="sidebar-left__hidden-file-input"
                onChange={handleFileUpload}
                accept={ACCEPTED_FILE_TYPES}
                multiple
            />

            {viewingFeed && (
                <RssFeedEntriesModal
                    feed={viewingFeed}
                    files={rssFeedFiles(viewingFeed.id)}
                    onDeleteFile={canManage ? handleDeleteFile : undefined}
                    onClose={() => setViewingFeed(null)}
                />
            )}

            <CrawlModal
                show={activeSourceModal === 'crawl'}
                onClose={closeSourceModal}
                toolLoading={toolLoading}
                onToolSubmit={(url: string) => handleToolSubmit('crawl', url)}
                crawlMaxPages={crawlMaxPages}
                setCrawlMaxPages={setCrawlMaxPages}
                crawlResults={crawlResults}
                onOpenWorkspace={handleOpenWorkspace}
            />
            <RssModal
                show={activeSourceModal === 'rss'}
                onClose={closeSourceModal}
                rssLoading={rssLoading}
                onAddRssFeed={addRssFeed}
            />
            <ConfluenceModal
                show={activeSourceModal === 'confluence'}
                onClose={closeSourceModal}
                confluenceConnection={confluenceConnection}
                confluenceLoading={confluenceLoading}
                onSaveConnection={saveConfluenceConnection}
                onAddSource={(data) => {
                    if (confluenceConnection?.connection?.id) {
                        addConfluenceSource({ ...data, connectionId: confluenceConnection.connection.id });
                    }
                }}
                fetchSpaces={fetchConfluenceSpaces}
                fetchSpacePages={fetchConfluenceSpacePages}
                fetchPageChildren={fetchConfluencePageChildren}
                fetchAllSpacePages={fetchConfluenceAllSpacePages}
            />
            <GitRepoModal
                show={activeSourceModal === 'gitrepo'}
                onClose={closeSourceModal}
                loading={gitRepoLoading}
                onAdd={addGitRepoSource}
            />
            <FileUploadModal
                show={showUploadModal}
                onClose={() => setShowUploadModal(false)}
                fileInputRef={fileInputRef}
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                isDragging={isDragging}
            />
            <TextSourceModal
                show={activeSourceModal === 'text'}
                onClose={closeSourceModal}
                onTextSourceAdd={() => { closeSourceModal(); void handleTextSourceAdd(); }}
                textSourceTitle={textSourceTitle}
                setTextSourceTitle={setTextSourceTitle}
                textSourceContent={textSourceContent}
                setTextSourceContent={setTextSourceContent}
            />
        </>
    );
};

export const SourcesPanel = memo(SourcesPanelComp);
