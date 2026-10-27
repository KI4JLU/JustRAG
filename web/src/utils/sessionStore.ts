/**
 * `window.sessionStorage`, or null where touching it throws (Safari in private
 * mode). For state that must survive a single-sign-on round trip in the same
 * tab and nothing longer: the invite-link token (hooks/useJoinLink.ts) and the
 * page to return to (routing/postLoginPath.ts).
 */
export function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
