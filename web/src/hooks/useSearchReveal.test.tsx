import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSearchReveal, useSearchRevealForm } from './useSearchReveal';

// Oracle: the calls the hooks make, against the rules in their doc comments.
describe('useSearchReveal', () => {
    it('opens on a target, follows a new one, and closes what it opened', () => {
        const open = vi.fn(), close = vi.fn();
        const { rerender } = renderHook(({ target, isOpen }) => useSearchReveal(target, isOpen, open, close), {
            initialProps: { target: null as string | null, isOpen: false },
        });
        rerender({ target: 'oidc', isOpen: false });
        expect(open).toHaveBeenLastCalledWith('oidc');
        rerender({ target: 'ldap', isOpen: true });
        expect(open).toHaveBeenLastCalledWith('ldap');
        rerender({ target: null, isOpen: true });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('leaves a part the user had open alone', () => {
        const open = vi.fn(), close = vi.fn();
        const { rerender } = renderHook(({ target }) => useSearchReveal(target, true, open, close), {
            initialProps: { target: null as string | null },
        });
        rerender({ target: 'on' });
        rerender({ target: null });
        expect(open).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
    });
});

describe('useSearchRevealForm', () => {
    it('keeps a form the user typed into: no switch, no close', () => {
        const open = vi.fn(), close = vi.fn();
        const { rerender } = renderHook(({ target, shown, data }) => useSearchRevealForm(target, shown, data, open, close), {
            initialProps: { target: null as string | null, shown: false, data: { url: '' } },
        });
        rerender({ target: 'ldap', shown: false, data: { url: '' } });
        expect(open).toHaveBeenCalledTimes(1);
        // The parent opened the form; the user then types into it.
        rerender({ target: 'ldap', shown: true, data: { url: '' } });
        rerender({ target: 'ldap', shown: true, data: { url: 'ldaps://typed' } });
        rerender({ target: 'oidc', shown: true, data: { url: 'ldaps://typed' } });
        rerender({ target: null, shown: true, data: { url: 'ldaps://typed' } });
        expect(open).toHaveBeenCalledTimes(1);
        expect(close).not.toHaveBeenCalled();
    });

    it('follows the query and closes an untouched form it opened', () => {
        const open = vi.fn(), close = vi.fn();
        const { rerender } = renderHook(({ target, shown, data }) => useSearchRevealForm(target, shown, data, open, close), {
            initialProps: { target: null as string | null, shown: false, data: { type: 'ldap' } },
        });
        rerender({ target: 'oidc', shown: false, data: { type: 'ldap' } });
        expect(open).toHaveBeenLastCalledWith('oidc');
        rerender({ target: 'oidc', shown: true, data: { type: 'oidc' } });
        rerender({ target: 'ldap', shown: true, data: { type: 'oidc' } });
        expect(open).toHaveBeenLastCalledWith('ldap');
        rerender({ target: 'ldap', shown: true, data: { type: 'ldap' } });
        rerender({ target: null, shown: true, data: { type: 'ldap' } });
        expect(close).toHaveBeenCalledTimes(1);
    });
});
