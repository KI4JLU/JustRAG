import { describe, it, expect } from 'vitest';
import { shouldApplyAutomatically, MAX_DEFERRAL_MS } from './updatePolicy';

const T0 = 1_700_000_000_000;

describe('shouldApplyAutomatically', () => {
    it('does nothing when no update is pending', () => {
        expect(shouldApplyAutomatically(null, T0 + MAX_DEFERRAL_MS * 10, true)).toBe(false);
    });

    it('waits out the grace period', () => {
        expect(shouldApplyAutomatically(T0, T0, true)).toBe(false);
        expect(shouldApplyAutomatically(T0, T0 + MAX_DEFERRAL_MS - 1, true)).toBe(false);
    });

    it('never reloads a tab the user is looking at', () => {
        const wayPastDeadline = T0 + MAX_DEFERRAL_MS * 5;
        expect(shouldApplyAutomatically(T0, wayPastDeadline, false)).toBe(false);
    });

    it('applies once the grace period has passed and the tab is hidden', () => {
        expect(shouldApplyAutomatically(T0, T0 + MAX_DEFERRAL_MS, true)).toBe(true);
        expect(shouldApplyAutomatically(T0, T0 + MAX_DEFERRAL_MS + 1, true)).toBe(true);
    });
});
