import { vi } from 'vitest';

/* ---------------------------------------------------------------------------
 * One `matchMedia` stub for the whole suite, viewport-aware.
 *
 * WHY IT HAD TO BECOME ONE THING. jsdom implements no `matchMedia` at all, so
 * every suite that renders something reading it used to install its own stub —
 * six byte-similar copies, all of them answering `matches: false` to EVERY
 * query. That was harmless while the only reader was `prefers-reduced-motion`
 * (Modal/Radix), where `false` is the right answer.
 *
 * Design-system 0.30.0 made it harmful. `AppShell` now chooses its arrangement
 * in JavaScript — `useIsDesktop()` reads `matchMedia("(min-width: 64rem)")` and
 * renders either three columns or ONE area plus a `BottomTabBar`. Against a
 * blanket `false` every suite silently moved to the narrow arrangement, where
 * the nav column is behind a tab and most assertions have nothing to find. The
 * failures pointed at the queries, not at the stub, which is exactly why this
 * belongs in one named place rather than in six copies.
 *
 * WHAT IT ANSWERS. `min-width` queries from `isDesktop`; everything else stays
 * `false`, which is what the pre-0.30.0 copies were for. It keys on the query's
 * KIND rather than on the exact breakpoint: the design system knows the
 * boundary as `DESKTOP_QUERY` in `lib/pane-layout.ts` but does not export it,
 * and restating `64rem` here would be a second copy that goes stale silently —
 * the shell would simply render the other arrangement. The one `min-width`
 * query the shell asks is the one this decides.
 * // TODO: exporting `DESKTOP_QUERY` from the design-system barrel would let a
 * consumer assert the boundary itself; not raised on the DS board yet.
 *
 * Call it in `beforeEach` with no argument for the desktop arrangement, and
 * again inside a test with `false` for the narrow one.
 * ------------------------------------------------------------------------- */
export function stubViewport(isDesktop = true): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width') ? isDesktop : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}
