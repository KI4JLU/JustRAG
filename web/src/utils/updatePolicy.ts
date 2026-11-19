/**
 * Policy for how long an open tab may keep running a superseded build.
 *
 * Background: the service worker registers with `registerType: 'prompt'`, so a
 * newly deployed worker installs and then WAITS. That is deliberate — an open
 * tab keeps every file of its own build, so it stays whole after a deploy and
 * through a network drop, and the version never changes under a click. Until
 * the waiting worker is applied the tab keeps the previous app shell; a plain
 * location.reload() does not help, it just re-serves the precache.
 *
 * So the version changes at two moments only:
 *
 *   - At a page load (utils/applyWaitingUpdate.ts): nothing is lost there.
 *   - In an open tab, when the user accepts the update card — which cannot
 *     be closed — or, past the grace period below, on its own while the tab
 *     is hidden, so the reload lands on a tab nobody is looking at. Any tab
 *     switch is a safe moment; in practice that bounds staleness to roughly
 *     the grace period, also for tabs left open for weeks.
 */

/**
 * How long an open tab may stay on a superseded build before the update is
 * applied without asking. Deliberately long: the card is the primary path
 * and this is only the backstop for tabs that are never acted on.
 */
export const MAX_DEFERRAL_MS = 2 * 60 * 60_000; // 2 hours

/**
 * Whether to apply the waiting service worker without asking.
 *
 * Requires BOTH that the grace period has elapsed and that the tab is hidden.
 * Reloading a visible tab would discard whatever the user was reading or
 * typing; reloading a hidden one costs them nothing.
 */
export function shouldApplyAutomatically(
    pendingSince: number | null,
    now: number,
    documentHidden: boolean,
): boolean {
    if (pendingSince === null) return false;
    if (!documentHidden) return false;
    return now - pendingSince >= MAX_DEFERRAL_MS;
}
