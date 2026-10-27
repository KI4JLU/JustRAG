import { useCallback, useEffect, useRef, useState } from 'react';
import { usePromptInputAttachments } from '@ki4jlu/design-system';
import {
  ChatAttachmentUploadError,
  uploadChatAttachment,
  type ComposerFile,
  type UploadedChatAttachment,
} from '../utils/chatAttachments';

/** Where one composer chip's upload stands. */
export type ComposerUpload =
  | { status: 'uploading' }
  | { status: 'done'; uploaded: UploadedChatAttachment }
  | { status: 'error'; message: string };

type Translator = (key: string) => string;

/** A composer file as PromptInput's attachment context holds it. */
type ChipFile = ComposerFile & { id: string };

interface Uploads {
  /** Chip ids in attach order. */
  ids: string[];
  byId: Record<string, ComposerUpload>;
}

/**
 * Chat attachments are uploaded as soon as they are attached, so a file the
 * chat cannot use shows its reason on its chip before the message is sent.
 * `sync` takes the composer's current files (ComposerUploadSync passes them
 * in from inside PromptInput): new chips start uploading, removed chips are
 * forgotten (a late result for one is ignored; the server sweeps the
 * unattached file after a day).
 */
export function useComposerUploads(kbId: string | undefined, t: Translator, locale = 'de') {
  const [uploads, setUploads] = useState<Uploads>({ ids: [], byId: {} });
  // Read synchronously by the submit handler, which runs before a re-render.
  const uploadsRef = useRef(uploads);
  const kbIdRef = useRef(kbId);
  const tRef = useRef(t);
  const localeRef = useRef(locale);
  useEffect(() => { kbIdRef.current = kbId; tRef.current = t; localeRef.current = locale; }, [kbId, t, locale]);

  const update = useCallback((fn: (prev: Uploads) => Uploads) => {
    setUploads(prev => {
      const next = fn(prev);
      uploadsRef.current = next;
      return next;
    });
  }, []);

  const start = useCallback((file: ChipFile) => {
    const kb = kbIdRef.current;
    if (!kb) return;
    uploadChatAttachment(kb, file, tRef.current, localeRef.current).then(
      uploaded => update(prev => (prev.byId[file.id]
        ? { ...prev, byId: { ...prev.byId, [file.id]: { status: 'done', uploaded } } }
        : prev)),
      (err: unknown) => update(prev => (prev.byId[file.id]
        ? {
          ...prev,
          byId: {
            ...prev.byId,
            [file.id]: {
              status: 'error',
              message: err instanceof ChatAttachmentUploadError
                ? err.message
                : tRef.current('errorUploadFailed').replace('{name}', file.filename || 'attachment'),
            },
          },
        }
        : prev)),
    );
  }, [update]);

  const sync = useCallback((files: ChipFile[]) => {
    const current = uploadsRef.current;
    const ids = files.map(f => f.id);
    const added = files.filter(f => !current.byId[f.id]);
    const unchanged = added.length === 0 && ids.length === current.ids.length && ids.every((id, i) => id === current.ids[i]);
    if (unchanged) return;
    update(prev => {
      const byId: Record<string, ComposerUpload> = {};
      for (const id of ids) {
        byId[id] = prev.byId[id] ?? { status: 'uploading' };
      }
      return { ids, byId };
    });
    added.forEach(start);
  }, [start, update]);

  /** The state a submit has to respect: still uploading, failed, or ready. */
  const readiness = useCallback(() => {
    const { ids, byId } = uploadsRef.current;
    const states = ids.map(id => byId[id]);
    return {
      uploading: states.some(s => s?.status === 'uploading'),
      failed: states.some(s => s?.status === 'error'),
      uploaded: states.flatMap(s => (s?.status === 'done' ? [s.uploaded] : [])),
    };
  }, []);

  return { uploads: uploads.byId, sync, readiness };
}

/** Feeds PromptInput's current files into useComposerUploads.sync. Render it inside PromptInput. */
export function ComposerUploadSync({ onFiles }: { onFiles: (files: ChipFile[]) => void }) {
  const { files } = usePromptInputAttachments();
  useEffect(() => { onFiles(files); }, [files, onFiles]);
  return null;
}
