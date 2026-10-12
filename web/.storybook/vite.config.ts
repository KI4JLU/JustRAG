import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { STORYBOOK_ENV_DEFINE, STORYBOOK_ENV_PREFIX } from './env';

/**
 * Vite config for Storybook ONLY, wired in via
 * `framework.options.builder.viteConfigPath` in main.ts.
 *
 * The app's ../vite.config.ts is not reused on purpose: it carries the PWA
 * plugin, gzip/brotli compression, the image optimizer and the favicon
 * fingerprinter, none of which mean anything for a component workbench, and
 * `vite-plugin-pwa` would inject a service worker into the Storybook page.
 * What stories DO need is exactly two plugins — React and Tailwind 4 — plus
 * the same same-origin API base the browser test runner uses.
 *
 * Keep this in step with the `storybook` project entry in ../vitest.config.ts:
 * they are two independent Vite instances rendering the same stories, so a
 * plugin added here without being added there shows up as "works in Storybook,
 * fails in the story tests".
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Not needed by today's stories (Login/LegalPage do not reach
      // ReloadPrompt), but the app's root component does: without the stub the
      // virtual module is unresolvable outside `vite build`, and a future
      // story that renders App.tsx would fail on the import rather than on
      // anything about the story. Same alias as ../vitest.config.ts.
      'virtual:pwa-register/react': fileURLToPath(new URL('../src/test/pwaRegisterStub.ts', import.meta.url)),
    },
  },
  envPrefix: STORYBOOK_ENV_PREFIX,
  define: STORYBOOK_ENV_DEFINE,
});
