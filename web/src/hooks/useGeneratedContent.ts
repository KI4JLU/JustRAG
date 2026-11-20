import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import type { KnowledgeBase, GeneratedContent } from '../types';
import { API_BASE_URL } from '../api';
import { useTheme } from '../contexts/ThemeContext';
import { useModalContext } from '../contexts/ModalContext';
import { useToast } from '../contexts/ToastContext';

interface PodcastProgress {
  step: 'waiting' | 'script' | 'audio' | 'done';
  current?: number;
  total?: number;
  message: string;
}

interface UseGeneratedContentParams {
  currentKb: KnowledgeBase | null;
}

export function useGeneratedContent({
  currentKb,
}: UseGeneratedContentParams) {
  const { language, t } = useTheme();
  const { showPrompt, showConfirm } = useModalContext();
  const toast = useToast();
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent[]>([]);
  const [generating, setGenerating] = useState(false);
  const [selectedContent, setSelectedContent] = useState<GeneratedContent | null>(null);

  // Podcast async state
  const [podcastProgress, setPodcastProgress] = useState<PodcastProgress | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up polling on KB change or unmount
  const currentKbId = currentKb?.id;
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setPodcastProgress(null);
    };
  }, [currentKbId]);

  const fetchGeneratedContent = useCallback(async (kbId: string, signal?: AbortSignal) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/kb/${kbId}/generated-content`, { signal });
      setGeneratedContent(res.data);
      // Returned so callers that just created an artifact can select it from
      // the refreshed list. Additive: every existing caller ignores it.
      return res.data as GeneratedContent[];
    } catch (err: unknown) {
      if (axios.isCancel(err)) return null;
      console.error('Failed to fetch generated content:', err);
      toast.error(t('contentFetchError'));
    }
    return null;
  }, [t, toast]);

  const startPodcastPolling = useCallback((kbId: string, jobId: string) => {
    setPodcastProgress({ step: 'waiting', message: t('podcastWaiting') });
    let consecutiveFailures = 0;

    pollRef.current = setInterval(async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/api/kb/${kbId}/generate/podcast/status/${jobId}`);
        consecutiveFailures = 0;
        const { state, progress, error } = res.data;

        if (progress) {
          setPodcastProgress(progress);
        }

        if (state === 'completed') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setPodcastProgress(null);
          setGenerating(false);
          // The status endpoint reports only {state, progress}, so the freshly
          // fetched list is the only place the new artifact exists.
          void fetchGeneratedContent(kbId).then(list => {
            const newest = (list ?? [])
              .filter(c => c.type === 'podcast')
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
            if (newest) setSelectedContent(newest);
          });
          toast.success(t('successGenerate'));
        } else if (state === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setPodcastProgress(null);
          setGenerating(false);
          toast.error(error || t('podcastFailed'));
        }
      } catch {
        consecutiveFailures++;
        if (consecutiveFailures >= 5) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setPodcastProgress(null);
          setGenerating(false);
          toast.error(t('podcastPollingFailed'));
        }
      }
    }, 3000);
  }, [t, fetchGeneratedContent, toast]);

  const handleGenerate = useCallback(async (type: 'cards' | 'presentation' | 'podcast' | 'briefing_doc' | 'faq' | 'study_guide' | 'timeline' | 'quiz') => {
    const topic = await showPrompt(t('enterGenerationTopic'));
    if (!topic || !currentKb) return;

    setGenerating(true);
    try {
      if (type === 'podcast') {
        // Async: fire-and-forget, then poll (podcasts always in English for now - German TTS voices not available)
        const res = await axios.post(`${API_BASE_URL}/api/kb/${currentKb.id}/generate/podcast`, { topic, language: 'en' });
        const { jobId } = res.data;
        startPodcastPolling(currentKb.id, jobId);
      } else {
        // Sync: wait for completion
        const res = await axios.post(`${API_BASE_URL}/api/kb/${currentKb.id}/generate/${type}`, { topic, language });
        await fetchGeneratedContent(currentKb.id);
        // Open what was just created instead of leaving the user on an empty
        // workspace with only a toast to tell them something happened.
        if (res.data?.id) setSelectedContent(res.data as GeneratedContent);
        toast.success(t('successGenerate'));
        setGenerating(false);
      }
    } catch (err: unknown) {
      console.error('Generation failed:', err);
      toast.error(t('errorGenerate'));
      setGenerating(false);
    }
  }, [currentKb, language, showPrompt, t, fetchGeneratedContent, startPodcastPolling, toast]);

  const handleDeleteGeneratedContent = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!await showConfirm(t('confirmDeleteContent'), undefined, { tone: 'destructive', confirmLabel: t('delete') })) return;
    let snapshot: GeneratedContent[] = [];
    setGeneratedContent(prev => { snapshot = prev; return prev.filter(c => c.id !== id); });
    try {
      await axios.delete(`${API_BASE_URL}/api/generated-content/${id}`);
    } catch {
      setGeneratedContent(snapshot);
      toast.error(t('deleteContentError'));
    }
  }, [showConfirm, t, toast]);

  return useMemo(() => ({
    generatedContent, setGeneratedContent, generating,
    selectedContent, setSelectedContent,
    fetchGeneratedContent, handleGenerate, handleDeleteGeneratedContent,
    podcastProgress,
  }), [
    generatedContent, generating,
    selectedContent,
    fetchGeneratedContent, handleGenerate, handleDeleteGeneratedContent,
    podcastProgress,
  ]);
}
