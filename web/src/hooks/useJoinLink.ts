// Invite-link entry point. Someone opening https://<host>/join/<token> (a knowledge base) or
// https://<host>/join-glossary/<token> (a glossary) may not be signed in yet, and signing in via
// OIDC is a top-level navigation away from the app and back. sessionStorage survives that
// navigation within the same tab, which is exactly the scope we want: localStorage would leave
// the token lying around for every other tab and every later session.
//
// Cost of that choice: opening the link in one tab and signing in in another
// loses the join, and the person clicks the link again.
//
// The SPA catch-all in the Go server (routes.go) already serves index.html
// for /join/... and /join-glossary/..., so no backend routing is involved.

import { sessionStore } from '../utils/sessionStore';

/** What a link joins. Each kind keeps its own parked token and attempt budget. */
export type JoinKind = 'kb' | 'glossary';

export const JOIN_TOKEN_KEY = 'pendingJoinToken';
export const GLOSSARY_JOIN_TOKEN_KEY = 'pendingJoinGlossaryToken';
const TOKEN_KEYS: Record<JoinKind, string> = { kb: JOIN_TOKEN_KEY, glossary: GLOSSARY_JOIN_TOKEN_KEY };

// 43 base64url characters is what the backend mints; the range stays loose
// enough to survive a future token-length change but tight enough that a
// stray path never looks like a token.
const TOKEN_PATTERN = '([A-Za-z0-9_-]{20,64})';
const JOIN_PATHS: Record<JoinKind, RegExp> = {
    kb: new RegExp(`^/join/${TOKEN_PATTERN}$`),
    glossary: new RegExp(`^/join-glossary/${TOKEN_PATTERN}$`),
};

/**
 * Reads a /join/<token> or /join-glossary/<token> URL, parks the token for the post-login
 * redemption, and rewrites the URL to "/" so a reload does not replay the join.
 */
export function captureJoinToken(): void {
    for (const kind of Object.keys(JOIN_PATHS) as JoinKind[]) {
        const match = JOIN_PATHS[kind].exec(window.location.pathname);
        if (!match) continue;
        sessionStore()?.setItem(TOKEN_KEYS[kind], match[1]);
        window.history.replaceState(null, '', '/');
        return;
    }
}

/** Returns the parked token without consuming it. */
export function peekJoinToken(kind: JoinKind = 'kb'): string | null {
    return sessionStore()?.getItem(TOKEN_KEYS[kind]) ?? null;
}

/** Returns the parked token and clears it, so it is redeemed at most once. */
export function takeJoinToken(kind: JoinKind = 'kb'): string | null {
    const s = sessionStore();
    if (!s) return null;
    const token = s.getItem(TOKEN_KEYS[kind]);
    s.removeItem(TOKEN_KEYS[kind]);
    return token;
}

/**
 * Re-parks a token that takeJoinToken() already consumed, so a retryable
 * redemption failure (network error, 5xx, rate limit) can be retried on the
 * next mount instead of forcing the user to find the original link again.
 * Not for the 404 case: a genuinely invalid/revoked token must stay cleared.
 */
export function parkJoinToken(token: string, kind: JoinKind = 'kb'): void {
    sessionStore()?.setItem(TOKEN_KEYS[kind], token);
}

// Attempt budget for re-parked tokens. Re-parking is unconditional for every
// non-404 failure, so a DURABLE error — an invite row pointing at a
// half-deleted KB, a backend stuck returning 500 — would otherwise re-fire a
// request and an error toast on every page load for the rest of the tab
// session, with no way for the user to stop it. Two attempts survives a
// genuine blip (a dropped connection, one rate-limited burst) without turning
// a permanent failure into a permanent loop.
export const JOIN_ATTEMPTS_KEY = 'pendingJoinAttempts';
const ATTEMPT_KEYS: Record<JoinKind, string> = { kb: JOIN_ATTEMPTS_KEY, glossary: 'pendingJoinGlossaryAttempts' };
export const MAX_JOIN_ATTEMPTS = 2;

/**
 * Records one failed attempt and reports whether another is allowed.
 * Returns true while the budget lasts, false once it is spent.
 */
export function recordJoinAttempt(kind: JoinKind = 'kb'): boolean {
    const s = sessionStore();
    if (!s) return false;
    const attempts = Number(s.getItem(ATTEMPT_KEYS[kind]) ?? '0') + 1;
    if (attempts >= MAX_JOIN_ATTEMPTS) {
        s.removeItem(ATTEMPT_KEYS[kind]);
        return false;
    }
    s.setItem(ATTEMPT_KEYS[kind], String(attempts));
    return true;
}

/** Clears the attempt budget — on success, and on a terminal 404. */
export function clearJoinAttempts(kind: JoinKind = 'kb'): void {
    sessionStore()?.removeItem(ATTEMPT_KEYS[kind]);
}
