import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-vitest'
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {
      builder: {
        // Storybook's default is the app's ../vite.config.ts, which would drag
        // the PWA plugin, the compressors and the image optimizer into the
        // workbench. See ./vite.config.ts. The path is resolved from
        // process.cwd(), and the npm scripts run from web/.
        viteConfigPath: '.storybook/vite.config.ts'
      }
    }
  },
  // Serves web/public at the Storybook origin, which is what makes two of the
  // required states real rather than faked:
  //   - LegalPage fetches /legal/<page>-<lang>.html and gets the actual
  //     compliance documents, so the 448px measure can be judged on real text;
  //   - the uploaded-logo branch of Login resolves /logo-test.svg to a real
  //     image instead of a broken one.
  // The Vitest browser runner reaches the same files through Vite's own
  // publicDir (web/public), so both runtimes serve identical bytes.
  staticDirs: ['../public']
};

export default config;
