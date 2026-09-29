import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatDate, formatRelative, formatRelativeCoarse } from './dates';

describe('formatDate', () => {
    it('formats an ISO date for German', () => {
        expect(formatDate('2026-01-05T00:00:00Z', 'de')).toBe('05.01.2026');
    });

    it('formats an ISO date for English', () => {
        expect(formatDate('2026-01-05T00:00:00Z', 'en')).toBe('01/05/2026');
    });

    it('returns the em-dash placeholder for undefined', () => {
        expect(formatDate(undefined, 'de')).toBe('—');
        expect(formatDate(undefined, 'en')).toBe('—');
    });

    it('returns the em-dash placeholder for an invalid date string', () => {
        expect(formatDate('not-a-date', 'de')).toBe('—');
        expect(formatDate('not-a-date', 'en')).toBe('—');
    });
});

describe('formatRelative', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-06T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('formats a past hour in German', () => {
        expect(formatRelative('2026-09-06T10:00:00Z', 'de')).toBe('vor 2 Stunden');
    });

    it('formats a past hour in English', () => {
        expect(formatRelative('2026-09-06T10:00:00Z', 'en')).toBe('2 hours ago');
    });

    it('formats a past day in German', () => {
        expect(formatRelative('2026-09-03T12:00:00Z', 'de')).toBe('vor 3 Tagen');
    });

    it('formats a past day in English', () => {
        expect(formatRelative('2026-09-03T12:00:00Z', 'en')).toBe('3 days ago');
    });

    it('returns the em-dash placeholder for undefined', () => {
        expect(formatRelative(undefined, 'de')).toBe('—');
        expect(formatRelative(undefined, 'en')).toBe('—');
    });

    it('returns the em-dash placeholder for an invalid date string', () => {
        expect(formatRelative('not-a-date', 'de')).toBe('—');
        expect(formatRelative('not-a-date', 'en')).toBe('—');
    });
});

/*
 * formatRelativeCoarse (card KI-848). ORACLE: the expected strings are written
 * out by hand — CLDR's German and English relative-time phrases as ICU renders
 * them (`numeric: 'auto'` → „gestern" / „yesterday") — against a FIXED clock,
 * so the unit boundaries of the rule in dates.ts are what is being checked.
 */
describe('formatRelativeCoarse', () => {
    const NOW = new Date('2026-09-29T12:00:00Z');
    const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
    beforeEach(() => { vi.useFakeTimers({ now: NOW }); });
    afterEach(() => { vi.useRealTimers(); });

    it.each([
        ['30 seconds', 30_000, 'jetzt', 'now'],
        ['5 minutes', 5 * MIN, 'vor 5 Minuten', '5 minutes ago'],
        ['59.9 minutes (floored)', 59.9 * MIN, 'vor 59 Minuten', '59 minutes ago'],
        ['3 hours', 3 * HOUR, 'vor 3 Stunden', '3 hours ago'],
        ['1 day', DAY, 'gestern', 'yesterday'],
        ['7 days', 7 * DAY, 'vor 7 Tagen', '7 days ago'],
        ['29 days', 29 * DAY, 'vor 29 Tagen', '29 days ago'],
        ['61 days', 61 * DAY, 'vor 2 Monaten', '2 months ago'],
        ['400 days', 400 * DAY, 'letztes Jahr', 'last year'],
        ['3 years', 3 * 365.25 * DAY, 'vor 3 Jahren', '3 years ago'],
    ])('%s ago', (_label, ms, de, en) => {
        expect(formatRelativeCoarse(ago(ms), 'de')).toBe(de);
        expect(formatRelativeCoarse(ago(ms), 'en')).toBe(en);
    });

    it('reads a future timestamp (clock skew) as now', () => {
        expect(formatRelativeCoarse(new Date(NOW.getTime() + 5 * MIN).toISOString(), 'de')).toBe('jetzt');
    });

    it('returns the em-dash placeholder for undefined or invalid input', () => {
        expect(formatRelativeCoarse(undefined, 'de')).toBe('—');
        expect(formatRelativeCoarse('not-a-date', 'en')).toBe('—');
    });
});
