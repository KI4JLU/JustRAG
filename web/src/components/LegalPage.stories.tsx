import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { LegalPage } from './LegalPage';

/* ---------------------------------------------------------------------------
 * LegalPage on the design system's AuthLayout (card KI-693), so the question
 * that card left open can be judged instead of described: the content column
 * narrowed from a hand-set 720px to the template's `max-w-md` (448px), which
 * sits on AuthLayout's inner Stack and is not reachable through className.
 *
 * Nothing is mocked here. The component fetches
 * /legal/<page>-<language>.html, and Storybook serves web/public through
 * `staticDirs` while the Vitest browser runner serves it through Vite's
 * publicDir — so these stories render the ACTUAL compliance documents at the
 * actual measure, which is the only thing that makes the 448px question
 * answerable.
 *
 * Language follows the app's own state (seeded to `de` in
 * .storybook/preview.tsx); the DE/EN control lives on Login, so switch it
 * there, or change localStorage['language'] and reload the story.
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
    // wrote. 448px is `max-w-md`; KI-693 recorded it as a reasoned figure with
    // a "not visually confirmed" TODO, and this is the confirmation.
    let node: HTMLElement | null = await canvas.findByRole('heading', {
      level: 1,
      name: 'Nutzungsbedingungen',
    });
    let constrained = 'none';
    while (node && constrained === 'none') {
      constrained = getComputedStyle(node).maxWidth;
      node = node.parentElement;
    }
    await expect(constrained).toBe('448px');
  },
};

export const TermsDark: Story = {
  args: { page: 'terms' },
  globals: { theme: 'dark' },
};

/** The longest of the three documents — the worst case for a 448px measure. */
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
