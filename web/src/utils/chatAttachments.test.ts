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
  // Oracle: the codes and statuses API.md § Chat documents for the upload
  // endpoint, and the error-case list in docs/user-error-messages.md.
  it.each([
    [413, { code: 'file_too_large' }, 'errorFileTooLarge:doc.pdf'],
    [413, { error: 'quota_exceeded', code: 'quota_exceeded' }, 'errorQuotaExceeded:doc.pdf'],
    [413, { error: 'quota_exceeded' }, 'errorQuotaExceeded:doc.pdf'],
    [415, { code: 'unsupported_file_type' }, 'errorUnsupportedType:doc.pdf'],
    [400, { error: 'File type not supported (.exe)', code: 'unsupported_file_type' }, 'errorUnsupportedType:doc.pdf'],
    [422, { code: 'file_unreadable' }, 'errorFileUnreadable:doc.pdf'],
    [422, { code: 'no_text' }, 'errorNoText:doc.pdf'],
    [422, { code: 'parse_timeout' }, 'errorParseTimeout:doc.pdf'],
    [422, { error: 'too_large_for_context', tokens: 9, limit: 1 }, 'errorTooLongForContext:doc.pdf'],
    [429, {}, 'errorRateLimited:doc.pdf'],
    [403, { error: 'forbidden' }, 'errorForbidden:doc.pdf'],
    [500, { error: 'internal' }, 'errorUnexpected:doc.pdf'],
  ])('maps %i %o to its message', (status, data, want) => {
    expect(chatAttachmentErrorMessage(axiosError(status, data), 'doc.pdf', t)).toBe(want);
  });

  it('never shows the backend text of an uncoded 400', () => {
    expect(chatAttachmentErrorMessage(axiosError(400, { error: 'raw backend text' }), 'doc.pdf', t)).toBe('errorUploadFailed:doc.pdf');
  });

  it('reports a network failure as the service being unreachable', () => {
    const err = new AxiosError('Network Error');
    expect(chatAttachmentErrorMessage(err, 'doc.pdf', t)).toBe('errorServiceUnavailable:doc.pdf');
  });

  it('falls back to the upload message for a client-side error', () => {
    expect(chatAttachmentErrorMessage(new Error('boom'), 'doc.pdf', t)).toBe('errorUploadFailed:doc.pdf');
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
      .rejects.toEqual(new ChatAttachmentUploadError('errorUnsupportedType:x.bin'));
  });
});
