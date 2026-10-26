import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import type { KnowledgeBase, RssFeed, SyncSchedule } from '../types';
import { API_BASE_URL } from '../api';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { getApiErrorMessage, isForbidden } from '../utils/apiError';
import { unlistableKbId } from '../utils/kbAccess';

const POLL_REFRESH_MS = 3000;
// A poll that has not reported back by then stops spinning; the feed's own
// status (error) or the next refresh tells the rest.
const POLL_WAIT_MS = 120_000;

type Polls = Record<string, { since: string | null; until: number }>;

/** Drops the polls that have landed (a newer lastPolledAt, or the feed is gone) or timed out; the same object when nothing changed. */
function settledPolls(prev: Polls, feeds: RssFeed[] | null): Polls {
    const now = Date.now();
    let changed = false;
    const next: Polls = {};
    for (const [id, p] of Object.entries(prev)) {
        const feed = feeds?.find(f => f.id === id);
        const landed = feeds !== null && (!feed || feed.lastPolledAt !== p.since);
        if (landed || now > p.until) { changed = true; continue; }
        next[id] = p;
    }
    return changed ? next : prev;
}

interface UseRssFeedsParams {
    currentKb: KnowledgeBase | null;
    fetchFiles: (kbId: string) => Promise<void>;
}

export function useRssFeeds({ currentKb, fetchFiles }: UseRssFeedsParams) {
    const { t } = useTheme();
    const toast = useToast();
    const [rssFeeds, setRssFeeds] = useState<RssFeed[]>([]);
    const [rssLoading, setRssLoading] = useState(false);
    // Feeds with a poll in flight: id → the feed's lastPolledAt when the poll
    // was asked for, and when to give up waiting. A poll runs in the worker;
    // it is done once the feed reports a newer lastPolledAt.
    const [polling, setPolling] = useState<Record<string, { since: string | null; until: number }>>({});
    const feedsRef = useRef(rssFeeds);
    useEffect(() => { feedsRef.current = rssFeeds; }, [rssFeeds]);

    // No seeSources on the open KB: its feed list is never requested.
    const unlistable = unlistableKbId(currentKb);
    const fetchRssFeeds = useCallback(async (kbId?: string, signal?: AbortSignal) => {
        const id = kbId || currentKb?.id;
        if (!id) return;
        if (id === unlistable) {
            setRssFeeds([]);
            return;
        }
        try {
            const res = await axios.get(`${API_BASE_URL}/api/kb/${id}/rss`, { signal });
            const feeds: RssFeed[] = Array.isArray(res.data) ? res.data : [];
            setRssFeeds(feeds);
            setPolling(prev => settledPolls(prev, feeds));
        } catch (err: unknown) {
            if (axios.isCancel(err)) return;
            // No seeSources on this KB: no list, and nothing to report.
            if (isForbidden(err)) {
                setRssFeeds([]);
                return;
            }
            console.error('Failed to fetch RSS feeds:', err);
            toast.error(t('rssFetchError'));
        }
    }, [currentKb?.id, t, toast, unlistable]);

    const addRssFeed = useCallback(async (url: string, syncSchedule: SyncSchedule, fetchFullText: boolean) => {
        if (!currentKb) return;
        setRssLoading(true);
        try {
            const res = await axios.post(`${API_BASE_URL}/api/kb/${currentKb.id}/rss`, { url, syncSchedule, fetchFullText });
            setRssFeeds(prev => [res.data, ...prev]);
            toast.success(t('rssFeedAdded'));
            // Poll for updates: the worker processes the initial feed asynchronously.
            // Refresh both the feed list (for itemCount) and files at 3s, 8s, 15s.
            for (const delay of [3000, 8000, 15000]) {
                setTimeout(() => {
                    fetchRssFeeds();
                    fetchFiles(currentKb.id);
                }, delay);
            }
        } catch (err: unknown) {
            toast.error(getApiErrorMessage(err, t('error')));
        } finally {
            setRssLoading(false);
        }
    }, [currentKb, fetchFiles, fetchRssFeeds, t, toast]);

    const updateRssFeed = useCallback(async (feedId: string, updates: { syncSchedule?: SyncSchedule; status?: 'active' | 'paused'; fetchFullText?: boolean }) => {
        if (!currentKb) return;
        setRssFeeds(prev => prev.map(f => f.id === feedId ? { ...f, ...updates } : f));
        try {
            const res = await axios.patch(`${API_BASE_URL}/api/kb/${currentKb.id}/rss/${feedId}`, updates);
            setRssFeeds(prev => prev.map(f => f.id === feedId ? res.data : f));
            toast.success(t('rssFeedUpdated'));
        } catch (err: unknown) {
            await fetchRssFeeds();
            toast.error(getApiErrorMessage(err, t('error')));
        }
    }, [currentKb, fetchRssFeeds, t, toast]);

    // Deletes without asking: the caller has confirmed (the sources remove
    // mode asks once for the whole batch). A feed takes its
    // files with it, so the file list is re-read afterwards.
    const deleteRssFeeds = useCallback(async (feedIds: string[]) => {
        if (!currentKb || feedIds.length === 0) return;
        const ids = new Set(feedIds);
        setRssFeeds(prev => prev.filter(f => !ids.has(f.id)));
        const results = await Promise.allSettled(feedIds.map(id => axios.delete(`${API_BASE_URL}/api/kb/${currentKb.id}/rss/${id}`)));
        const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failure) {
            await fetchRssFeeds();
            toast.error(getApiErrorMessage(failure.reason, t('error')));
        } else {
            toast.success(t('rssFeedDeleted'));
        }
        await fetchFiles(currentKb.id);
    }, [currentKb, fetchFiles, fetchRssFeeds, t, toast]);

    const pollFeedNow = useCallback(async (feedId: string) => {
        if (!currentKb) return;
        try {
            await axios.post(`${API_BASE_URL}/api/kb/${currentKb.id}/rss/${feedId}/poll`);
            toast.success(t('rssPollTriggered'));
            const since = feedsRef.current.find(f => f.id === feedId)?.lastPolledAt ?? null;
            setPolling(prev => ({ ...prev, [feedId]: { since, until: Date.now() + POLL_WAIT_MS } }));
        } catch (err: unknown) {
            toast.error(getApiErrorMessage(err, t('error')));
        }
    }, [currentKb, t, toast]);

    // While a poll is in flight, the feed and its new items are re-read
    // every few seconds, so the row's spinner stops when the poll lands and
    // the new items show up as they are ingested.
    const kbId = currentKb?.id;
    const anyPolling = Object.keys(polling).length > 0;
    useEffect(() => {
        if (!anyPolling || !kbId) return;
        const timer = setInterval(() => {
            setPolling(prev => settledPolls(prev, null));
            fetchRssFeeds();
            fetchFiles(kbId);
        }, POLL_REFRESH_MS);
        return () => clearInterval(timer);
    }, [anyPolling, kbId, fetchRssFeeds, fetchFiles]);

    const pollingFeedIds = useMemo(() => new Set(Object.keys(polling)), [polling]);

    return { rssFeeds, rssLoading, fetchRssFeeds, addRssFeed, updateRssFeed, deleteRssFeeds, pollFeedNow, pollingFeedIds };
}
