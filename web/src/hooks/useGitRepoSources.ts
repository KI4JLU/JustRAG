import { useState, useCallback, useEffect, useRef } from 'react';
import axios from 'axios';
import type { KnowledgeBase, GitRepoSource, SyncSchedule } from '../types';
import { API_BASE_URL } from '../api';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { getApiErrorMessage, isForbidden } from '../utils/apiError';
import { unlistableKbId } from '../utils/kbAccess';

interface UseGitRepoSourcesParams {
    currentKb: KnowledgeBase | null;
    fetchFiles: (kbId: string) => Promise<void>;
}

const POLL_INTERVAL_MS = 3000;

export function useGitRepoSources({ currentKb, fetchFiles }: UseGitRepoSourcesParams) {
    const { t } = useTheme();
    const toast = useToast();
    const [gitRepoSources, setGitRepoSources] = useState<GitRepoSource[]>([]);
    const [gitRepoLoading, setGitRepoLoading] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const wasSyncingRef = useRef(false);

    // No seeSources on the open KB: its git sources are never requested.
    const unlistable = unlistableKbId(currentKb);
    const fetchGitRepoSources = useCallback(async (kbId?: string) => {
        const id = kbId || currentKb?.id;
        if (!id) return;
        if (id === unlistable) {
            setGitRepoSources([]);
            return;
        }
        try {
            const res = await axios.get(`${API_BASE_URL}/api/kb/${id}/git-repos`);
            setGitRepoSources(Array.isArray(res.data) ? res.data : []);
        } catch (err: unknown) {
            if (axios.isCancel(err)) return;
            // No seeSources on this KB: no list (and not the previous KB's).
            if (isForbidden(err)) {
                setGitRepoSources([]);
                return;
            }
            console.error('Failed to fetch git repo sources:', err);
        }
    }, [currentKb?.id, unlistable]);

    // Poll while any source is syncing
    useEffect(() => {
        const isSyncing = gitRepoSources.some(s => s.status === 'syncing');

        if (isSyncing && !pollRef.current) {
            wasSyncingRef.current = true;
            pollRef.current = setInterval(() => {
                fetchGitRepoSources();
                if (wasSyncingRef.current && currentKb) {
                    fetchFiles(currentKb.id);
                }
            }, POLL_INTERVAL_MS);
        } else if (!isSyncing && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            if (currentKb) {
                wasSyncingRef.current = false;
                fetchFiles(currentKb.id);
            }
        }

        if (isSyncing) wasSyncingRef.current = true;

        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
    }, [gitRepoSources, fetchGitRepoSources, fetchFiles, currentKb]);

    const addGitRepoSource = useCallback(async (data: {
        repoUrl: string;
        isPrivate: boolean;
        accessToken?: string;
        branch?: string;
        syncSchedule?: SyncSchedule;
    }) => {
        if (!currentKb) return;
        setGitRepoLoading(true);
        try {
            await axios.post(`${API_BASE_URL}/api/kb/${currentKb.id}/git-repos`, data);
            toast.success(t('gitRepoSourceAdded'));
            await fetchGitRepoSources(currentKb.id);
            await fetchFiles(currentKb.id);
        } catch (err: unknown) {
            toast.error(getApiErrorMessage(err, t('error')));
        } finally {
            setGitRepoLoading(false);
        }
    }, [currentKb, fetchGitRepoSources, fetchFiles, t, toast]);

    const updateGitRepoSource = useCallback(async (sourceId: string, updates: { syncSchedule?: SyncSchedule; status?: 'active' | 'paused' }) => {
        if (!currentKb) return;
        setGitRepoSources(prev => prev.map(s => s.id === sourceId ? { ...s, ...updates } : s));
        try {
            const res = await axios.patch(`${API_BASE_URL}/api/kb/${currentKb.id}/git-repos/${sourceId}`, updates);
            setGitRepoSources(prev => prev.map(s => s.id === sourceId ? res.data : s));
            toast.success(t('gitRepoSourceUpdated'));
        } catch (err: unknown) {
            await fetchGitRepoSources(currentKb.id);
            toast.error(getApiErrorMessage(err, t('error')));
        }
    }, [currentKb, fetchGitRepoSources, t, toast]);

    /** Deletes the given git sources with their files. No confirmation of its
     *  own: the source list's remove selection asks once for everything ticked. */
    const deleteGitRepoSources = useCallback(async (sourceIds: string[]) => {
        if (!currentKb || sourceIds.length === 0) return;
        const ids = new Set(sourceIds);
        setGitRepoSources(prev => prev.filter(s => !ids.has(s.id)));
        const results = await Promise.allSettled(sourceIds.map(id => axios.delete(`${API_BASE_URL}/api/kb/${currentKb.id}/git-repos/${id}`)));
        const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failure) {
            await fetchGitRepoSources(currentKb.id);
            toast.error(getApiErrorMessage(failure.reason, t('error')));
        } else {
            toast.success(t('gitRepoSourceDeleted'));
        }
        await fetchFiles(currentKb.id);
    }, [currentKb, fetchFiles, fetchGitRepoSources, t, toast]);

    const syncGitRepoNow = useCallback(async (sourceId: string) => {
        if (!currentKb) return;
        try {
            await axios.post(`${API_BASE_URL}/api/kb/${currentKb.id}/git-repos/${sourceId}/sync`);
            toast.success(t('gitRepoSyncTriggered'));
            await fetchGitRepoSources(currentKb.id);
        } catch (err: unknown) {
            toast.error(getApiErrorMessage(err, t('error')));
        }
    }, [currentKb, fetchGitRepoSources, t, toast]);

    return {
        gitRepoSources,
        gitRepoLoading,
        fetchGitRepoSources,
        addGitRepoSource,
        updateGitRepoSource,
        deleteGitRepoSources,
        syncGitRepoNow,
    };
}
