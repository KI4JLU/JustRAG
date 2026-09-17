import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import SystemHealthDashboard from './SystemHealthDashboard';

/* ---------------------------------------------------------------------------
 * The admin system-health dashboard, on the design system's `DashboardLayout`
 * template (card KI-714, Stage 4b).
 *
 * No props. Everything on the page comes from three responses:
 *   GET  /api/system-health/live      -> eight tiles, queues, subsystems, gauges
 *   GET  /api/system-health/history   -> the four historical charts (one
 *                                        request per metric, same shape)
 *   POST /api/system-health/ai-check  -> the manual KI-Anbieter row
 *
 * States covered:
 *   Healthy   — everything green, charts populated.
 *   Degraded  — one degraded and one unhealthy subsystem, a queue with
 *               failures and a CPU gauge over its own max. This is the state
 *               the page EXISTS for and the hardest one to reach by hand.
 *   Empty     — live metrics all zero and every history series empty: eight
 *               tiles reading 0 and four charts on their own fallback. Exactly
 *               what a fresh deployment shows, and exactly what hand QA skips.
 *   Loading   — the live request hangs, so the component sits in its own
 *               `loading && !metrics` branch.
 *
 * `history` answers all four metrics from one handler, which is fine because
 * the component only reads `data.data[]` and never the `metric` name.
 * ------------------------------------------------------------------------- */

/** Structural mirror of GET /api/system-health/live, written out by hand. */
const LIVE = {
  activeUsers: 14,
  processingFiles: 3,
  totalKnowledgeBases: 27,
  totalFiles: 4_812,
  totalStorageBytes: 41_231_686_042,
  totalUsers: 963,
  totalMessages: 128_540,
  totalMessagesApi: 12_004,
  messages24h: 1_842,
  messages24hApi: 311,
  queueStats: {
    'rag-quick': { waiting: 2, active: 1, failed: 0 },
    'rag-heavy': { waiting: 0, active: 2, failed: 0 },
    'rag-batch': { waiting: 8, active: 1, failed: 0 },
  },
  resourceUsage: {
    nodeHeapUsedMB: 412,
    systemMemoryUsedPercent: 63.4,
    cpuLoadAvg1m: 2.1,
    cpuLoadAvg5m: 1.8,
    cpuLoadAvg15m: 1.4,
    cpuCount: 8,
  },
  subsystemHealth: {
    mainDb: { status: 'healthy', latencyMs: 3 },
    vectorDb: { status: 'healthy', latencyMs: 11 },
    redis: { status: 'healthy', latencyMs: 1 },
    storage: { status: 'healthy', latencyMs: 24 },
  },
  timestamp: '2026-09-02T12:10:00Z',
};

const DEGRADED = {
  ...LIVE,
  processingFiles: 41,
  queueStats: {
    'rag-quick': { waiting: 128, active: 4, failed: 17 },
    'rag-heavy': { waiting: 12, active: 0, failed: 3 },
    'rag-batch': { waiting: 0, active: 0, failed: 0 },
  },
  resourceUsage: {
    ...LIVE.resourceUsage,
    // Deliberately ABOVE cpuCount: GaugeBar clamps at 100%, and a bar that
    // overflowed its track is a visible defect worth having a story for.
    cpuLoadAvg1m: 11.7,
    systemMemoryUsedPercent: 94.2,
    nodeHeapUsedMB: 1_180,
  },
  subsystemHealth: {
    mainDb: { status: 'healthy', latencyMs: 4 },
    vectorDb: { status: 'degraded', latencyMs: 1_840 },
    redis: { status: 'unhealthy', error: 'dial tcp 10.0.3.4:6379: connect: connection refused' },
    storage: { status: 'healthy', latencyMs: 22 },
  },
};

const EMPTY_LIVE = {
  activeUsers: 0,
  processingFiles: 0,
  totalKnowledgeBases: 0,
  totalFiles: 0,
  totalStorageBytes: 0,
  totalUsers: 0,
  totalMessages: 0,
  totalMessagesApi: 0,
  messages24h: 0,
  messages24hApi: 0,
  queueStats: {
    'rag-quick': { waiting: 0, active: 0, failed: 0 },
    'rag-heavy': { waiting: 0, active: 0, failed: 0 },
    'rag-batch': { waiting: 0, active: 0, failed: 0 },
  },
  resourceUsage: {
    nodeHeapUsedMB: 0,
    systemMemoryUsedPercent: 0,
    cpuLoadAvg1m: 0,
    cpuLoadAvg5m: 0,
    cpuLoadAvg15m: 0,
    cpuCount: 4,
  },
  subsystemHealth: {
    mainDb: { status: 'healthy', latencyMs: 2 },
    vectorDb: { status: 'healthy', latencyMs: 5 },
    redis: { status: 'healthy', latencyMs: 1 },
    storage: { status: 'healthy', latencyMs: 8 },
  },
  timestamp: '2026-09-02T12:10:00Z',
};

const HISTORY = {
  metric: 'fixture',
  data: [
    { timestamp: '2026-09-02T08:00:00Z', value: 8 },
    { timestamp: '2026-09-02T09:00:00Z', value: 12 },
    { timestamp: '2026-09-02T10:00:00Z', value: 9 },
    { timestamp: '2026-09-02T11:00:00Z', value: 17 },
    { timestamp: '2026-09-02T12:00:00Z', value: 14 },
  ],
};

const EMPTY_HISTORY = { metric: 'fixture', data: [] };

const meta = {
  title: 'Pages/Admin System Health',
  component: SystemHealthDashboard,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SystemHealthDashboard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Healthy: Story = {
  parameters: {
    api: { systemHealthLive: LIVE, systemHealthHistory: HISTORY },
  },
  play: async ({ canvas }) => {
    // ORACLE 1: the accessibility tree — the page title is a real heading at
    // level 2 (`headingLevel={2}`, design-system v0.24.0, card KI-743).
    // Level 2 because this page is NESTED under AdminUI.tsx's own <h1>; the
    // template's level was fixed at 1 before v0.24.0, which gave the admin
    // area two. Standalone, as here, the page has no <h1> — the "exactly one
    // in the admin tree" oracle lives in src/AdminUI.headings.test.tsx.
    const heading = await canvas.findByRole('heading', { level: 2, name: /System Health/ });

    // ORACLE 2: the browser's CSSOM. index.css reverts h1-h6 margins to the
    // USER-AGENT value in `@layer base`, so the template's heading walks into
    // that counterweight. The answering `m-0` moved from a
    // `[&>header_h1]:m-0` workaround on the call site into PageHeader itself
    // in v0.24.0; the assertion stayed, and now pins the component's own
    // guarantee. The number is the browser's.
    await expect(getComputedStyle(heading).marginTop).toBe('0px');

    // ORACLE 3: the page's own scroll box, which this migration had to carry
    // across from the pre-migration root's inline
    // `maxHeight: 'calc(100vh - 200px)'`. The card's text claims the only
    // maxHeight in the three files is Dashboard.tsx:679 — it is not, and
    // dropping this one would have changed how the admin column scrolls.
    //
    // The expected value is derived from the BROWSER's own layout viewport
    // (`window.innerHeight`), not from a number written here: `100vh` resolves
    // to that height and Chromium resolves the `calc`. What the assertion pins
    // is the declaration — that the box still exists, that it is viewport-
    // relative, and that the offset is still exactly 200px. Remove the class
    // and the computed value is `none`; change the 200 and it is off by that
    // much.
    const layout = heading.closest('div[class*="overflow-y-auto"]');
    await expect(layout).not.toBeNull();
    await expect(getComputedStyle(layout!).maxHeight).toBe(`${window.innerHeight - 200}px`);
    await expect(getComputedStyle(layout!).overflowY).toBe('auto');

    // ORACLE 4: recharts' own DOM contract — a drawn chart is an
    // `<svg class="recharts-surface">`.
    await waitFor(async () => {
      await expect(document.querySelectorAll('svg.recharts-surface').length).toBeGreaterThanOrEqual(4);
    });
  },
};

/**
 * The state the page exists for: a degraded vector DB, a refused Redis
 * connection, seventeen failed quick jobs and every gauge in the red — with
 * the CPU gauge deliberately above its own max so the clamp is visible.
 */
export const Degraded: Story = {
  tags: ['a11y-dark'],
  parameters: {
    api: { systemHealthLive: DEGRADED, systemHealthHistory: HISTORY },
  },
  play: async ({ canvas }) => {
    await canvas.findByRole('heading', { level: 2, name: /System Health/ });
    // ORACLE: the fixture's own error string, which only reaches the page if
    // the unhealthy branch renders it. Read as text from the DOM, not from
    // component state.
    await expect(
      canvas.getByText(/connection refused/),
    ).toBeInTheDocument();

    // ORACLE: arithmetic done outside the component. cpuLoadAvg1m = 11.7 with
    // cpuCount = 8 is 146%, and GaugeBar's contract is to clamp at 100 — so
    // the fill's computed width must equal its track's, never exceed it. The
    // widths come from Chromium's layout, not from the component.
    const track = canvas.getByText('CPU Load (1m)').closest('div')!.nextElementSibling as HTMLElement;
    const fill = track.firstElementChild as HTMLElement;
    await expect(fill.getBoundingClientRect().width).toBeCloseTo(track.getBoundingClientRect().width, 0);
  },
};

/**
 * Zero-data state: a fresh deployment. Eight tiles at 0, three empty queues,
 * and four charts on their own centred fallback instead of an axis-only chart.
 */
export const Empty: Story = {
  parameters: {
    api: { systemHealthLive: EMPTY_LIVE, systemHealthHistory: EMPTY_HISTORY },
  },
  play: async ({ canvas }) => {
    await canvas.findByRole('heading', { level: 2, name: /System Health/ });
    // ORACLE: recharts' DOM contract, negative direction — with every series
    // empty there must be NO chart surface anywhere on the page. An
    // axis-only chart drawn over no data is the defect this pins.
    await expect(document.querySelectorAll('svg.recharts-surface')).toHaveLength(0);
    // ORACLE: the fixture. Eight tiles and nine queue counters are all 0.
    await expect((await canvas.findAllByText('0')).length).toBeGreaterThanOrEqual(9);
  },
};

/** Loading: the live request hangs, so `loading && !metrics` is what renders. */
export const Loading: Story = {
  parameters: {
    api: { pending: ['systemHealthLive', 'systemHealthHistory'] },
  },
  play: async ({ canvas }) => {
    // ORACLE: WAI-ARIA's `status` role, carried by the DS Spinner that
    // replaced `<RefreshCw className="spin">`.
    const status = await canvas.findByRole('status');
    await expect(status).toHaveTextContent('Lade System-Health-Dashboard...');
    // Level 2 since v0.24.0's `headingLevel` (card KI-743): the page title is
    // an <h2>, so pinning "no heading yet" on level 1 would pass vacuously.
    await expect(canvas.queryByRole('heading', { level: 2 })).toBeNull();
  },
};
