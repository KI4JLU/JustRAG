import { useCallback, useEffect, useSyncExternalStore } from 'react';
import axios from 'axios';
import { preloadPdfjs, renderPdfFirstPage } from '@ki4jlu/design-system';
import { API_BASE_URL } from '../api';
import type { FileEntry } from '../types';

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
    url: string;
    mediaType: string;
}

/** Same box as DS `FilePreview`. */
const PREVIEW_W = 160;
const PREVIEW_H = 192;
const PRELOAD_LIMIT = 40;

export const canPreviewSource = (file: FileEntry) =>
    file.status === 'completed' && !!file.type && (file.type.startsWith('image/') || file.type === 'application/pdf');

const pending = new Map<string, Promise<PreviewImage | null>>();
const resolved = new Map<string, PreviewImage | null>();
const listeners = new Map<string, Set<() => void>>();

const notify = (id: string) => listeners.get(id)?.forEach(fn => fn());

async function build(file: FileEntry): Promise<PreviewImage | null> {
    const res = await axios.get(`${API_BASE_URL}/api/files/${file.id}/download`, { responseType: 'blob' });
    const blob = res.data as Blob;
    if (file.type === 'application/pdf') {
        const blobUrl = URL.createObjectURL(blob);
        try {
            return { url: await renderPdfFirstPage(blobUrl, PREVIEW_W, PREVIEW_H), mediaType: 'image/png' };
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
    }
    return { url: URL.createObjectURL(blob), mediaType: file.type };
}

/** Starts (or joins) the preview build for one file; idempotent. */
export function preloadSourcePreview(file: FileEntry): Promise<PreviewImage | null> {
    if (!canPreviewSource(file)) return Promise.resolve(null);
    const hit = pending.get(file.id);
    if (hit) return hit;
    if (file.type === 'application/pdf') preloadPdfjs();
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
        const queue = files.filter(f => canPreviewSource(f) && !pending.has(f.id)).slice(0, PRELOAD_LIMIT);
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
