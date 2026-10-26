import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
 * The admin dialog's open state is the URL (`?admin=<section>`), and hooks/adminDialog.ts is the
 * only file that touches it, so a router can replace that one file. ORACLES: the rules in the
 * card, one per test, observed through `window.location` and `window.history` (jsdom's real
 * history), never through the store's own state alone.
 */

type Store = typeof import('./adminDialog');

/** A fresh store reading the given URL, as on page load. */
async function load(url: string): Promise<Store> {
    window.history.replaceState(null, '', url);
    vi.resetModules();
    return import('./adminDialog');
}

/** Waits for the browser's own (asynchronous) traversal to land. */
const popped = () => new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));

beforeEach(() => {
    window.history.replaceState(null, '', '/');
});

describe('reading the URL', () => {
    it('is closed without the parameter, and leaves the URL alone', async () => {
        const store = await load('/topics?x=1');
        const { renderHook } = await import('@testing-library/react');
        const { result } = renderHook(() => store.useAdminDialog());
        expect(result.current.open).toBe(false);
        const length = window.history.length;
        store.setAdminDialogOpen(false); // closing a closed dialog changes nothing
        expect(window.history.length).toBe(length);
        expect(window.location.search).toBe('?x=1');
    });

    it.each([
        ['/?admin=agent', 'agent'],
        ['/?admin', 'configs'],
        ['/?admin=', 'configs'],
        ['/?admin=nonsense', 'configs'],
    ])('opens on the section %s names (%s), a bare or unknown value meaning the first', async (url, section) => {
        const store = await load(url);
        const { renderHook } = await import('@testing-library/react');
        const { result } = renderHook(() => store.useAdminDialog());
        expect(result.current).toEqual({ open: true, section });
    });

    it('re-reads the URL on popstate', async () => {
        const store = await load('/');
        const { renderHook, act } = await import('@testing-library/react');
        const { result } = renderHook(() => store.useAdminDialog());
        expect(result.current.open).toBe(false);

        window.history.replaceState(null, '', '/?admin=users');
        act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
        expect(result.current).toEqual({ open: true, section: 'users' });
    });
});

describe('opening', () => {
    it('pushes ?admin=<section> and keeps the path, the other parameters and the hash', async () => {
        const store = await load('/topics/42?x=1#frag');
        const before = window.history.length;
        store.openAdminDialog('agent');
        expect(window.location.pathname).toBe('/topics/42');
        expect(window.location.search).toBe('?x=1&admin=agent');
        expect(window.location.hash).toBe('#frag');
        expect(window.history.length).toBe(before + 1);
    });

    it('opens the first section by default', async () => {
        const store = await load('/');
        store.openAdminDialog();
        expect(window.location.search).toBe('?admin=configs');
    });

    it('does not push a second entry when it is already open: it switches', async () => {
        const store = await load('/');
        store.openAdminDialog('auth');
        const before = window.history.length;
        store.openAdminDialog('site');
        expect(window.history.length).toBe(before);
        expect(window.location.search).toBe('?admin=site');
    });

    it('lets the browser back button close it', async () => {
        const store = await load('/topics');
        const { renderHook, act } = await import('@testing-library/react');
        const { result } = renderHook(() => store.useAdminDialog());
        act(() => store.openAdminDialog('users'));
        expect(result.current.open).toBe(true);

        const done = popped();
        act(() => { window.history.back(); });
        await done;
        expect(window.location.search).toBe('');
        expect(result.current.open).toBe(false);
    });
});

describe('switching sections', () => {
    it('replaces the URL instead of pushing, so back closes the dialog in one step', async () => {
        const store = await load('/topics');
        const { renderHook, act } = await import('@testing-library/react');
        const { result } = renderHook(() => store.useAdminDialog());
        act(() => store.openAdminDialog('configs'));
        const length = window.history.length;

        act(() => store.setAdminDialogSection('auth'));
        act(() => store.setAdminDialogSection('users'));
        expect(window.history.length).toBe(length);
        expect(window.location.search).toBe('?admin=users');
        expect(result.current).toEqual({ open: true, section: 'users' });

        const done = popped();
        act(() => { window.history.back(); });
        await done;
        expect(window.location.search).toBe(''); // one step back, not three
        expect(result.current.open).toBe(false);
    });
});

describe('closing', () => {
    it('goes back one step when the dialog pushed the entry', async () => {
        const store = await load('/topics');
        const { renderHook, act } = await import('@testing-library/react');
        const { result } = renderHook(() => store.useAdminDialog());
        act(() => store.openAdminDialog('configs'));
        act(() => store.setAdminDialogSection('site')); // the marker survives a switch

        const done = popped();
        act(() => store.setAdminDialogOpen(false));
        expect(result.current.open).toBe(false); // at once, not after the browser
        await done;
        expect(window.location.pathname + window.location.search).toBe('/topics');
    });

    it('replaces the URL without the parameter when the entry came from a link', async () => {
        const store = await load('/topics?x=1&admin=health#h');
        const { renderHook, act } = await import('@testing-library/react');
        const { result } = renderHook(() => store.useAdminDialog());
        expect(result.current).toEqual({ open: true, section: 'health' });
        const length = window.history.length;

        act(() => store.setAdminDialogOpen(false));
        expect(window.history.length).toBe(length); // nothing pushed, nothing popped
        expect(window.location.pathname + window.location.search + window.location.hash).toBe('/topics?x=1#h');
        expect(result.current.open).toBe(false);
    });
});

describe('rights', () => {
    it('ignores and strips the parameter for a user who may not open it', async () => {
        const store = await load('/topics?x=1&admin=users');
        const { renderHook, act } = await import('@testing-library/react');
        const { result } = renderHook(() => store.useAdminDialog());
        const length = window.history.length;

        act(() => store.stripAdminDialog());
        expect(result.current.open).toBe(false);
        expect(window.location.search).toBe('?x=1');
        expect(window.history.length).toBe(length);
    });
});
