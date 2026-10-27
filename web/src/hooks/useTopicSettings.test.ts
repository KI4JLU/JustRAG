import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBrowserHistory, createMemoryHistory, type RouterHistory } from '@tanstack/react-router';
import { openTopicSettings, useTopicSettings } from './useTopicSettings';
import { bindUrlDialogHistory } from '../routing/urlDialog';

// Oracle: the acceptance rules for Thema-Einstellungen — open per topic, a
// topic change lands in the new topic's chat, „Teilen" on a card opens its
// topic directly on Mitglieder — plus the URL rules (`?topic=<section>`):
// opening pushes, switching replaces, closing removes it. Observed through
// the history the store is bound to, as the router's is in the app.
let history: RouterHistory;

function bindAt(url: string) {
  history = createMemoryHistory({ initialEntries: [url] });
  act(() => bindUrlDialogHistory(history));
}

beforeEach(() => bindAt('/kb/a'));

const setup = (onTopic = true) =>
  renderHook(({ on }) => useTopicSettings(on), { initialProps: { on: onTopic } });

describe('useTopicSettings', () => {
  it('opens on Verhalten from the gear, in the URL, and closes again', () => {
    const { result } = setup();
    expect(result.current.open).toBe(false);
    act(() => result.current.setOpen(true));
    expect(result.current).toMatchObject({ open: true, section: 'behavior' });
    expect(history.location.search).toBe('?topic=behavior');
    act(() => result.current.setOpen(false));
    expect(result.current.open).toBe(false);
    expect(history.location.href).toBe('/kb/a');
  });

  it('switches sections without a history entry of its own', () => {
    const { result } = setup();
    act(() => result.current.setOpen(true));
    const length = history.length;
    act(() => result.current.setSection('roles'));
    expect(result.current.section).toBe('roles');
    expect(history.location.search).toBe('?topic=roles');
    expect(history.length).toBe(length);
  });

  it('closes when the topic changes', () => {
    const { result } = setup();
    act(() => result.current.setOpen(true));
    act(() => history.push('/kb/b'));
    expect(result.current.open).toBe(false);
  });

  it('opens a topic directly on Mitglieder (Teilen): the topic first, then its settings', () => {
    bindAt('/');
    const { result } = setup();
    act(() => {
      history.push('/kb/b');
      openTopicSettings('members');
    });
    expect(history.location.href).toBe('/kb/b?topic=members');
    expect(result.current).toMatchObject({ open: true, section: 'members' });
  });

  // The router's BROWSER history batches pushes made in one tick into one
  // pushState; a memory history does not, so this case needs the real one.
  it('gives Teilen two history entries on a batching browser history: back closes the settings first', async () => {
    window.history.replaceState(null, '', '/');
    const browser = createBrowserHistory();
    act(() => bindUrlDialogHistory(browser));
    const { result } = setup();
    const before = window.history.length;
    act(() => {
      browser.push('/kb/b'); // the router's navigation, still queued
      openTopicSettings('members');
    });
    expect(window.location.pathname + window.location.search).toBe('/kb/b?topic=members');
    expect(window.history.length).toBe(before + 2);

    // Closing goes back to the topic, not past it.
    const popped = new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
    act(() => result.current.setOpen(false));
    await popped;
    expect(window.location.pathname + window.location.search).toBe('/kb/b');
    browser.destroy();
  });

  it('is never open on a page that is not a topic, whatever the URL says', () => {
    bindAt('/shared?topic=members');
    const { result } = setup(false);
    expect(result.current.open).toBe(false);
  });
});
