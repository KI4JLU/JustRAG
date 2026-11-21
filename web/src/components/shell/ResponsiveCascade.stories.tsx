import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';

/* ---------------------------------------------------------------------------
 * The responsive oracle (card KI-780). This file exists to make a breakpoint
 * ASSERTABLE, which it was not before: `web/src/index.css` hand-declared
 * `.flex`, `.items-center` and ten more Tailwind utilities outside every
 * `@layer`, and an unlayered rule outranks every layered one — before
 * specificity, before source order, and unaffected by a media query. So
 * `@layer utilities`'s `.lg\:hidden { display: none }` lost at every width,
 * the design system's AppShell mobile bar (`… flex items-center … lg:hidden`)
 * stayed on screen above 1024px, and no story could have caught it because no
 * story asserted a breakpoint at all.
 *
 * WHY A SYNTHETIC PROBE RATHER THAN A STORY OF `AppShellLayout`
 * The probe renders the exact className the design system ships on that bar,
 * on a bare <div>. It has no props, no data, no providers and no design-system
 * version coupling, so when it goes red the CSS pipeline is the only suspect —
 * which is the whole point of a regression guard. A story of the real template
 * answers a DIFFERENT and also useful question ("does the shell lay out
 * correctly"), and it would be the wrong place for this one: it can fail for a
 * dozen reasons that have nothing to do with the cascade.
 *
 * THE ORACLE, and why it is independent of the code under test
 *  1. The EXPECTED value comes from `matchMedia('(min-width: 64rem)')` — the
 *     browser evaluating the media condition, not our stylesheet and not a
 *     hard-coded pixel number that would drift with the root font size.
 *  2. The OBSERVED value comes from `getComputedStyle().display` — Chromium's
 *     own cascade resolution, the same engine the developer does visual QA in.
 *  3. Nothing here asserts on a class STRING. A className assertion passes
 *     even when the utility compiles to nothing, which is exactly the failure
 *     mode being guarded against.
 *  4. The `control` element pins down what "not hidden" means: if the probe
 *     were `display: none` for some unrelated reason, the control would still
 *     be `flex` and the two-sided comparison still holds.
 *
 * COVERAGE, stated honestly. `npm run test:stories --prefix web` exercises the
 * Vite DEV pipeline. The production bundle is covered separately and
 * structurally by `web/scripts/check-css-cascade.mjs`, which runs as the last
 * step of `npm run build`. Both halves are needed: this one can only see the
 * stylesheet the dev server serves.
 * ------------------------------------------------------------------------- */

/** Tailwind's `lg` variant compiles to exactly this condition. */
const LG = '(min-width: 64rem)';

const CONTROL = 'cascade-probe-control';
const RESPONSIVE = 'cascade-probe-lg-hidden';

function ResponsiveCascadeProbe() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div data-testid={CONTROL} className="flex items-center">
        control — `flex items-center`, visible at every width
      </div>
      <div data-testid={RESPONSIVE} className="flex items-center lg:hidden">
        probe — `flex items-center lg:hidden`, the AppShell mobile-bar pattern
      </div>
    </div>
  );
}

/**
 * Reads the two probes out of the live CSSOM and checks them against the
 * media query the browser itself evaluates.
 */
function assertBreakpoint(canvasElement: HTMLElement) {
  const control = canvasElement.querySelector(`[data-testid="${CONTROL}"]`);
  const responsive = canvasElement.querySelector(`[data-testid="${RESPONSIVE}"]`);
  expect(control).not.toBeNull();
  expect(responsive).not.toBeNull();

  const aboveLg = window.matchMedia(LG).matches;

  // The control proves the utility layer is live at all: if `.flex` compiled
  // to nothing, this fails first and the probe's result means nothing.
  expect(getComputedStyle(control as Element).display).toBe('flex');

  expect(getComputedStyle(responsive as Element).display).toBe(
    aboveLg ? 'none' : 'flex'
  );
}

/**
 * Walks every same-origin stylesheet the page has loaded and returns each
 * unlayered rule whose selector is ALSO emitted inside `@layer utilities` —
 * the CSSOM twin of `web/scripts/check-css-cascade.mjs`, run against the CSS
 * the DEV server produced rather than against the built bundle.
 */
function findShadowedUtilities(): string[] {
  const layered = new Set<string>();
  const unlayered = new Set<string>();

  const walk = (rules: CSSRuleList, layers: string[]) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSLayerBlockRule) {
        walk(rule.cssRules, [...layers, rule.name || '<anonymous>']);
      } else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
        walk(rule.cssRules, layers);
      } else if (rule instanceof CSSStyleRule) {
        const selectors = rule.selectorText.split(',').map((s) => s.trim());
        if (layers.includes('utilities')) {
          for (const s of selectors) layered.add(s);
        } else if (layers.length === 0) {
          for (const s of selectors) unlayered.add(s);
        }
      }
    }
  };

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin sheet — unreadable by design, and none of ours are.
      continue;
    }
    walk(rules, []);
  }

  return [...unlayered].filter((s) => layered.has(s)).sort();
}

const meta = {
  title: 'Foundations/ResponsiveCascade',
  component: ResponsiveCascadeProbe,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ResponsiveCascadeProbe>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The regression guard for the reported symptom. The Vitest browser runner
 * pins the viewport to 1280x800 (vitest.config.ts), i.e. above `lg`, so this
 * story asserts `display: none` there. Opened by hand in Storybook at a narrow
 * width it asserts `display: flex` instead — the expectation is derived from
 * `matchMedia`, not from the runner's configuration.
 */
export const BreakpointIsHonoured: Story = {
  play: ({ canvasElement }) => {
    assertBreakpoint(canvasElement);
  },
};

/**
 * The structural half, on the dev pipeline's CSS. It states the invariant
 * directly rather than through one symptom, so the NEXT hand-written
 * `.items-center` fails here too instead of waiting for someone to notice a
 * component that stopped responding to its breakpoint.
 */
export const NoUnlayeredUtilityShadows: Story = {
  play: () => {
    expect(findShadowedUtilities()).toEqual([]);
  },
};
