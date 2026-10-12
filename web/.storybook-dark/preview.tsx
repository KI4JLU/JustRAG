import type { Preview } from '@storybook/react-vite';
import { MotionGlobalConfig } from 'framer-motion';
import base from '../.storybook/preview';

/**
 * Project annotations for the dark a11y run. Three overrides on top of
 * ../preview.tsx, which is otherwise reused verbatim (decorator, API mock,
 * toolbar):
 *
 * - `initialGlobals.theme = 'dark'` — the portable-story runtime merges
 *   `{ ...initialGlobals, ...story.globals }`, so every story rendered by this
 *   project mounts through `withAppShell` in dark mode without carrying a pin
 *   of its own. Same mechanism the toolbar uses, same `localStorage` seed.
 * - `a11y.test = 'error'` and `runOnly` the two colour rules — axe violations
 *   FAIL here, but only `color-contrast` and `link-in-text-block` are run.
 *   Those are the rules whose answer depends on the theme; heading order,
 *   nested controls, names and roles are the same DOM in both schemes and are
 *   already reported by the main project (as `'todo'` sidebar markers, no
 *   gate — the light-mode backlog is not this project's job). Measured before
 *   narrowing: the first honest run found 2 nested-interactive and 1
 *   heading-order finding alongside 2 real dark-contrast pairs, and the
 *   structural three showed up identically in light.
 * - Motion is frozen before each render. axe blends a text colour with the
 *   opacity of its ancestors, and `Login`, `AuthenticatedApp` and
 *   `SystemHealthDashboard` fade their `<main>` in with framer-motion — so
 *   with the animation running, axe measured the heading of the login page as
 *   #1a1c1f on #121417 (ratio 1.08), i.e. the text at ~2 % opacity, not a
 *   token pair. Measured on the first run of this project; every one of the
 *   34 "violations" it reported was this. `MotionGlobalConfig.skipAnimations`
 *   is framer-motion's own switch for exactly this (tests jump to the final
 *   frame); the stylesheet does the same for the app's 150–200 ms CSS colour
 *   transitions, which the light→dark flip inside a test would otherwise
 *   catch mid-way. Neither changes a colour at rest, which is all a contrast
 *   check is about.
 *
 * Which stories run: only those tagged `a11y-dark` (the `tags.include` filter
 * in vitest.config.ts). Tag one story per distinct surface — a page background
 * with its primary action, an error banner, a status palette, long prose — not
 * one per state. Colour contrast in this app is a property of the design
 * system's token pairs (eslint forbids raw colours), so a surface checked once
 * is checked for every state that reuses the same tokens.
 */
const FREEZE_STYLE_ID = 'a11y-dark-freeze';

const freezeMotion = () => {
  MotionGlobalConfig.skipAnimations = true;
  if (!document.getElementById(FREEZE_STYLE_ID)) {
    const el = document.createElement('style');
    el.id = FREEZE_STYLE_ID;
    el.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.appendChild(el);
  }
};

const baseBeforeEach = Array.isArray(base.beforeEach) ? base.beforeEach : base.beforeEach ? [base.beforeEach] : [];

const preview: Preview = {
  ...base,
  initialGlobals: {
    ...base.initialGlobals,
    theme: 'dark',
  },
  beforeEach: [freezeMotion, ...baseBeforeEach],
  parameters: {
    ...base.parameters,
    a11y: {
      test: 'error',
      options: {
        runOnly: { type: 'rule', values: ['color-contrast', 'link-in-text-block'] },
      },
    },
  },
};

export default preview;
