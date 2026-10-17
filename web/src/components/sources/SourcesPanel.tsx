import React, { memo, useState, useCallback } from 'react';
import type { RssFeed } from '../../types';
import { useKbCore } from '../../contexts/KbCoreContext';
import { useKbData } from '../../contexts/KbDataContext';
import { useTheme } from '../../contexts/ThemeContext';
import { FileDropzone, SidebarPanel, useWindowFileDrag } from '@ki4jlu/design-system';
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
import './SourcesPanel.css';

const SourcesPanelComp: React.FC = () => {
    const { t } = useTheme();
    const { setKbView } = useKbCore();
    const {
        fileMgmt, webTools,
        rssFeeds, rssLoading, addRssFeed, updateRssFeed, deleteRssFeed, pollFeedNow,
        confluenceSources, updateConfluenceSource, deleteConfluenceSource, syncConfluenceNow,
        confluenceConnection, confluenceLoading,
        gitRepoSources, gitRepoLoading, addGitRepoSource, updateGitRepoSource, deleteGitRepoSource, syncGitRepoNow,
        saveConfluenceConnection, addConfluenceSource,
        fetchConfluenceSpaces, fetchConfluenceSpacePages, fetchConfluencePageChildren, fetchConfluenceAllSpacePages,
    } = useKbData();

    const {
        files, filesLoaded, fileInputRef,
        handleToggleFilesSelection,
        handleDownloadFile, handleDeleteFile, handleFileUpload,
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
                    onToggleFilesSelection={handleToggleFilesSelection}
                    onDownloadFile={handleDownloadFile}
                    onDeleteFile={handleDeleteFile}
                    canManage={canManage}
                    canDownload={canDownload}
                    rssFeeds={rssFeeds}
                    onUpdateRssFeed={updateRssFeed}
                    onDeleteRssFeed={deleteRssFeed}
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
