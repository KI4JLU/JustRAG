import { useCallback, useEffect, useSyncExternalStore } from 'react';
import axios from 'axios';
import { preloadPdfjs, renderPdfFirstPage } from '@ki4jlu/design-system';
import { API_BASE_URL } from '../api';
import type { FileEntry } from '../types';
import { hasThumbnail, previewKindOf } from '../utils/previewKind';

/**
 * Pre-rendered hover previews for the sources list.
 *
 * A preview that is fetched (and, for a PDF, decoded) when the hover card
 * opens always trails the card by the round trip plus pdf.js. So the list
 * prepares its previews ahead of time: the file is fetched through the
 * authenticated client (an <img src> could not carry the bearer token), a PDF
 * is rendered off-screen to a 160×192 bitmap once, and the result is kept
 * per file id for the session. The hover card then shows a plain <img> whose
 * source is already in memory — in sync with the card.
 *
 * Preloading is capped (`PRELOAD_LIMIT`, top of the list) and sequential, so
 * a KB with thousands of files does not fan out thousands of requests; rows
 * past the cap still warm up on pointer-enter.
 */
export interface PreviewImage {
    /** A picture: the image itself or a PDF's rendered first page. */
    url?: string;
    mediaType?: string;
    /** The start of a text, Markdown or document source (its extracted text). */
    text?: string;
}

/** How much of a text source the 160×192 card can show. */
const SNIPPET_CHARS = 1200;

/** Same box as DS `FilePreview`. */
const PREVIEW_W = 160;
const PREVIEW_H = 192;
const PRELOAD_LIMIT = 40;

// Which files get a thumbnail is the shared preview decision (previewKindOf),
// so a file with a thumbnail always opens in the preview on click too.
export const canPreviewSource = (file: FileEntry) =>
    file.status === 'completed' && hasThumbnail(previewKindOf(file));

// The list preloads pictures only. A text snippet means downloading the whole
// file (or extracting a document), so text kinds build on hover.
const preloads = (file: FileEntry) => {
    const kind = previewKindOf(file);
    return kind === 'pdf' || kind === 'image';
};

/** The snippet a card shows: Markdown's heading marks dropped, whitespace runs folded. */
function snippet(text: string, markdown: boolean): string {
    const head = text.slice(0, SNIPPET_CHARS * 2);
    const plain = markdown ? head.replace(/^#{1,6}\s+/gm, '').replace(/\*\*|__/g, '') : head;
    return plain.replace(/\n{3,}/g, '\n\n').trim().slice(0, SNIPPET_CHARS);
}

const pending = new Map<string, Promise<PreviewImage | null>>();
// Image sources by file id: the thumbnail IS the original file, so the click
// preview shows this URL instead of downloading the image again. PDFs keep
// only their rendered first page (the original can be large), so their
// preview fetches the file.
const originals = new Map<string, string>();
const resolved = new Map<string, PreviewImage | null>();
const listeners = new Map<string, Set<() => void>>();

const notify = (id: string) => listeners.get(id)?.forEach(fn => fn());

async function build(file: FileEntry): Promise<PreviewImage | null> {
    const kind = previewKindOf(file);
    if (kind === 'document') {
        const res = await axios.get<{ text: string; markdown: boolean }>(`${API_BASE_URL}/api/files/${file.id}/text`);
        return { text: snippet(res.data.text, res.data.markdown) };
    }
    if (kind === 'markdown' || kind === 'text') {
        const res = await axios.get<string>(`${API_BASE_URL}/api/files/${file.id}/download`, { responseType: 'text' });
        return { text: snippet(String(res.data), kind === 'markdown') };
    }
    const res = await axios.get(`${API_BASE_URL}/api/files/${file.id}/download`, { responseType: 'blob' });
    const blob = res.data as Blob;
    if (previewKindOf(file) === 'pdf') {
        const blobUrl = URL.createObjectURL(blob);
        try {
            return { url: await renderPdfFirstPage(blobUrl, PREVIEW_W, PREVIEW_H), mediaType: 'image/png' };
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
    }
    const url = URL.createObjectURL(blob);
    originals.set(file.id, url);
    return { url, mediaType: blob.type || file.type || 'image/png' };
}

/** The already-downloaded image of an image source, if its thumbnail was built. */
export function cachedSourceImage(fileId: string): string | undefined {
    return originals.get(fileId);
}

/** Starts (or joins) the preview build for one file; idempotent. */
export function preloadSourcePreview(file: FileEntry): Promise<PreviewImage | null> {
    if (!canPreviewSource(file)) return Promise.resolve(null);
    const hit = pending.get(file.id);
    if (hit) return hit;
    if (previewKindOf(file) === 'pdf') preloadPdfjs();
    const p = build(file)
        .catch(() => null)
        .then(img => { resolved.set(file.id, img); notify(file.id); return img; });
    pending.set(file.id, p);
    return p;
}

/** Preloads the first `PRELOAD_LIMIT` previewable files, one after another. */
export function useSourcePreviews(files: FileEntry[]): void {
    useEffect(() => {
        let cancelled = false;
        const queue = files.filter(f => canPreviewSource(f) && preloads(f) && !pending.has(f.id)).slice(0, PRELOAD_LIMIT);
        (async () => {
            for (const file of queue) {
                if (cancelled) return;
                await preloadSourcePreview(file);
            }
        })();
        return () => { cancelled = true; };
    }, [files]);
}

/** The prepared preview of one file: `image` once built, `pending` while it is. */
export function useSourcePreview(file: FileEntry): { image: PreviewImage | null | undefined; pending: boolean } {
    const subscribe = useCallback((fn: () => void) => {
        const set = listeners.get(file.id) ?? new Set<() => void>();
        set.add(fn);
        listeners.set(file.id, set);
        return () => { set.delete(fn); if (set.size === 0) listeners.delete(file.id); };
    }, [file.id]);
    const image = useSyncExternalStore(subscribe, () => resolved.get(file.id), () => undefined);
    return { image, pending: image === undefined && canPreviewSource(file) };
}
