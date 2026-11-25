import { describe, it, expect } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { isForbidden } from './apiError';

function makeAxiosError(status: number): AxiosError {
    const err = new AxiosError('Request failed');
    err.response = {
        data: { error: 'access denied' },
        status,
        statusText: '',
        headers: {},
        config: { headers: {} } as unknown as InternalAxiosRequestConfig,
    };
    return err;
}

// Oracle: the HTTP status of the axios response, nothing else.
describe('isForbidden', () => {
    it('is true for a 403 answer', () => {
        expect(isForbidden(makeAxiosError(403))).toBe(true);
    });

    it('is false for other statuses, a network failure and non-axios errors', () => {
        expect(isForbidden(makeAxiosError(401))).toBe(false);
        expect(isForbidden(makeAxiosError(404))).toBe(false);
        expect(isForbidden(new AxiosError('Network Error'))).toBe(false);
        expect(isForbidden(new Error('403'))).toBe(false);
    });
});
