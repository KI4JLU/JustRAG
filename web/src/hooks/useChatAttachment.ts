import { useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { userErrorMessage } from '../utils/userErrors';

export interface ChatAttachment {
  attachmentId: string;
  filename: string;
  sectionCount: number;
  charCount: number;
}

/** The translator from `useTheme()`; upload errors are localized with it. */
type Translator = (key: string) => string;

/**
 * Manages uploading a single comparison attachment to
 * `POST /api/kb/{kbId}/chat/attachment` (multipart, field `file`) plus the
 * resulting attachment state for a given KB.
 *
 * Auth is handled globally by axios (`axios.defaults.headers.common.Authorization`
 * set in App.tsx), matching the rest of the file-upload hooks.
 */
export function useChatAttachment(kbId: string, t: Translator, locale = 'de') {
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mirrors `error`, but readable synchronously right after `await upload()`
  // resolves — a caller in the same tick (e.g. `startComparison`) still holds
  // the pre-upload closure, so the `error` *state* it captured is always
  // stale until the next render. Refs don't have that lag.
  const errorRef = useRef<string | null>(null);

  const upload = useCallback(async (file: File): Promise<ChatAttachment | null> => {
    setUploading(true);
    setError(null);
    errorRef.current = null;
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await axios.post<ChatAttachment>(
        `${API_BASE_URL}/api/kb/${kbId}/chat/attachment`,
        fd,
      );
      setAttachment(res.data);
      return res.data;
    } catch (err: unknown) {
      // 503 is this endpoint's "comparison is switched off", not an outage.
      const msg = axios.isAxiosError(err) && err.response?.status === 503
        ? t('comparisonDisabled')
        : userErrorMessage(err, t, { name: file.name, fallbackKey: 'errorUploadFailed', locale });
      console.error('Attachment upload failed:', err);
      setError(msg);
      errorRef.current = msg;
      return null;
    } finally {
      setUploading(false);
    }
  }, [kbId, t, locale]);

  const clear = useCallback(() => {
    setAttachment(null);
    setError(null);
    errorRef.current = null;
  }, []);

  // Re-establishes `attachment` state from a result `upload()` already
  // returned, without re-uploading. Needed because `startComparison`
  // (useChat.ts) calls `handleNewChat()` — which must clear any attachment
  // left over from the PREVIOUS chat — between uploading and sending the
  // comparison turn; `adopt` restores the state that clear just wiped so
  // follow-up turns in the new chat still carry the attachment id.
  const adopt = useCallback((att: ChatAttachment) => {
    setAttachment(att);
    setError(null);
    errorRef.current = null;
  }, []);

  return { attachment, uploading, error, errorRef, upload, clear, adopt };
}
