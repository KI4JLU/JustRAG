import { createElement } from 'react';
import { Plus } from 'lucide-react';
import { SidebarRail, SidebarRailItem } from '@ki4jlu/design-system';
import type { FileEntry } from '../../types';
import { useTheme } from '../../contexts/ThemeContext';
import { useKbData } from '../../contexts/KbDataContext';
import { useSourcePreviews } from '../../hooks/sourcePreviews';
import { SourceHoverPreview } from './SourceHoverPreview';
import { sourceIconFor, sourceTypeLabel } from './sourceIconFor';
import { SOURCE_TYPE_CHIP, sourceDetailsTitle, type SourceDetailsTarget } from '../sources/sourceDetails';
import { openSourceDetails } from '../../hooks/sourceDetails';
import { feedExcluded, syncedExcluded } from './sourceSelection';
import { useKbSourceRights } from '../../hooks/useKbSourceRights';

/** Same filter as the expanded list (SourcesSection): files, not feed/sync items. */
const listedFiles = (files: FileEntry[]) =>
    files.filter(f => f.origin !== 'rss' && f.origin !== 'confluence' && f.origin !== 'git');
const NO_FILES: FileEntry[] = [];

/**
 * The collapsed 60px right rail: one icon per source, the counterpart of the
 * history rail on the left. "Add source" leads, like "new chat" there (only
 * for a caller who may add sources — capabilities.addSources). With
 * downloadSources each icon opens the source's preview on click and shows the
 * hover preview card (DS `FilePreview`, with the file name, since the rail has
 * no text) — pre-rendered by the same cache the expanded list uses. Without
 * it an icon is a display-only tile (no button, no preview).
 */
export function SourcesRail() {
    const { t } = useTheme();
    const { fileMgmt, webTools, rssFeeds, confluenceSources, gitRepoSources } = useKbData();
    // The synced sources follow the files, as in the expanded list: a type
    // chip each, opening the same details dialog.
    const synced: SourceDetailsTarget[] = [
        ...rssFeeds.map(source => ({ kind: 'rss' as const, source })),
        ...confluenceSources.map(source => ({ kind: 'confluence' as const, source })),
        ...gitRepoSources.map(source => ({ kind: 'git' as const, source })),
    ];
    // Mounted only with seeSources (KbWorkspaceLayout). The "+" needs
    // addSources; opening and the hover preview need downloadSources (the
    // preview is the downloaded file) — without it an icon is display-only.
    const { addSources: canAdd, downloadSources: canDownload } = useKbSourceRights();
    const files = listedFiles(fileMgmt.files);
    useSourcePreviews(canDownload ? files : NO_FILES);

    return (
        <>
            {canAdd && (
                <SidebarRailItem
                    variant="action"
                    onClick={() => fileMgmt.setShowUploadModal(true)}
                    title={t('addSources')}
                    aria-label={t('addSources')}
                >
                    <Plus aria-hidden="true" />
                </SidebarRailItem>
            )}
            <SidebarRail aria-label={t('sources')}>
                {files.map(file => {
                    const excluded = file.selected === false;
                    const icon = createElement(sourceIconFor(file), { 'aria-hidden': true });
                    const iconText = sourceTypeLabel(file) ?? undefined;
                    return (
                        <li key={file.id}>
                            {canDownload ? (
                                <SourceHoverPreview file={file} showName>
                                    <SidebarRailItem
                                        onClick={() => webTools.handlePreviewSource(file)}
                                        muted={excluded}
                                        iconText={iconText}
                                        aria-label={file.name}
                                    >
                                        {icon}
                                    </SidebarRailItem>
                                </SourceHoverPreview>
                            ) : (
                                // No preview to open: a display-only tile (a span
                                // named as an image, not focusable). Selecting
                                // stays with the expanded list's checkbox.
                                <SidebarRailItem
                                    interactive={false}
                                    muted={excluded}
                                    iconText={iconText}
                                    aria-label={file.name}
                                    title={file.name}
                                >
                                    {icon}
                                </SidebarRailItem>
                            )}
                        </li>
                    );
                })}
                {synced.map(target => {
                    const name = sourceDetailsTitle(target);
                    return (
                        <li key={`${target.kind}-${target.source.id}`}>
                            <SidebarRailItem
                                onClick={() => openSourceDetails({ kind: target.kind, id: target.source.id })}
                                // Greyed out like its row when none of its files is in the chat filter.
                                muted={target.kind === 'rss'
                                    ? feedExcluded(target.source.id, fileMgmt.files)
                                    : syncedExcluded(target.kind, target.source.id, fileMgmt.files)}
                                iconText={SOURCE_TYPE_CHIP[target.kind]}
                                aria-label={name}
                                title={name}
                            />
                        </li>
                    );
                })}
            </SidebarRail>
        </>
    );
}
