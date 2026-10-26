import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../api';

/**
 * Object URLs of the caller's own user files (chat attachments, library
 * files), fetched once per file through the authenticated client — an <img>
 * src could not carry the token — and kept for the session, like the source
 * list's previews (hooks/sourcePreviews). A chat attachment has no KB file,
 * so it is read from the owner-only library route.
 */
const urls = new Map<string, Promise<string | null>>();

/** The file's object URL, fetched once per session (null when the fetch failed). */
export function loadUserFileUrl(userFileId: string): Promise<string | null> {
    let hit = urls.get(userFileId);
    if (!hit) {
        hit = axios.get(`${API_BASE_URL}/api/library/files/${userFileId}/download`, { responseType: 'blob' })
            .then(res => URL.createObjectURL(res.data as Blob))
            .catch(() => {
                // A failed fetch may be retried by a later chip.
                urls.delete(userFileId);
                return null;
            });
        urls.set(userFileId, hit);
    }
    return hit;
}

/** The file's object URL once loaded; `undefined` while loading, disabled or failed. */
export function useUserFileUrl(userFileId: string, enabled: boolean): string | undefined {
    const [url, setUrl] = useState<{ id: string; url: string } | null>(null);
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        void loadUserFileUrl(userFileId).then(u => { if (!cancelled && u) setUrl({ id: userFileId, url: u }); });
        return () => { cancelled = true; };
    }, [userFileId, enabled]);
    return url?.id === userFileId ? url.url : undefined;
}
