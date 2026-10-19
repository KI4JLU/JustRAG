import axios from 'axios';
import type { PromptInputMessage } from '@ki4jlu/design-system';
import { API_BASE_URL } from '../api';
import { getApiErrorMessage } from './apiError';
import type { MessageAttachment } from '../types';

/**
 * Chat attachments as context (backend: POST /api/kb/{id}/chat/attachments,
 * API.md § Chat). Files attached in the composer are uploaded as soon as they
 * are attached (useComposerUploads); their ids go with the message as
 * `attachmentIds`.
 */

/** One file of the composer, as the design system's PromptInput hands it over. */
export type ComposerFile = PromptInputMessage['files'][number];

/** 201 body of the upload endpoint. */
export interface UploadedChatAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  tokens: number;
}

type Translator = (key: string) => string;

/** A failed upload, with a message ready to show for that file. */
export class ChatAttachmentUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatAttachmentUploadError';
  }
}

/**
 * The user-facing reason an upload of `name` failed (F-06b), from the
 * status and body the endpoint documents.
 */
export function chatAttachmentErrorMessage(err: unknown, name: string, t: Translator): string {
  const withName = (key: string) => t(key).replace('{name}', name);
  if (!axios.isAxiosError(err) || !err.response) {
    return withName('chatAttachmentUploadFailed');
  }
  const data = err.response.data as { error?: string; tokens?: number; limit?: number } | undefined;
  switch (err.response.status) {
    case 413:
      return data?.error === 'quota_exceeded' ? withName('chatAttachmentQuotaExceeded') : withName('chatAttachmentTooLarge');
    case 415:
      return withName('chatAttachmentUnsupported');
    case 422:
      if (data?.error === 'too_large_for_context') {
        return withName('chatAttachmentTooLongForContext');
      }
      return withName('chatAttachmentNoText');
    case 429:
      return t('chatAttachmentRateLimited');
    default:
      return getApiErrorMessage(err, withName('chatAttachmentUploadFailed'));
  }
}

/** Turns a composer file (a data or blob URL) back into a File to upload. */
async function partToFile(part: ComposerFile): Promise<File> {
  const blob = await (await fetch(part.url)).blob();
  return new File([blob], part.filename || 'attachment', { type: part.mediaType || blob.type });
}

/**
 * Uploads one composer file. Rejects with a ChatAttachmentUploadError whose
 * message says why the file was refused.
 */
export async function uploadChatAttachment(kbId: string, part: ComposerFile, t: Translator): Promise<UploadedChatAttachment> {
  const name = part.filename || 'attachment';
  try {
    const fd = new FormData();
    fd.append('file', await partToFile(part), name);
    const res = await axios.post<UploadedChatAttachment>(`${API_BASE_URL}/api/kb/${kbId}/chat/attachments`, fd);
    return res.data;
  } catch (err) {
    throw new ChatAttachmentUploadError(chatAttachmentErrorMessage(err, name, t));
  }
}

/** The chip data of a message for the uploaded files. */
export function toMessageAttachments(uploaded: UploadedChatAttachment[]): MessageAttachment[] {
  return uploaded.map(u => ({ userFileId: u.id, name: u.name, mime: u.mime, size: u.size }));
}
