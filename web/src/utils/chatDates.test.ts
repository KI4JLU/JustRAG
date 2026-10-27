import { describe, expect, it } from 'vitest';
import { formatDaySeparator, formatMessageTime, sameLocalDay } from './chatDates';

// Oracle: hand-written strings for local-time inputs (no Z, so the test
// does not depend on the runner's time zone).
describe('chatDates', () => {
    it('formats the day separator with weekday, date and time, the year only when it differs', () => {
        const now = new Date('2026-10-23T12:00:00');
        expect(formatDaySeparator('2026-10-07T11:47:00', 'de', now)).toBe('Mi., 7. Okt. um 11:47');
        expect(formatDaySeparator('2026-10-07T11:47:00', 'en', now)).toBe('Wed 7 Oct at 11:47');
        expect(formatDaySeparator('2025-10-07T11:47:00', 'de', now)).toBe('Di., 7. Okt. 2025 um 11:47');
    });

    it('formats the time of a question on the 24-hour clock', () => {
        expect(formatMessageTime('2026-10-07T09:05:00', 'de')).toBe('09:05');
        expect(formatMessageTime('2026-10-07T21:05:00', 'en')).toBe('21:05');
    });

    it('tells local calendar days apart', () => {
        expect(sameLocalDay('2026-10-07T00:10:00', '2026-10-07T23:50:00')).toBe(true);
        expect(sameLocalDay('2026-10-07T23:50:00', '2026-10-08T00:10:00')).toBe(false);
    });
});
