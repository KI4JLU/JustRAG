import React, { memo, useState, useCallback } from 'react';
import type { RssFeed } from '../../types';
import { useKbCore } from '../../contexts/KbCoreContext';
import { useKbData } from '../../contexts/KbDataContext';
import { useTheme } from '../../contexts/ThemeContext';
import { SidebarPanel } from '@ki4jlu/design-system';
import '../sidebar-primitives.css';
import { RssFeedEntriesModal } from '../RssFeedEntriesModal';
import { SourcesSection } from '../sidebar/SourcesSection';
import { SourcesHeader } from './SourcesHeader';
import { SourcesGrid } from '../sidebar/SourcesGrid';
import type { SourceType } from '../sidebar/SourcesGrid';
import { CrawlModal } from '../sidebar/CrawlModal';
import { RssModal } from '../sidebar/RssModal';
import { FileUploadModal } from '../sidebar/FileUploadModal';
import { ConfluenceModal } from '../sidebar/ConfluenceModal';
import { GitRepoModal } from '../sidebar/GitRepoModal';
import { ACCEPTED_FILE_TYPES } from '../../constants';
import './SourcesPanel.css';

const SourcesPanelComp: React.FC = () => {
    const { t } = useTheme();
    const { currentKb, setKbView } = useKbCore();
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
        files, fileInputRef,
        handleToggleFilesSelection,
        handleDownloadFile, handleDeleteFile, handleFileUpload,
        retryFile,
        isDragging, textSourceTitle, setTextSourceTitle,
        textSourceContent, setTextSourceContent,
        handleDragOver, handleDragEnter, handleDragLeave, handleDrop, handleTextSourceAdd,
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

    const isGlobal = currentKb?.isGlobal;
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
                title={isGlobal ? t('sources') : t('addSources')}
                head={(
                    <>
                        {!isGlobal && (
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
                <SourcesSection
                    files={files}
                    onPreviewSource={handlePreviewSource}
                    onToggleFilesSelection={handleToggleFilesSelection}
                    onDownloadFile={handleDownloadFile}
                    onDeleteFile={handleDeleteFile}
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
                    onDeleteFile={handleDeleteFile}
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
                onTextSourceAdd={handleTextSourceAdd}
                textSourceTitle={textSourceTitle}
                setTextSourceTitle={setTextSourceTitle}
                textSourceContent={textSourceContent}
                setTextSourceContent={setTextSourceContent}
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                isDragging={isDragging}
            />
        </>
    );
};

export const SourcesPanel = memo(SourcesPanelComp);
