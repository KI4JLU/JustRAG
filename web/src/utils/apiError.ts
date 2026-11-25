import axios from 'axios';

/**
 * Whether `err` is a 403 answer. A source list the caller may not see
 * (capabilities.seeSources off) answers 403; the UI shows no such list, so
 * that answer is an empty list, not an error to report.
 *
 * Messages for failed requests come from userErrorMessage
 * (utils/userErrors.ts), never from the response body.
 */
export function isForbidden(err: unknown): boolean {
    return axios.isAxiosError(err) && err.response?.status === 403;
}
