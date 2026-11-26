import axios from 'axios';
import { useEffect, useRef } from 'react';
import { API_BASE_URL } from '../api';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import type { KnowledgeBase } from '../types';
import { setKbPreview, takeKeepChat, useKbPreview } from './kbPreview';

interface Options {
  currentKb: KnowledgeBase | null;
  setCurrentKb: (kb: KnowledgeBase) => void;
  /** Starts a fresh chat: a preview begins, and ends, on the topic's start page. */
  newChat: () => void;
}

/**
 * Keeps the open topic in step with the preview. Starting, switching or
 * ending a preview reloads the topic (GET /api/kb/{id}, which carries the
 * preview header while one is on) and makes that row the open topic, so every
 * control that reads the topic — sources, gear, citations — shows what the
 * previewed role sees. The row carries previewRole, which the access helpers
 * (utils/kbAccess) read before anything else; the owner mirror is cleared too,
 * so no client check re-derives the caller's real rights from it. myRole stays
 * the caller's own: it only places the topic (Mein / Geteiltes Wissen).
 *
 * Opening another topic ends the preview. A change made by opening a chat
 * from the history (alignKbPreviewWithChat) keeps that chat open.
 */
export function useKbPreviewSync({ currentKb, setCurrentKb, newChat }: Options): void {
  const { t } = useTheme();
  const toast = useToast();
  const preview = useKbPreview();
  const key = preview ? `${preview.kbId}:${preview.role}` : null;
  const lastKey = useRef<string | null>(null);
  const latest = useRef({ currentKb, setCurrentKb, newChat, t, toast });
  useEffect(() => { latest.current = { currentKb, setCurrentKb, newChat, t, toast }; });

  const currentKbId = currentKb?.id ?? null;
  useEffect(() => {
    if (preview && currentKbId && currentKbId !== preview.kbId) setKbPreview(null);
  }, [preview, currentKbId]);

  useEffect(() => {
    const before = lastKey.current;
    lastKey.current = key;
    if (before === key) return;
    const keepChat = takeKeepChat();
    const kbId = preview?.kbId ?? before?.split(':')[0];
    const { currentKb: open } = latest.current;
    if (!kbId || open?.id !== kbId) return;
    let cancelled = false;
    // Only the answer for the topic still open counts: a late one must not
    // replace a topic opened meanwhile.
    const stillOpen = () => !cancelled && latest.current.currentKb?.id === kbId;
    void axios.get<KnowledgeBase>(`${API_BASE_URL}/api/kb/${encodeURIComponent(kbId)}`).then((res) => {
      if (!stillOpen()) return;
      const row = res.data;
      const { setCurrentKb: set, newChat: fresh } = latest.current;
      set(preview ? { ...row, userId: null } : row);
      if (!keepChat) fresh();
    }).catch((err: unknown) => {
      if (!stillOpen()) return;
      console.error('Failed to load the topic preview:', err);
      const { currentKb: shown, setCurrentKb: set, toast: toasts, t: tr } = latest.current;
      toasts.error(tr('kbPreviewFailed'));
      if (preview) {
        // Starting or switching failed: end the preview, which reloads the
        // topic as the caller's own.
        setKbPreview(null);
      } else if (shown) {
        // Ending failed: requests are already the caller's own again, so the
        // topic must not stay marked as previewed. Its other fields keep the
        // previewed role's (lower) rights until the next reload.
        set({ ...shown, previewRole: undefined });
      }
    });
    return () => { cancelled = true; };
  }, [key, preview]);
}
