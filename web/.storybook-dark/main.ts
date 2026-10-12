import type { StorybookConfig } from '@storybook/react-vite';
import base from '../.storybook/main';

/**
 * Second Storybook config for the `storybook-dark-a11y` Vitest project — the
 * same stories, addons and builder as ../main.ts, rendered in dark mode with
 * axe findings turned into failures (see ./preview.tsx). It exists so dark
 * mode is checked once per SURFACE instead of once per story: the 45 `…Dark`
 * twin stories it replaces doubled the story run for a check that could not
 * fail. Nothing here is served by `storybook dev`; only the test runner loads
 * it.
 *
 * `stories` and `staticDirs` are resolved relative to the config dir, so the
 * two globs have to be restated one level deeper. `viteConfigPath` is resolved
 * from process.cwd() and is inherited unchanged.
 */
const config: StorybookConfig = {
  ...base,
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  staticDirs: ['../public']
};

export default config;
