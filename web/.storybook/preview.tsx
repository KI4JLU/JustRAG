import type { Decorator, Preview } from '@storybook/react-vite';
import { ThemeProvider } from '../src/contexts/ThemeContext';
import { ToastProvider } from '../src/contexts/ToastContext';
import { installApiMock, type ApiMockParameters } from './mockApi';
import './preview.css';

type ThemeName = 'light' | 'dark';

/**
 * Bridges the Storybook toolbar selection into the app's REAL theme
 * mechanism, so a story exercises the same runtime the browser does.
 *
 * The app's `useThemeAndLanguage` reads `localStorage['theme']` in its
 * `useState` initialiser and writes `data-theme` onto <html> from its own
 * effect; the context exposes `toggleTheme()` but no setter. So the toolbar
 * cannot push a value in — it has to seed the storage key the hook reads and
 * then let the hook initialise from it. That is why the write is here in the
 * decorator body and not in an effect: it must land BEFORE the provider's
 * state initialiser runs, and a child's initialiser runs after the parent's
 * render body. The write is idempotent.
 *
 * `key={theme}` is what makes the toolbar interactive: the initialiser only
 * runs on mount, so switching the global has to remount the provider. The
 * story itself never touches `data-theme` — the app still sets it, which is
 * the point of testing the real mechanism rather than a picture of it.
 */
const withAppShell: Decorator = (Story, context) => {
  const theme: ThemeName = context.globals.theme === 'dark' ? 'dark' : 'light';
  localStorage.setItem('theme', theme);

  return (
    <ThemeProvider key={theme}>
      {/* LegalPage calls useToast() for its load-failure path; Login renders
        * LegalPage, so the provider belongs around every story rather than
        * around one of them. */}
      <ToastProvider>
        <Story />
      </ToastProvider>
    </ThemeProvider>
  );
};

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Colour scheme (data-theme on <html>)',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'light',
  },
  decorators: [withAppShell],
  // Runs before every story render, in Storybook and in the Vitest browser
  // run alike. The returned callback is the teardown, so the axios adapter is
  // restored when the story is switched and one story's mock can never leak
  // into the next.
  beforeEach: (context) =>
    installApiMock((context.parameters.api ?? {}) as ApiMockParameters),
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    // 'todo' (the design system's setting too): axe findings surface as amber
    // markers in the Storybook sidebar and do NOT fail the CLI run. Turning
    // them into errors would gate this repo's pre-existing a11y backlog on a
    // brand-new tool, which is not this card's job.
    a11y: {
      test: 'todo',
    },
  },
  tags: ['autodocs'],
};

export default preview;
