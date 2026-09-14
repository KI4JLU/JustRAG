import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { LegalPage } from './LegalPage';

/* ---------------------------------------------------------------------------
 * LegalPage on the design system's PAGE shape — `Container` + `PageHeader`
 * (card KI-750), which replaced `AuthLayout` (Stage 4a, card KI-693).
 *
 * WHY THE NUMBER IN THE MEASUREMENT BELOW CHANGED, so a reviewer does not read
 * it as a weakened test: it asserted `672px` up to KI-743, which was
 * `AuthLayout`'s `width="prose"` (`max-w-2xl`) and was correct for that
 * template — its independent reviewer confirmed it, and `AuthLayout.prose`
 * still computes to 672px in v0.25.0. It reads `1000px` here because this card
 * REPLACED the template, not because anything drifted underneath it: 1000px is
 * `Container`'s `size="content"` (`--max-width-container-content`, DS v0.25.0,
 * card KI-751) and it is the same 1000px as `.home-view__grid--main`
 * (HomeView.css:246) — the width the developer asked these pages to match.
 * The TECHNIQUE is unchanged and is the part that matters: the computed value
 * out of the CSSOM, never a class string, because a class assertion passes
 * even when the utility compiles to nothing.
 *
 * Nothing is mocked here. The component fetches
 * /legal/<page>-<language>.html, and Storybook serves web/public through
 * `staticDirs` while the Vitest browser runner serves it through Vite's
 * publicDir — so these stories render the ACTUAL compliance documents at the
 * actual measure, which is the only thing that makes the width question
 * answerable, and the only place the documents' OWN headings are in the DOM
 * (which is what the single-<h1> assertions below are for; the file-driven
 * variant over all six documents and both languages is in LegalPage.test.tsx).
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
 * the page's measure, in both themes.
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
 * Terms of use, and the two measurements the AuthLayout cards could only
 * reason about: the content width, and the absence of the card.
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
    // wrote. 1000px is the `--max-width-container-content` token behind
    // `Container`'s `size="content"`; the token is the design system's and
    // Chromium resolves it, so neither the class nor the number is this repo's
    // own claim. Drop the prop and the walk finds 1440px (`size` falls back to
    // the cva default `page`) — mutation-verified on KI-750.
    const heading: HTMLElement = await canvas.findByRole('heading', {
      level: 1,
      name: 'Nutzungsbedingungen',
    });
    let node: HTMLElement | null = heading;
    let constrained = 'none';
    while (node && constrained === 'none') {
      constrained = getComputedStyle(node).maxWidth;
      node = node.parentElement;
    }
    await expect(constrained).toBe('1000px');

    // Oracle 3: the developer's ACTUAL complaint — "a small mobile-styled
    // container instead of a full page view". The document used to sit inside
    // a DS `Card`, whose own class list is
    // `rounded-xl border border-outline-variant bg-surface-container-lowest
    //  … shadow-card` (dist/index.js). So a card in the chain is observable
    // without naming a class: every ancestor from the heading up to the
    // <main> landmark must carry NO border and NO shadow. Both values come
    // out of the CSSOM, and the "no border" half is only meaningful because
    // Tailwind Preflight resets `*{border:0 solid}` — a `border` utility is
    // what makes it non-zero.
    let box: HTMLElement | null = heading;
    while (box && box.tagName !== 'MAIN') {
      const style = getComputedStyle(box);
      await expect(style.borderTopWidth).toBe('0px');
      await expect(style.boxShadow).toBe('none');
      box = box.parentElement;
    }
    // The walk must actually have reached the landmark, or the two assertions
    // above could have passed by never running.
    await expect(box?.tagName).toBe('MAIN');
  },
};

export const TermsDark: Story = {
  args: { page: 'terms' },
  globals: { theme: 'dark' },
};

/** The longest of the three documents — the worst case for the measure. */
export const Privacy: Story = {
  args: { page: 'privacy' },
  play: async ({ canvas }) => {
    // Oracle: a heading only privacy-de.html carries, so the real document is
    // in the DOM …
    await expect(await canvas.findByRole('heading', { name: 'Allgemeines' })).toBeVisible();
    // … and then the count of level-1 headings, which is the KI-726 defect in
    // its natural habitat: the page's own <h1> plus the one the document used
    // to carry made two. A COUNT fails in both directions — a document that
    // reinstates its <h1> gives 2, a PageHeader that loses its heading gives 0.
    // Oracle: the WAI-ARIA heading role + `aria-level` mapping, resolved by
    // the browser and read through testing-library, not by this repo.
    await expect(canvas.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  },
};

export const PrivacyDark: Story = {
  args: { page: 'privacy' },
  globals: { theme: 'dark' },
};

export const Accessibility: Story = {
  args: { page: 'accessibility' },
  play: async ({ canvas }) => {
    // Same pair as Privacy. This document is the one that used to duplicate
    // the page title verbatim — its own `<h2>Erklärung zur Barrierefreiheit`
    // said exactly what `t('accessibilityTitle')` says — so its first heading
    // is now a section heading.
    await expect(await canvas.findByRole('heading', { name: 'Nicht barrierefreie Inhalte' })).toBeVisible();
    await expect(canvas.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  },
};

export const AccessibilityDark: Story = {
  args: { page: 'accessibility' },
  globals: { theme: 'dark' },
};
