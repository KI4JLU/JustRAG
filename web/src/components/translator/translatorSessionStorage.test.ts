import { beforeEach, describe, expect, it } from 'vitest';
import { clearStoredSession, readStoredSession, SESSION_KEY } from './translatorSessionStorage';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  key(i: number) {
    return Array.from(this.data.keys())[i] ?? null;
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

/*
 * The tab's stored translator session belongs to the user who made it: the next person at the
 * tab must not find that user's text (privacy), and signing out forgets it.
 */
describe('the stored translator session', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('is handed to its own user', () => {
    const stored = JSON.stringify({ userId: 'u1', translate: { source: 'Mein Text' } });
    storage.setItem(SESSION_KEY, stored);
    expect(readStoredSession(storage, 'u1')).toBe(stored);
    expect(storage.getItem(SESSION_KEY)).toBe(stored);
  });

  it('ignores and deletes the session of another user', () => {
    storage.setItem(SESSION_KEY, JSON.stringify({ userId: 'u1', translate: { source: 'Vertraulich' } }));
    expect(readStoredSession(storage, 'u2')).toBeNull();
    expect(storage.getItem(SESSION_KEY)).toBeNull();
  });

  it('ignores and deletes a session with no owner or no readable content', () => {
    storage.setItem(SESSION_KEY, JSON.stringify({ translate: { source: 'Von früher' } }));
    expect(readStoredSession(storage, 'u1')).toBeNull();
    expect(storage.getItem(SESSION_KEY)).toBeNull();
    storage.setItem(SESSION_KEY, 'not json');
    expect(readStoredSession(storage, 'u1')).toBeNull();
    expect(storage.getItem(SESSION_KEY)).toBeNull();
  });

  it('is never handed to a user without an id', () => {
    storage.setItem(SESSION_KEY, JSON.stringify({ userId: '', translate: { source: 'x' } }));
    expect(readStoredSession(storage, '')).toBeNull();
  });

  it('is empty where there is nothing, or no storage', () => {
    expect(readStoredSession(storage, 'u1')).toBeNull();
    expect(readStoredSession(null, 'u1')).toBeNull();
  });

  it('is forgotten on sign-out', () => {
    storage.setItem(SESSION_KEY, JSON.stringify({ userId: 'u1' }));
    clearStoredSession(storage);
    expect(storage.getItem(SESSION_KEY)).toBeNull();
    expect(() => clearStoredSession(null)).not.toThrow();
  });
});
