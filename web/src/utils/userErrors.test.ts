import { describe, it, expect } from 'vitest';
import { AxiosError, type AxiosResponse } from 'axios';
import {
  errorInfo,
  errorInfoFromBody,
  formatLimit,
  isFileErrorCode,
  uploadFailureMessage,
  userErrorKey,
  userErrorMessage,
} from './userErrors';
import { translations } from '../translations';

// Oracle: the error-case list in docs/user-error-messages.md and the codes in
// API.md § Error codes.

function axiosError(status: number | undefined, data?: unknown): AxiosError {
  const err = new AxiosError('fail');
  if (status !== undefined) err.response = { status, data } as AxiosResponse;
  return err;
}

describe('userErrorKey', () => {
  it.each([
    ['file_too_large', 'errorFileTooLarge'],
    ['quota_exceeded', 'errorQuotaExceeded'],
    ['kb_full', 'errorKbFull'],
    ['unsupported_file_type', 'errorUnsupportedType'],
    ['file_unreadable', 'errorFileUnreadable'],
    ['no_text', 'errorNoText'],
    ['empty_file', 'errorEmptyFile'],
    ['file_name_too_long', 'errorFileNameTooLong'],
    ['parse_timeout', 'errorParseTimeout'],
    ['already_in_kb', 'errorAlreadyInKb'],
    ['too_large_for_context', 'errorTooLongForContext'],
    ['invalid_upload', 'errorUploadFailed'],
  ])('maps code %s to %s, whatever the status', (code, key) => {
    expect(userErrorKey({ status: 400, code })).toBe(key);
  });

  it('names the limit when a size refusal carries one', () => {
    expect(userErrorKey({ status: 413, code: 'file_too_large', limitBytes: 1024 })).toBe('errorFileTooLargeLimit');
  });

  it.each([
    [undefined, 'errorServiceUnavailable'],
    [403, 'errorForbidden'],
    [413, 'errorFileTooLarge'],
    [415, 'errorUnsupportedType'],
    [429, 'errorRateLimited'],
    [502, 'errorServiceUnavailable'],
    [503, 'errorServiceUnavailable'],
    [504, 'errorServiceUnavailable'],
    [500, 'errorUnexpected'],
    [400, 'fallback'],
    [404, 'fallback'],
    [422, 'fallback'],
    [0, 'fallback'],
  ])('maps status %s without a code to %s', (status, key) => {
    expect(userErrorKey({ status }, 'fallback')).toBe(key);
  });

  it('ignores an unknown code and falls back to the status', () => {
    expect(userErrorKey({ status: 429, code: 'something_new' })).toBe('errorRateLimited');
  });
});

describe('errorInfoFromBody / errorInfo', () => {
  it('prefers code, reads limitBytes', () => {
    expect(errorInfoFromBody(413, { error: 'File too large', code: 'file_too_large', limitBytes: 5 }))
      .toEqual({ status: 413, code: 'file_too_large', limitBytes: 5 });
  });

  it('reads the older codes carried in error', () => {
    expect(errorInfoFromBody(409, { error: 'already_in_kb' }).code).toBe('already_in_kb');
  });

  it('never treats free text in error as a code', () => {
    expect(errorInfoFromBody(400, { error: 'Knowledge base has reached the 500 MB storage limit' }).code).toBeUndefined();
  });

  it('tells a network failure (no status) from a client-side error (status 0)', () => {
    expect(errorInfo(axiosError(undefined))).toEqual({});
    expect(errorInfo(new TypeError('Failed to fetch'))).toEqual({});
    expect(errorInfo(new Error('bug'))).toEqual({ status: 0 });
  });
});

describe('userErrorMessage', () => {
  const tr = (key: string) => translations[key as keyof typeof translations].en;

  it('fills in the file name and a localized limit', () => {
    const err = axiosError(413, { code: 'file_too_large', limitBytes: 500 * 1024 * 1024 });
    expect(userErrorMessage(err, tr, { name: 'big.pdf', locale: 'en' })).toBe('“big.pdf” is too large (maximum 500 MB).');
  });

  it('uses the fallback when a file message has no file name to name', () => {
    expect(userErrorMessage({ status: 422, code: 'file_unreadable' }, tr, { fallbackKey: 'chatSendError' })).toBe('Error sending message');
  });

  it('never returns the backend text', () => {
    const err = axiosError(400, { error: 'Invalid multipart form' });
    expect(userErrorMessage(err, tr, { name: 'a.pdf', fallbackKey: 'errorUploadFailed' })).toBe('Could not upload “a.pdf”.');
  });
});

describe('uploadFailureMessage', () => {
  it('shows the first failure and counts the rest', () => {
    const msg = uploadFailureMessage([
      { name: 'a.pdf', err: axiosError(409, { error: 'already_in_kb', code: 'already_in_kb' }) },
      { name: 'b.pdf', err: axiosError(500) },
      { name: 'c.pdf', err: axiosError(500) },
    ], (k: string) => translations[k as keyof typeof translations].de, 'de');
    expect(msg).toBe('„a.pdf“ ist bereits in diesem Thema. 2 weitere Dateien konnten ebenfalls nicht hochgeladen werden.');
  });
});

describe('formatLimit', () => {
  it.each([
    [1024, 'en', '1 KB'],
    [500 * 1024 * 1024, 'de', '500 MB'],
    [1.5 * 1024 * 1024 * 1024, 'de', '1,5 GB'],
    [1.5 * 1024 * 1024 * 1024, 'en', '1.5 GB'],
  ])('formats %d in %s as %s', (bytes, locale, want) => {
    expect(formatLimit(bytes, locale)).toBe(want);
  });
});

describe('isFileErrorCode', () => {
  it('is true for refusals of one file only', () => {
    expect(isFileErrorCode('file_unreadable')).toBe(true);
    expect(isFileErrorCode('quota_exceeded')).toBe(false);
    expect(isFileErrorCode(undefined)).toBe(false);
  });
});

describe('translations', () => {
  it('has a DE and EN text for every key userErrorKey can return', () => {
    const keys = [
      'errorFileTooLarge', 'errorFileTooLargeLimit', 'errorQuotaExceeded', 'errorKbFull', 'errorUnsupportedType',
      'errorFileUnreadable', 'errorNoText', 'errorEmptyFile', 'errorFileNameTooLong', 'errorParseTimeout',
      'errorAlreadyInKb', 'errorTooLongForContext', 'errorUploadFailed', 'errorForbidden', 'errorRateLimited',
      'errorServiceUnavailable', 'errorUnexpected', 'errorAnswerTimeout', 'errorAnswerFailed', 'chatAttachmentsUnusable',
    ];
    for (const k of keys) {
      const entry = translations[k as keyof typeof translations];
      expect(entry?.de, k).toBeTruthy();
      expect(entry?.en, k).toBeTruthy();
    }
  });
});
