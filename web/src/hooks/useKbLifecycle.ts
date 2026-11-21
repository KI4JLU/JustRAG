import { useEffect } from 'react';
import type { KnowledgeBase } from '../types';

interface UseKbLifecycleParams {
  token: string | null;
  currentKb: KnowledgeBase | null;
  fetchKBs: () => void;
  fetchAvailableConfigs: () => void;
  fetchFiles: (kbId: string, signal?: AbortSignal) => void;
  fetchChats: (kbId: string, signal?: AbortSignal) => void;
  fetchRssFeeds: (kbId: string, signal?: AbortSignal) => void;
  fetchConfluenceSources: (kbId: string, signal?: AbortSignal) => void;
  fetchConfluenceConnectionInfo: () => void;
}

export function useKbLifecycle({
  token, currentKb,
  fetchKBs, fetchAvailableConfigs,
  fetchFiles, fetchChats,
  fetchRssFeeds, fetchConfluenceSources, fetchConfluenceConnectionInfo,
}: UseKbLifecycleParams) {
  // Fetch KBs and configs on auth
  useEffect(() => {
    if (token) {
      fetchKBs();
      fetchAvailableConfigs();
    }
  }, [token, fetchKBs, fetchAvailableConfigs]);

  // Fetch KB data when KB changes (abort in-flight requests from previous KB)
  useEffect(() => {
    if (currentKb) {
      const controller = new AbortController();
      fetchFiles(currentKb.id, controller.signal);
      fetchChats(currentKb.id, controller.signal);
      fetchRssFeeds(currentKb.id, controller.signal);
      fetchConfluenceSources(currentKb.id, controller.signal);
      fetchConfluenceConnectionInfo();
      return () => controller.abort();
    }
  }, [currentKb, fetchFiles, fetchChats, fetchRssFeeds, fetchConfluenceSources, fetchConfluenceConnectionInfo]);
}
