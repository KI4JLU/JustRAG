import { describe, it, expect, vi, afterEach } from 'vitest';
import axios, { AxiosError, type AxiosResponse } from 'axios';
import {
  ChatAttachmentUploadError,
  chatAttachmentErrorMessage,
  toMessageAttachments,
  uploadChatAttachment,
} from './chatAttachments';

// The translator echoes the key, so a test reads which message was chosen.
const t = (key: string) => `${key}:{name}`;

function axiosError(status: number, data: unknown): AxiosError {
  const err = new AxiosError('fail');
  err.response = { status, data } as AxiosResponse;
  return err;
}

describe('chatAttachmentErrorMessage', () => {
  // Oracle: the statuses API.md § Chat documents for the upload endpoint.
  it.each([
    [413, {}, 'chatAttachmentTooLarge:doc.pdf'],
    [413, { error: 'quota_exceeded' }, 'chatAttachmentQuotaExceeded:doc.pdf'],
    [415, {}, 'chatAttachmentUnsupported:doc.pdf'],
    [422, { error: 'too_large_for_context', tokens: 9, limit: 1 }, 'chatAttachmentTooLongForContext:doc.pdf'],
    [422, { error: 'the file contained no extractable text' }, 'chatAttachmentNoText:doc.pdf'],
    [429, {}, 'chatAttachmentRateLimited:{name}'],
  ])('maps %i %o to its message', (status, data, want) => {
    expect(chatAttachmentErrorMessage(axiosError(status, data), 'doc.pdf', t)).toBe(want);
  });

  it('falls back to the generic message without a response', () => {
    expect(chatAttachmentErrorMessage(new Error('offline'), 'doc.pdf', t)).toBe('chatAttachmentUploadFailed:doc.pdf');
  });
});

describe('uploadChatAttachment', () => {
  afterEach(() => vi.restoreAllMocks());

  const part = (name: string) => ({ type: 'file' as const, url: 'data:text/plain;base64,aGk=', mediaType: 'text/plain', filename: name });

  it('posts the file to the KB route and returns the server row', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValueOnce({ data: { id: 'a', name: 'a.txt', mime: 'text/plain', size: 2, tokens: 1 } });
    const got = await uploadChatAttachment('kb1', part('a.txt'), t);
    expect(got.id).toBe('a');
    expect(String(post.mock.calls[0][0])).toContain('/api/kb/kb1/chat/attachments');
    expect(toMessageAttachments([got])).toEqual([{ userFileId: 'a', name: 'a.txt', mime: 'text/plain', size: 2 }]);
  });

  it('rejects with the reason for that file', async () => {
    vi.spyOn(axios, 'post').mockRejectedValueOnce(axiosError(415, {}));
    await expect(uploadChatAttachment('kb1', part('x.bin'), t))
      .rejects.toEqual(new ChatAttachmentUploadError('chatAttachmentUnsupported:x.bin'));
  });
});
