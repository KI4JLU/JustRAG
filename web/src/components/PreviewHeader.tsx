import type React from 'react';
import {
    FileAudio, FileImage, FilePen, FileSpreadsheet, FileText, FileType, FileVideo, type LucideIcon,
} from 'lucide-react';
import type { PreviewBack, PreviewHeaderProps as DsPreviewHeaderProps } from '@ki4jlu/design-system';
import { useTheme } from '../contexts/ThemeContext';
import { cleanSourceTitle } from '../utils/sourceDisplay';
import type { PreviewKind } from '../utils/previewKind';

export type { PreviewBack };

// The same glyph per type as the source list (sidebar/sourceIconFor) and the cited-source tile (sources/SourcePreview).
const KIND_ICON: Record<PreviewKind, LucideIcon> = {
    pdf: FileText,
    spreadsheet: FileSpreadsheet,
    markdown: FileType,
    text: FileType,
    document: FilePen,
    image: FileImage,
    audio: FileAudio,
    video: FileVideo,
};

/**
 * The app's side of the DS preview header (`PreviewHeader` in
 * @ki4jlu/design-system): a preview names its kind, not a glyph, and its
 * title is a file name — shown cleaned, the raw name as the tooltip.
 */
export interface PreviewHeaderProps {
    kind: PreviewKind;
    /** Overrides the kind's glyph (a synced source's entry list: feed, Confluence, repository). */
    icon?: LucideIcon;
    title: string;
    /** Whether the title is a file name (cleaned for display, the raw name as tooltip). Default true. */
    fileTitle?: boolean;
    /** An input in the title's place (a new source being named, „Text einfügen"). */
    titleField?: React.ReactNode;
    /** One line under the title: format, size, "nur Lesen". */
    subtitle: React.ReactNode;
    /** Header actions left of the dialog's close button ("In Confluence öffnen"). */
    actions?: React.ReactNode;
    /** The way back to the list this preview was opened from ("‹ Aktuelles (HRZ)"), above the title. */
    back?: PreviewBack;
}

/** Maps the app's header props onto the DS header's, with translated labels. */
export function useDsHeaderProps({ kind, icon, title, fileTitle = true, ...rest }: PreviewHeaderProps): DsPreviewHeaderProps {
    const { t } = useTheme();
    return {
        ...rest,
        icon: icon ?? KIND_ICON[kind],
        title: fileTitle ? cleanSourceTitle(title) : title,
        titleTooltip: fileTitle ? title : undefined,
        labels: { close: t('close'), nav: t('breadcrumbNav'), back: t('backTo') },
    };
}
