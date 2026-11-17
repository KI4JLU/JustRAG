import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { REAUTH_COOLDOWN_MS, startSsoReauth } from './sessionExpiry';
import { takePostLoginPath } from './postLoginPath';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    setItem: (k: string, v: string) => { data.set(k, v); },
  } as Storage;
}

beforeEach(() => { vi.stubGlobal('sessionStorage', memoryStorage()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('startSsoReauth', () => {
  it('starts a re-login and parks the page to return to', () => {
    expect(startSsoReauth('/kb/abc?x=1', 1_000_000)).toBe(true);
    expect(takePostLoginPath()).toBe('/kb/abc?x=1');
  });

  it('refuses a second one inside the cooldown and leaves the parked page alone', () => {
    expect(startSsoReauth('/kb/abc', 1_000_000)).toBe(true);
    expect(startSsoReauth('/c/other', 1_000_000 + REAUTH_COOLDOWN_MS - 1)).toBe(false);
    expect(takePostLoginPath()).toBe('/kb/abc');
  });

  it('starts again once the cooldown is over', () => {
    expect(startSsoReauth('/kb/abc', 1_000_000)).toBe(true);
    expect(startSsoReauth('/c/other', 1_000_000 + REAUTH_COOLDOWN_MS)).toBe(true);
    expect(takePostLoginPath()).toBe('/c/other');
  });

  it('starts nothing when the storage refuses the write', () => {
    const full = memoryStorage();
    full.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
    vi.stubGlobal('sessionStorage', full);
    expect(startSsoReauth('/kb/abc', 1_000_000)).toBe(false);
  });

  it('starts nothing when the storage refuses the read', () => {
    const broken = memoryStorage();
    broken.getItem = () => { throw new DOMException('denied', 'SecurityError'); };
    vi.stubGlobal('sessionStorage', broken);
    expect(startSsoReauth('/kb/abc', 1_000_000)).toBe(false);
  });

  it('starts nothing without sessionStorage: the loop guard could not hold', () => {
    vi.stubGlobal('sessionStorage', undefined);
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new Error('denied'); } });
    try {
      expect(startSsoReauth('/kb/abc', 1_000_000)).toBe(false);
    } finally {
      delete (window as unknown as Record<string, unknown>).sessionStorage;
    }
  });
});
