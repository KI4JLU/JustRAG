import { sessionStore } from '../../utils/sessionStore';

/** Where the page keeps its text and settings in the tab's `sessionStorage`. */
export const SESSION_KEY = 'jlurag.translator.session';

/** The id of the user a stored session belongs to, `null` for a session without a readable owner. */
function ownerOf(stored: string): string | null {
  try {
    const raw: unknown = JSON.parse(stored);
    const userId = typeof raw === 'object' && raw !== null ? (raw as { userId?: unknown }).userId : null;
    return typeof userId === 'string' && userId !== '' ? userId : null;
  } catch {
    return null;
  }
}

/**
 * The session stored in this tab for `userId`. One that belongs to somebody else, or to nobody
 * (a session an earlier version wrote), is deleted instead of handed over: the next person to
 * sit at a tab must not find the previous one's text.
 */
export function readStoredSession(storage: Pick<Storage, 'getItem' | 'removeItem'> | null, userId: string): string | null {
  if (!storage) return null;
  try {
    const stored = storage.getItem(SESSION_KEY);
    if (stored === null) return null;
    if (userId !== '' && ownerOf(stored) === userId) return stored;
    storage.removeItem(SESSION_KEY);
  } catch {
    /* A session that cannot be read starts afresh. */
  }
  return null;
}

/** Forgets the stored session; for sign-out and for a session that ended. */
export function clearStoredSession(storage: Pick<Storage, 'removeItem'> | null = sessionStore()): void {
  try {
    storage?.removeItem(SESSION_KEY);
  } catch {
    /* Nothing to forget where storage cannot be reached. */
  }
}
