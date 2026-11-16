import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSharedStoredChoice } from './useStoredFlag';

const WIDTHS = ['comfortable', 'wide', 'full'] as const;

describe('useSharedStoredChoice', () => {
  // An in-memory Storage: jsdom's own is unreliable on newer Node versions.
  let stored: Map<string, string>;
  beforeEach(() => {
    stored = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => { stored.set(k, v); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts at the fallback, and a set reaches every user of the key and the storage', () => {
    const a = renderHook(() => useSharedStoredChoice('justrag.test.choice.a', WIDTHS, 'comfortable'));
    const b = renderHook(() => useSharedStoredChoice('justrag.test.choice.a', WIDTHS, 'comfortable'));
    expect(a.result.current[0]).toBe('comfortable');
    act(() => a.result.current[1]('wide'));
    expect(a.result.current[0]).toBe('wide');
    expect(b.result.current[0]).toBe('wide');
    expect(stored.get('justrag.test.choice.a')).toBe('wide');
  });

  it('reads a stored value, and the fallback for one that is not an option', () => {
    stored.set('justrag.test.choice.b', 'full');
    stored.set('justrag.test.choice.c', 'huge');
    expect(renderHook(() => useSharedStoredChoice('justrag.test.choice.b', WIDTHS, 'comfortable')).result.current[0]).toBe('full');
    expect(renderHook(() => useSharedStoredChoice('justrag.test.choice.c', WIDTHS, 'comfortable')).result.current[0]).toBe('comfortable');
  });
});
