import axios from 'axios';

/**
 * User-facing error messages (requirement F-06b, list in
 * docs/user-error-messages.md). Every failed request the user can see goes
 * through userErrorMessage: it maps the backend's machine-readable `code`
 * (API.md § Error codes), else the HTTP status, to a translation key — never
 * to the backend's own `error` text, which is English and technical.
 */

type Translator = (key: string) => string;

/** What the UI knows about a failed request, independent of axios / fetch. */
export interface ErrorInfo {
  /** HTTP status; undefined when no response arrived (network failure). */
  status?: number;
  /** The backend's machine-readable error code, if any. */
  code?: string;
  /** The size limit of a `file_too_large` refusal. */
  limitBytes?: number;
}

/** Error code → translation key. Keys with `{name}` need the file name. */
const CODE_KEYS: Record<string, string> = {
  file_too_large: 'errorFileTooLarge',
  quota_exceeded: 'errorQuotaExceeded',
  kb_full: 'errorKbFull',
  unsupported_file_type: 'errorUnsupportedType',
  file_unreadable: 'errorFileUnreadable',
  no_text: 'errorNoText',
  empty_file: 'errorEmptyFile',
  file_name_too_long: 'errorFileNameTooLong',
  parse_timeout: 'errorParseTimeout',
  already_in_kb: 'errorAlreadyInKb',
  too_large_for_context: 'errorTooLongForContext',
  invalid_upload: 'errorUploadFailed',
};

/** Codes that say something about one file the user attached or uploaded. */
const FILE_CODES = new Set([
  'file_too_large', 'unsupported_file_type', 'file_unreadable', 'no_text',
  'empty_file', 'file_name_too_long', 'parse_timeout', 'too_large_for_context',
]);

/** Whether `code` refuses one file (as opposed to the request or the user). */
export function isFileErrorCode(code: string | undefined): boolean {
  return code !== undefined && FILE_CODES.has(code);
}

/**
 * The ErrorInfo of a response body. `code` wins; a body from before the
 * backend sent `code` still carries the older codes (`quota_exceeded`,
 * `already_in_kb`, `too_large_for_context`) in `error`.
 */
export function errorInfoFromBody(status: number | undefined, body: unknown): ErrorInfo {
  const info: ErrorInfo = { status };
  if (body && typeof body === 'object') {
    const b = body as { code?: unknown; error?: unknown; limitBytes?: unknown };
    if (typeof b.code === 'string' && b.code) info.code = b.code;
    else if (typeof b.error === 'string' && b.error in CODE_KEYS) info.code = b.error;
    if (typeof b.limitBytes === 'number' && b.limitBytes > 0) info.limitBytes = b.limitBytes;
  }
  return info;
}

/**
 * The ErrorInfo of a thrown error. An axios error without a response and a
 * fetch TypeError are network failures (no status); any other error happened
 * in the client and gets status 0, which maps to the caller's fallback.
 */
export function errorInfo(err: unknown): ErrorInfo {
  if (axios.isAxiosError(err)) {
    return err.response ? errorInfoFromBody(err.response.status, err.response.data) : {};
  }
  if (err instanceof TypeError) return {};
  return { status: 0 };
}

/** The translation key for info; fallbackKey when nothing more specific fits. */
export function userErrorKey(info: ErrorInfo, fallbackKey = 'errorUnexpected'): string {
  if (info.code && CODE_KEYS[info.code]) {
    if (info.code === 'file_too_large' && info.limitBytes) return 'errorFileTooLargeLimit';
    return CODE_KEYS[info.code];
  }
  const { status } = info;
  if (status === undefined) return 'errorServiceUnavailable';
  if (status === 403) return 'errorForbidden';
  if (status === 413) return 'errorFileTooLarge';
  if (status === 415) return 'errorUnsupportedType';
  if (status === 429) return 'errorRateLimited';
  if (status === 502 || status === 503 || status === 504) return 'errorServiceUnavailable';
  if (status >= 500) return 'errorUnexpected';
  // 400, 404, 409 without a code, 422 without a code, 0 (client-side).
  return fallbackKey;
}

/** Bytes as "500 MB" / "1,5 GB" in the UI language's number format. */
export function formatLimit(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  return `${n} ${units[unit]}`;
}

export interface UserErrorOptions {
  /** The file the request was about; messages naming a file need it. */
  name?: string;
  /** Key for a refusal nothing more specific covers (a 400, a 404, …). */
  fallbackKey?: string;
  /** Locale for the size limit, e.g. 'de'. */
  locale?: string;
}

/**
 * The localized message for a failed request: err is a thrown axios error or
 * an ErrorInfo built from a fetch response. A message that names a file is
 * used only when `name` is given; otherwise fallbackKey applies.
 */
export function userErrorMessage(err: unknown, t: Translator, opts: UserErrorOptions = {}): string {
  const info = isErrorInfo(err) ? err : errorInfo(err);
  const fallbackKey = opts.fallbackKey ?? 'errorUnexpected';
  let text = t(userErrorKey(info, fallbackKey));
  if (text.includes('{name}')) {
    if (opts.name === undefined) {
      text = t(fallbackKey);
      if (text.includes('{name}')) return t('errorUnexpected');
      return text;
    }
    text = text.replace('{name}', opts.name);
  }
  if (text.includes('{limit}') && info.limitBytes) {
    text = text.replace('{limit}', formatLimit(info.limitBytes, opts.locale ?? 'de'));
  }
  return text;
}

function isErrorInfo(v: unknown): v is ErrorInfo {
  return !!v && typeof v === 'object' && !(v instanceof Error)
    && ('status' in v || 'code' in v || 'limitBytes' in v);
}

/**
 * One toast for a batch upload: the first failed file's message, plus how
 * many more files failed. failures must not be empty.
 */
export function uploadFailureMessage(failures: { name: string; err: unknown }[], t: Translator, locale = 'de'): string {
  const first = userErrorMessage(failures[0].err, t, { name: failures[0].name, fallbackKey: 'errorUploadFailed', locale });
  if (failures.length === 1) return first;
  return `${first} ${t('uploadFailedMore').replace('{count}', String(failures.length - 1))}`;
}
