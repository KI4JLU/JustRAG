import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { STORYBOOK_ENV_DEFINE, STORYBOOK_ENV_PREFIX } from './.storybook/env';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

/* ---------------------------------------------------------------------------
 * Two projects, deliberately separated (card KI-725).
 *
 * `projects: [...]` was produced by `storybook add @storybook/addon-vitest`;
 * the jsdom half below is the file's previous flat `test` block moved verbatim
 * into the first entry, so the existing suite runs with the same environment,
 * the same setupFiles and the same include glob it always had. Both entries
 * carry `extends: true`, which is what keeps the root-level `react()` plugin
 * and — load-bearing — the `virtual:pwa-register/react` alias in effect for
 * both. Without that alias App.tsx cannot be imported at all.
 *
 * They are two projects and not one so that a browser failure can never be
 * read as a unit failure: every line of output is prefixed with the project
 * name (`unit` / `storybook`), and `--project=<name>` runs exactly one of
 * them. `npm test` runs the `unit` project only — see package.json for why.
 *
 * CSS: the jsdom project keeps `css: false` (unit tests assert on the DOM, not
 * on computed style, and skipping the CSS pipeline is what makes them fast).
 * That flag is now scoped to that project instead of being global, because
 * the story project needs the opposite: `css: true` plus the `tailwindcss()`
 * plugin, so `.storybook/preview.css` -> `src/index.css` really compiles. A
 * visual story rendered without the app's stylesheet would be worthless.
 * ------------------------------------------------------------------------- */

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // vite-plugin-pwa generates this module at build time and is registered
      // only in vite.config.ts, so under vitest the import is unresolvable.
      // ReloadPrompt imports it, and App.tsx imports ReloadPrompt — which made
      // the application's root component impossible to import in any test.
      // The stub reports "no update waiting"; there is no service worker here.
      'virtual:pwa-register/react': fileURLToPath(new URL('./src/test/pwaRegisterStub.ts', import.meta.url))
    }
  },
  test: {
    projects: [{
      extends: true,
      test: {
        name: 'unit',
        globals: true,
        environment: 'jsdom',
        css: false,
        setupFiles: ['src/test/setup.ts'],
        include: ['src/**/*.test.{ts,tsx}']
      }
    }, {
      extends: true,
      plugins: [
      // Compiles src/index.css (Tailwind 4 layers + the design system's
      // `@theme` tokens) for the browser project. vite.config.ts has this
      // plugin for the app build and .storybook/vite.config.ts has it for
      // Storybook itself; the browser test runner is the third place Vite
      // runs, and it needs its own instance.
      tailwindcss(),
      // The plugin will run tests for the stories defined in your Storybook config
      // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
      storybookTest({
        configDir: path.join(dirname, '.storybook')
      })],
      // Same same-origin API base, and the same deliberate refusal to read the
      // developer's own VITE_* env, that Storybook itself uses. Both settings
      // and the measurement behind them: .storybook/env.ts.
      envPrefix: STORYBOOK_ENV_PREFIX,
      define: STORYBOOK_ENV_DEFINE,
      optimizeDeps: {
        // aria-query is CJS-only; browser mode serves modules through Vite's
        // dev server, which cannot expose its named exports unless the package
        // is pre-bundled. Symptom without this: every *.stories.tsx fails with
        // "does not provide an export named 'elementRoles'".
        include: ['aria-query', '@testing-library/dom', '@testing-library/user-event']
      },
      test: {
        name: 'storybook',
        // Explicit, not inherited: the jsdom project switches CSS processing
        // off and a story without the stylesheet renders unstyled.
        css: true,
        browser: {
          enabled: true,
          headless: true,
          provider: playwright({}),
          // Desktop, explicitly: every story here is a full PAGE, and the
          // LegalPage story measures the content column's computed max-width.
          // At the browser-mode default (414px wide) the column would be
          // narrower than its own max-width and that measurement would be
          // meaningless.
          viewport: { width: 1280, height: 800 },
          instances: [{
            browser: 'chromium'
          }]
        }
      }
    }]
  }
});
