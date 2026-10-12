import {
    Bot, File, FileAudio, FileCode, FileImage, FileJson, FilePen, FileSpreadsheet,
    FileText, FileType, FileVideo, Globe, Link, Presentation, Rss, type LucideIcon,
} from 'lucide-react';
import type { FileEntry } from '../../types';

/**
 * Glyph by file type, keyed on the extensions the upload accepts
 * (ACCEPTED_FILE_TYPES in constants.ts). An unknown extension falls back to
 * the MIME type, then to the origin (web search, crawl, research, feed),
 * whose entries often carry a page title rather than a file name.
 */
const BY_EXTENSION: Record<string, LucideIcon> = {
    pdf: FileText,
    docx: FilePen, odt: FilePen, epub: FilePen, tex: FilePen,
    pptx: Presentation,
    xlsx: FileSpreadsheet, xls: FileSpreadsheet, ods: FileSpreadsheet, csv: FileSpreadsheet,
    png: FileImage, jpg: FileImage, jpeg: FileImage, webp: FileImage, bmp: FileImage,
    tif: FileImage, tiff: FileImage, gif: FileImage,
    mp3: FileAudio, wav: FileAudio, m4a: FileAudio, mpeg: FileAudio, ogg: FileAudio, flac: FileAudio,
    mp4: FileVideo, webm: FileVideo,
    txt: FileType, md: FileType, markdown: FileType, log: FileType,
    json: FileJson,
    yaml: FileCode, yml: FileCode,
};

const BY_ORIGIN: Record<string, LucideIcon> = {
    websearch: Link,
    crawl: Globe,
    research: Bot,
    rss: Rss,
};

/**
 * The short type label shown in the icon tile when the name has a known
 * extension ("PDF", "DOCX", "XLSX"), the same wording as the preview card's
 * badge. `null` when there is none — the tile then shows `sourceIconFor`.
 */
export function sourceTypeLabel(file: Pick<FileEntry, 'name'>): string | null {
    const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
    if (!BY_EXTENSION[ext]) return null;
    return (ext === 'markdown' ? 'md' : ext === 'jpeg' ? 'jpg' : ext === 'tiff' ? 'tif' : ext).toUpperCase();
}

export function sourceIconFor(file: Pick<FileEntry, 'name' | 'type' | 'origin'>): LucideIcon {
    const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
    if (BY_EXTENSION[ext]) return BY_EXTENSION[ext];
    const type = file.type ?? '';
    if (type === 'application/pdf') return FileText;
    if (type.startsWith('image/')) return FileImage;
    if (type.startsWith('audio/')) return FileAudio;
    if (type.startsWith('video/')) return FileVideo;
    if (type.includes('spreadsheet') || type === 'text/csv') return FileSpreadsheet;
    if (type.includes('presentation')) return Presentation;
    if (type.startsWith('text/')) return FileType;
    return (file.origin && BY_ORIGIN[file.origin]) || File;
}
