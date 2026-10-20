import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKbLifecycle } from './useKbLifecycle';

function setup() {
  const setShowSettings = vi.fn();
  const noop = () => {};
  renderHook(() => useKbLifecycle({
    token: null, currentKb: null,
    fetchKBs: noop, fetchAvailableConfigs: noop, fetchFiles: noop, fetchChats: noop,
    fetchGeneratedContent: noop, fetchRssFeeds: noop, fetchConfluenceSources: noop,
    fetchConfluenceConnectionInfo: noop,
    showSettings: true, setShowSettings,
  }));
  return { setShowSettings };
}

/** Dispatch Escape on window, optionally already handled (as an open Radix Select or menu does). */
function pressEscape(handled: boolean) {
  const e = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
  if (handled) e.preventDefault();
  window.dispatchEvent(e);
}

// ORACLE: the DOM's defaultPrevented flag — Radix layers call preventDefault()
// on the Escape that closes them, which is how a layer below knows to stay.
describe('useKbLifecycle Escape', () => {
  it('closes the settings modal on a plain Escape', () => {
    const { setShowSettings } = setup();
    pressEscape(false);
    expect(setShowSettings).toHaveBeenCalledWith(false);
  });

  it('leaves it open when something inside already handled the Escape', () => {
    const { setShowSettings } = setup();
    pressEscape(true);
    expect(setShowSettings).not.toHaveBeenCalled();
  });
});
