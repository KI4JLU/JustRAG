import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { POST_LOGIN_PATH_KEY, isAppPath, parkPostLoginPath, takePostLoginPath } from './postLoginPath';

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

describe('postLoginPath', () => {
  it('parks a path once and hands it back once', () => {
    parkPostLoginPath('/kb/abc?x=1');
    expect(takePostLoginPath()).toBe('/kb/abc?x=1');
    expect(takePostLoginPath()).toBeNull();
  });

  it('parks nothing for "/" and clears an older path', () => {
    parkPostLoginPath('/shared');
    parkPostLoginPath('/');
    expect(sessionStorage.getItem(POST_LOGIN_PATH_KEY)).toBeNull();
  });

  // Oracle: the open-redirect shapes — a protocol-relative URL leaves the
  // origin, an absolute URL names another host, /api/ is not a page.
  it('accepts in-app paths only', () => {
    expect(isAppPath('/kb/abc')).toBe(true);
    expect(isAppPath('//evil.example/x')).toBe(false);
    expect(isAppPath('https://evil.example/')).toBe(false);
    expect(isAppPath('/api/auth/logout')).toBe(false);
  });

  it('ignores a stored value that is not an in-app path', () => {
    sessionStorage.setItem(POST_LOGIN_PATH_KEY, '//evil.example/x');
    expect(takePostLoginPath()).toBeNull();
  });
});
