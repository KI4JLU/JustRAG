import { isSpreadsheetFile } from './fileTypes';

/**
 * How a source is previewed — the ONE decision every preview surface reads:
 * the hover thumbnail, a click in the source list, a chat citation, an
 * answer's source card, the source panel's full view and a search hit. A
 * second hand-kept list of types anywhere else is what let the hover card show
 * a PNG the click preview then refused.
 *
 *  - `pdf` — the PDF viewer
 *  - `spreadsheet` — the table preview (ingest report + tables)
 *  - `markdown` / `text` — the stored file in the text viewer, rendered or literal
 *  - `document` — Word, slides, ODT, EPUB, TeX: the text the server extracts
 *    (`GET /api/files/{id}/text`) in the text viewer
 *  - `image`, `audio`, `video` — the file itself, in the browser's own element
 *
 * `null` = no preview (a TIFF, a legacy video codec, an unknown binary); the
 * download is the only way to look at it.
 */
export type PreviewKind = 'pdf' | 'spreadsheet' | 'markdown' | 'text' | 'document' | 'image' | 'audio' | 'video';

/** What the resolver reads: the stored name and, when known, the MIME type. */
export interface PreviewSubject {
    name: string;
    /** `files.type`; absent when a caller only has a file id and name (a search hit before the file list loaded). */
    type?: string | null;
}

const ext = (name: string): string => {
    const base = name.split('/').pop() ?? name;
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
};

// Images every current browser decodes. TIFF and PNM are ingested (OCR) but
// not displayable, so they get no preview rather than a broken image.
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']);
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/bmp', 'image/x-ms-bmp']);

// The upload's audio extensions (parser/supported.go) a browser plays.
const AUDIO_EXT = new Set(['mp3', 'mpga', 'wav', 'm4a', 'ogg', 'oga', 'flac']);
const VIDEO_EXT = new Set(['mp4', 'webm']);
const VIDEO_MIME = new Set(['video/mp4', 'video/webm']);

const DOCUMENT_EXT = new Set(['docx', 'pptx', 'odt', 'epub', 'tex']);
const DOCUMENT_MIME = new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/epub+zip',
    'application/x-tex',
    'text/x-tex',
]);

const SPREADSHEET_MIME = new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/csv',
    'text/tab-separated-values',
]);

const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdx']);

// Text the stored file shows as is: the upload's text and config formats,
// the git source's code files (gitrepo/filter.go) and HTML imports — shown
// as source, never rendered.
const TEXT_EXT = new Set([
    'txt', 'log', 'json', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'toml', 'env', 'zsh', 'fish',
    'xml', 'html', 'htm', 'rst', 'adoc', 'sql', 'css', 'scss', 'proto', 'gradle', 'tf',
    'go', 'py', 'js', 'ts', 'tsx', 'jsx', 'vue', 'java', 'c', 'h', 'cpp', 'hpp', 'cs',
    'rb', 'rs', 'php', 'swift', 'kt', 'scala', 'sh',
]);

export function previewKindOf({ name, type }: PreviewSubject): PreviewKind | null {
    const mime = (type ?? '').toLowerCase().split(';')[0].trim();
    const e = ext(name);

    // MIME first: it is what the server stored, and it is right for names
    // that carry no extension (a page title, a Confluence attachment title).
    if (mime === 'application/pdf') return 'pdf';
    if (SPREADSHEET_MIME.has(mime)) return 'spreadsheet';
    if (DOCUMENT_MIME.has(mime)) return 'document';
    if (IMAGE_MIME.has(mime)) return 'image';
    if (VIDEO_MIME.has(mime)) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime === 'text/markdown') return 'markdown';
    if (mime.startsWith('text/') || mime === 'application/json') {
        return MARKDOWN_EXT.has(e) ? 'markdown' : 'text';
    }

    // The name alone (no MIME, or a generic one like application/octet-stream).
    if (e === 'pdf') return 'pdf';
    if (isSpreadsheetFile(name)) return 'spreadsheet';
    if (DOCUMENT_EXT.has(e)) return 'document';
    if (IMAGE_EXT.has(e)) return 'image';
    if (AUDIO_EXT.has(e)) return 'audio';
    if (VIDEO_EXT.has(e)) return 'video';
    if (MARKDOWN_EXT.has(e)) return 'markdown';
    if (TEXT_EXT.has(e)) return 'text';
    // No extension (README, Dockerfile, LICENSE, a pasted text titled by the
    // user): the server indexes these as text, so they read as text too.
    if (!e && (!mime || mime === 'application/octet-stream')) return 'text';
    return null;
}

/**
 * The kinds the hover card shows a thumbnail of: a PDF's first page, the
 * image itself, or the first lines of a text, Markdown or document source.
 */
export const hasThumbnail = (kind: PreviewKind | null): kind is 'pdf' | 'image' | 'markdown' | 'text' | 'document' =>
    kind === 'pdf' || kind === 'image' || kind === 'markdown' || kind === 'text' || kind === 'document';
