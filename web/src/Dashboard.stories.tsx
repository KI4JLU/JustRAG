import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import Dashboard from './Dashboard';

/* ---------------------------------------------------------------------------
 * The KB analytics dashboard, on the design system's `DashboardLayout`
 * template (card KI-714, Stage 4b).
 *
 * `kbId` / `kbName` are the only props; EVERYTHING else on the page is derived
 * inside the component from two GET responses:
 *   GET /api/kb/{id}/analytics                   -> tiles + six charts
 *   GET /api/kb/{id}/analytics/retrieval-quality -> the three optional panels
 * So these stories set those two responses and nothing else — no doubled
 * children, no injected state. See .storybook/mockApi.ts for what is and is
 * not real about the axios-adapter interception.
 *
 * States covered, and why these:
 *   Populated  — the normal page: five tiles, nine panels.
 *   Empty      — every array empty. Dashboards look worst here and a hand-QA
 *                pass forgets it: nine panels fall back to their own centred
 *                "Keine … vorhanden" text and the tiles all read 0.
 *   Loading    — the analytics request hangs, so the component sits in its own
 *                `loading` branch. Reached through the real effect.
 *   RetrievalQualityUnavailable — the second request 404s, which the component
 *                treats as "optional data absent". That branch drops the
 *                Feedback tile and three panels, i.e. it changes the LAYOUT,
 *                and nothing had ever shown it.
 *
 * Light mode only: no story pins a theme. The toolbar's Theme switch renders
 * any story dark without reloading — see .storybook/preview.tsx. Dark-mode
 * coverage is an accessibility question, not one story per state.
 *
 * NOTE: `src/Dashboard.tsx` has no import site anywhere in the app (verified
 * at the claim base: nothing imports './Dashboard'). These stories are
 * currently the only way to see it at all — raised as an open question on the
 * card.
 * ------------------------------------------------------------------------- */

/**
 * Fixtures are structural mirrors of the endpoints, written out by hand rather
 * than imported from Dashboard.tsx: a fixture that shares a type with the code
 * under test follows that code when it changes, which is exactly what a
 * fixture must not do.
 */
const ANALYTICS = {
  files: {
    byType: [
      { type: 'application/pdf', count: 12, totalSize: 5_000_000 },
      { type: 'text/markdown', count: 5, totalSize: 120_000 },
      { type: 'text/html', count: 3, totalSize: 60_000 },
    ],
    byStatus: [
      { status: 'completed', count: 18 },
      { status: 'failed', count: 2 },
    ],
    byOrigin: [
      { origin: 'upload', count: 10 },
      { origin: 'crawl', count: 7 },
      { origin: 'rss', count: 3 },
    ],
    totalFiles: 20,
    totalSize: 5_180_000,
  },
  activity: {
    filesOverTime: [
      { date: '2026-08-30', count: 3 },
      { date: '2026-08-31', count: 1 },
      { date: '2026-09-01', count: 4 },
    ],
    chatsOverTime: [
      { date: '2026-08-30', count: 2 },
      { date: '2026-08-31', count: 5 },
      { date: '2026-09-01', count: 1 },
    ],
    messagesOverTime: [
      { date: '2026-08-30', count: 11 },
      { date: '2026-08-31', count: 24 },
      { date: '2026-09-01', count: 7 },
    ],
  },
  chats: {
    totalChats: 8,
    totalMessages: 42,
    messagesByRole: [
      { role: 'user', count: 21 },
      { role: 'assistant', count: 21 },
    ],
    avgMessagesPerChat: 5.3,
  },
  generatedContent: {
    byType: [
      { type: 'summary', count: 4 },
      { type: 'flashcards', count: 2 },
    ],
    totalGenerated: 6,
    overTime: [],
  },
};

const EMPTY_ANALYTICS = {
  files: { byType: [], byStatus: [], byOrigin: [], totalFiles: 0, totalSize: 0 },
  activity: { filesOverTime: [], chatsOverTime: [], messagesOverTime: [] },
  chats: { totalChats: 0, totalMessages: 0, messagesByRole: [], avgMessagesPerChat: 0 },
  generatedContent: { byType: [], totalGenerated: 0, overTime: [] },
};

const RETRIEVAL_QUALITY = {
  feedbackStats: [
    { feedback: 'positive', count: 9 },
    { feedback: 'negative', count: 2 },
    { feedback: 'none', count: 31 },
  ],
  scoreOverTime: [
    { day: '2026-08-30', avgScore: 0.71, messageCount: 11 },
    { day: '2026-08-31', avgScore: 0.64, messageCount: 24 },
    { day: '2026-09-01', avgScore: 0.79, messageCount: 7 },
  ],
  lowScoreQueries: [
    { id: 'q1', content: 'Wie ist die Regelung zur Zweitkorrektur bei Bachelorarbeiten?', createdAt: '2026-09-01T09:12:00Z', avgScore: 0.21 },
    { id: 'q2', content: 'Fristen Rueckmeldung Wintersemester', createdAt: '2026-08-31T16:40:00Z', avgScore: 0.28 },
  ],
};

const EMPTY_RETRIEVAL_QUALITY = {
  feedbackStats: [],
  scoreOverTime: [],
  lowScoreQueries: [],
};

const meta = {
  title: 'Pages/Dashboard',
  component: Dashboard,
  // DashboardLayout is a Container with its own page margins, so the story
  // must render edge to edge or the margins are measured against Storybook's
  // padding instead of the viewport.
  parameters: { layout: 'fullscreen' },
  args: {
    kbId: 'kb-fixture-1',
    kbName: 'Pruefungsordnungen (Fixture)',
  },
} satisfies Meta<typeof Dashboard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  tags: ['a11y-dark'],
  parameters: {
    api: { kbAnalytics: ANALYTICS, kbRetrievalQuality: RETRIEVAL_QUALITY },
  },
  play: async ({ canvas }) => {
    // ORACLE 1: the HTML spec's heading semantics, read out of the
    // accessibility tree by @testing-library. `DashboardLayout` routes `title`
    // through `PageHeader`, which renders a real <h1> — unlike `AuthLayout`,
    // whose CardTitle is a <div>. If the template ever stopped doing so, this
    // page would silently lose its only heading.
    const heading = await canvas.findByRole('heading', { level: 1, name: 'Dashboard' });

    // ORACLE 2: the browser's own CSSOM. src/index.css deliberately reverts
    // h1-h6 margins to the USER-AGENT value inside `@layer base` (to protect
    // markdown prose from Preflight), so PageHeader's heading is exactly the
    // element that counterweight hits: without an `m-0` somewhere the UA's
    // 0.67em lands on top of the template's own `gap-1`. Until v0.24.0 that
    // `m-0` was a `[&>header_h1]:m-0` workaround on this call site; the
    // component now carries it itself, and this assertion is unchanged on
    // purpose — it is what shows the guarantee survived the move (card
    // KI-743). Nothing in this repo computes this number; Chromium does.
    const style = getComputedStyle(heading);
    await expect(style.marginTop).toBe('0px');
    await expect(style.marginBottom).toBe('0px');

    // Same for the description <p> (UA margin 1em).
    const description = await canvas.findByText('Pruefungsordnungen (Fixture)');
    await expect(getComputedStyle(description).marginTop).toBe('0px');

    // ORACLE 3: recharts' own DOM contract — a rendered chart is an
    // `<svg class="recharts-surface">` inside the ResponsiveContainer. Third
    // party, and it is what distinguishes "chart drawn" from "empty state".
    await waitFor(async () => {
      const panel = canvas.getByRole('img', { name: 'Dateien nach Typ' });
      await expect(panel.querySelector('svg.recharts-surface')).not.toBeNull();
    });
  },
};

/**
 * Zero-data state. Every one of the nine panels has its own centred fallback
 * and the tiles all read 0 — the state a fresh KB is actually in on day one,
 * and the one a hand-QA pass never sets up.
 */
export const Empty: Story = {
  parameters: {
    api: { kbAnalytics: EMPTY_ANALYTICS, kbRetrievalQuality: EMPTY_RETRIEVAL_QUALITY },
  },
  play: async ({ canvas }) => {
    await canvas.findByRole('heading', { level: 1, name: 'Dashboard' });

    // ORACLE: recharts' DOM contract again, used in the negative direction —
    // with an empty series there must be NO chart surface in the panel, which
    // is the assertion that the empty branch (not a zero-height chart) is what
    // renders. A chart drawn over no data is the defect this pins.
    const panel = canvas.getByRole('img', { name: 'Dateien nach Typ' });
    await expect(panel.querySelector('svg.recharts-surface')).toBeNull();

    // ORACLE: the fixture. `totalFiles: 0` and `totalGenerated: 0` are values
    // this file sets, not values the component computes, so the tiles have to
    // show them.
    await expect((await canvas.findAllByText('0')).length).toBeGreaterThanOrEqual(3);
  },
};

/**
 * Loading. The analytics request never settles, so the component stays in its
 * own `loading` branch — reached through the real effect, not injected.
 */
export const Loading: Story = {
  parameters: {
    api: { pending: ['kbAnalytics', 'kbRetrievalQuality'] },
  },
  play: async ({ canvas }) => {
    // ORACLE: WAI-ARIA's `status` role, which the design system's `Spinner`
    // carries and the old `<RefreshCw className="spin">` did not — the swap
    // is what made this state announceable at all. Read from the
    // accessibility tree.
    const status = await canvas.findByRole('status');
    await expect(status).toHaveTextContent('Lade Dashboard...');
    // And the page itself must NOT be there yet.
    await expect(canvas.queryByRole('heading', { level: 1 })).toBeNull();
  },
};

/**
 * Retrieval quality unavailable (the endpoint 404s). The component swallows
 * that failure by design — "don't fail the whole dashboard" — which silently
 * removes the Feedback tile and three of the nine panels. That is a different
 * LAYOUT, and it had never been visible anywhere.
 */
export const RetrievalQualityUnavailable: Story = {
  parameters: {
    api: { kbAnalytics: ANALYTICS },
  },
  play: async ({ canvas }) => {
    await canvas.findByRole('heading', { level: 1, name: 'Dashboard' });
    // ORACLE: the mocked HTTP status. A 404 on the optional endpoint must
    // leave the required panels standing and take exactly the optional ones
    // with it.
    await expect(canvas.getByRole('img', { name: 'Dateien nach Typ' })).toBeInTheDocument();
    await expect(canvas.queryByRole('img', { name: 'Feedback-Verteilung' })).toBeNull();
    await expect(canvas.queryByText('Feedback')).toBeNull();
  },
};
