import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { LegalPage } from './LegalPage';

/* ---------------------------------------------------------------------------
 * LegalPage on the design system's AuthLayout (card KI-693), so the question
 * that card left open can be judged instead of described: the content column
 * narrowed from a hand-set 720px to the template's `max-w-md` (448px), which
 * sat on AuthLayout's inner Stack and was not reachable through className.
 * The developer rejected 448px at visual QA, the design system added a named
 * width, and this call site now passes `width="prose"` — `max-w-2xl`, 672px
 * (card KI-743). The measurement below is the 672px, from the CSSOM.
 *
 * Nothing is mocked here. The component fetches
 * /legal/<page>-<language>.html, and Storybook serves web/public through
 * `staticDirs` while the Vitest browser runner serves it through Vite's
 * publicDir — so these stories render the ACTUAL compliance documents at the
 * actual measure, which is the only thing that makes the width question
 * answerable.
 *
 * Language follows the app's own state (seeded to `de` in
 * .storybook/preview.tsx); the DE/EN control lives on Login, so switch it
 * there, or change localStorage['language'] and reload the story.
 *
 * FIDELITY GAP — do not use these stories to judge whether the legal pages
 * work (card KI-740). This page calls `useToast()`, and .storybook/preview.tsx
 * wraps every story in a `ToastProvider`. Production did not: the provider was
 * mounted in AuthenticatedApp, i.e. on the authenticated half of the tree
 * only, so the three legal documents threw
 * `useToast must be used within ToastProvider` for every visitor who opened
 * them BEFORE login — the main path for reading them — while all six stories
 * below rendered correctly. The advice "open Pages/LegalPage in Storybook to
 * check it" was therefore actively misleading, and no story can be made to
 * catch this class of bug: a story renders this component under the preview's
 * decorators, never under the app's routes. `src/App.unauthenticated.test.tsx`
 * is the guard that can — it renders the real App and clicks through the login
 * footer. These stories answer a different question: how the DOCUMENTS look at
 * the template's measure, in both themes.
 * ------------------------------------------------------------------------- */

const meta = {
  title: 'Pages/LegalPage',
  component: LegalPage,
  parameters: { layout: 'fullscreen' },
  args: { onBack: () => {} },
  argTypes: {
    page: { control: 'radio', options: ['terms', 'privacy', 'accessibility'] },
  },
} satisfies Meta<typeof LegalPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Terms of use, and the measurement KI-693 could only reason about.
 */
export const Terms: Story = {
  args: { page: 'terms' },
  play: async ({ canvas }) => {
    // Oracle 1: a heading that exists only in public/legal/terms-de.html, so
    // this passes only if the real document was fetched, sanitised and
    // injected — not if the spinner is still up or the fetch 404'd.
    await expect(await canvas.findByRole('heading', { name: '1. Geltungsbereich' })).toBeVisible();

    // Oracle 2: the browser's own CSSOM. Walk up from the page heading to the
    // first ancestor that constrains width and read the COMPUTED value, so the
    // number comes from the cascade rather than from a class string this repo
    // wrote. 672px is the `max-w-2xl` behind AuthLayout's `width="prose"`; the
    // Tailwind scale is the design system's, and Chromium resolves it, so
    // neither the class nor the number is this repo's own claim. Drop the prop
    // and the walk finds 448px (`max-w-md`) instead — which is exactly the
    // state the developer rejected, so this assertion is the regression guard
    // for it.
    let node: HTMLElement | null = await canvas.findByRole('heading', {
      level: 1,
      name: 'Nutzungsbedingungen',
    });
    let constrained = 'none';
    while (node && constrained === 'none') {
      constrained = getComputedStyle(node).maxWidth;
      node = node.parentElement;
    }
    await expect(constrained).toBe('672px');
  },
};

export const TermsDark: Story = {
  args: { page: 'terms' },
  globals: { theme: 'dark' },
};

/** The longest of the three documents — the worst case for the measure. */
export const Privacy: Story = {
  args: { page: 'privacy' },
};

export const PrivacyDark: Story = {
  args: { page: 'privacy' },
  globals: { theme: 'dark' },
};

export const Accessibility: Story = {
  args: { page: 'accessibility' },
};

export const AccessibilityDark: Story = {
  args: { page: 'accessibility' },
  globals: { theme: 'dark' },
};
