import { createElement } from 'react';
import { Plus } from 'lucide-react';
import { SidebarRail, SidebarRailItem } from '@ki4jlu/design-system';
import type { FileEntry } from '../../types';
import { useTheme } from '../../contexts/ThemeContext';
import { useKbData } from '../../contexts/KbDataContext';
import { useSourcePreviews } from '../../hooks/sourcePreviews';
import { SourceHoverPreview } from './SourceHoverPreview';
import { sourceIconFor, sourceTypeLabel } from './sourceIconFor';

/** Same filter as the expanded list (SourcesSection): files, not feed/sync items. */
const listedFiles = (files: FileEntry[]) =>
    files.filter(f => f.origin !== 'rss' && f.origin !== 'confluence' && f.origin !== 'git');

/**
 * The collapsed 60px right rail: one icon per source, the counterpart of the
 * history rail on the left. "Add source" leads, like "new chat" there. Each
 * icon opens the source's preview on click and shows the hover preview card
 * (DS `FilePreview`, with the file name, since the rail has no text) —
 * pre-rendered by the same cache the expanded list uses.
 */
export function SourcesRail() {
    const { t } = useTheme();
    const { fileMgmt, webTools } = useKbData();
    const files = listedFiles(fileMgmt.files);
    useSourcePreviews(files);

    return (
        <>
            <SidebarRailItem
                variant="action"
                onClick={() => fileMgmt.setShowUploadModal(true)}
                title={t('addSources')}
                aria-label={t('addSources')}
            >
                <Plus aria-hidden="true" />
            </SidebarRailItem>
            <SidebarRail aria-label={t('sources')}>
                {files.map(file => {
                    const excluded = file.selected === false;
                    return (
                        <li key={file.id}>
                            <SourceHoverPreview file={file} showName>
                                <SidebarRailItem
                                    onClick={() => webTools.handlePreviewSource(file)}
                                    muted={excluded}
                                    iconText={sourceTypeLabel(file) ?? undefined}
                                    aria-label={file.name}
                                >
                                    {createElement(sourceIconFor(file), { 'aria-hidden': true })}
                                </SidebarRailItem>
                            </SourceHoverPreview>
                        </li>
                    );
                })}
            </SidebarRail>
        </>
    );
}
