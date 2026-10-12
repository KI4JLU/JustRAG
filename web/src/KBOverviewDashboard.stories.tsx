import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { AuthProvider } from './contexts/AuthContext';
import { translations } from './translations';
import KBOverviewDashboard from './KBOverviewDashboard';

/* ---------------------------------------------------------------------------
 * The admin KB overview, on the design system's `DashboardLayout` template
 * (card KI-714, Stage 4b).
 *
 * The component takes NO props. Its rendered state comes from exactly two
 * sources, and the stories set both through the real mechanism:
 *   GET /api/admin/kb-overview  -> rows + queue summary (axios adapter)
 *   useAuth().user.role         -> which row actions exist (the REAL
 *                                  AuthProvider, with a fixture user)
 *
 * `useAuth` throws outside a provider, so the decorator wraps the story in the
 * app's own `AuthProvider` rather than mocking the hook: a mocked hook would
 * render a component the app never renders. The provider is given a fixture
 * user and no-op callbacks; nothing here holds a real token.
 *
 * States covered:
 *   Superadmin   — every row action (publish / transfer / delete).
 *   Admin        — only publish, which is the state that made the actions
 *                  column appear for plain system admins.
 *   Empty        — no knowledge bases at all: the queue tiles read 0 and the
 *                  table shows its single "none" row. Zero-data is where a
 *                  dashboard looks worst and it is what hand QA forgets.
 *   Loading      — the overview request hangs, so the component sits in its
 *                  own `loading` branch.
 *
 * The `<table>` is untouched by this card (Stage 5, KI-694, migrates it), so
 * nothing below asserts anything about table STYLING — only that the shell
 * around it is the template's and that the row actions survived the swap from
 * raw <button> to the DS Button.
 * ------------------------------------------------------------------------- */

/** Structural mirror of GET /api/admin/kb-overview, written out by hand. */
const ROWS = [
  {
    id: 'kb-1', name: 'Pruefungsordnungen', ownerName: 'Ada Lovelace', ownerId: 'user-1',
    ownerUsername: 'ada', isGlobal: false, isPublished: false, fileCount: 128,
    totalSizeBytes: 734_003_200, failedFileCount: 3, processingFileCount: 1,
    webTurns: 412, apiTurns: 88, chatCount: 57,
    lastFileUploadAt: '2026-09-01T08:00:00Z', lastTurnAt: '2026-09-02T11:30:00Z',
    createdAt: '2026-01-14T10:00:00Z',
  },
  {
    id: 'kb-2', name: 'Zentrale Studienberatung', isGlobal: true, isPublished: true,
    fileCount: 42, totalSizeBytes: 12_582_912, failedFileCount: 0, processingFileCount: 0,
    webTurns: 1_204, apiTurns: 0, chatCount: 210,
    lastTurnAt: '2026-09-02T12:05:00Z',
    createdAt: '2025-11-02T09:00:00Z',
  },
  {
    id: 'kb-3', name: 'Ein sehr langer Wissensbasis-Name der die Namensspalte umbrechen muss',
    ownerName: 'Grace Hopper', ownerId: 'user-2', ownerUsername: 'grace',
    isGlobal: false, isPublished: false, fileCount: 0, totalSizeBytes: 0,
    failedFileCount: 0, processingFileCount: 0, webTurns: 0, apiTurns: 0, chatCount: 0,
    createdAt: '2026-08-28T15:00:00Z',
  },
];

const QUEUE_SUMMARY = {
  'rag-quick': { waiting: 2, active: 1, failed: 0 },
  'rag-heavy': { waiting: 0, active: 0, failed: 4 },
  'rag-batch': { waiting: 11, active: 2, failed: 0 },
};

const OVERVIEW = { rows: ROWS, queueSummary: QUEUE_SUMMARY, timestamp: '2026-09-02T12:10:00Z' };

const EMPTY_OVERVIEW = { rows: [], queueSummary: {}, timestamp: '2026-09-02T12:10:00Z' };

/**
 * Accessible names, read out of `translations.ts`.
 *
 * Storybook mounts the app's REAL ThemeProvider (see .storybook/preview.tsx),
 * so `t()` resolves against that file and the controls are named in German —
 * unlike `KBOverviewDashboard.actions.test.tsx`, which mocks `useTheme` with
 * an identity `t` and therefore queries the KEYS. Naming them from the
 * translation table rather than typing the German in keeps the oracle an
 * independent data artifact instead of a transcription.
 */
const NAME = {
  publish: translations.kbActionPublish.de,
  transfer: translations.kbActionTransfer.de,
  delete: translations.kbActionDelete.de,
  loading: translations.loading.de,
  overview: translations.adminTabKbOverview.de,
} as const;

/** Fixture user. No real credential, and `token` is never read by this page. */
function authDecorator(role: string): Decorator {
  return (Story) => (
    <AuthProvider
      user={{ id: 'op-fixture', username: 'operator-fixture', role }}
      token="storybook-fixture-not-a-secret"
      logout={() => {}}
      updateUser={() => {}}
      siteConfigs={{}}
    >
      <Story />
    </AuthProvider>
  );
}

const meta = {
  title: 'Pages/Admin KB Overview',
  component: KBOverviewDashboard,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof KBOverviewDashboard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Superadmin: Story = {
  decorators: [authDecorator('superadmin')],
  parameters: { api: { kbOverview: OVERVIEW } },
  play: async ({ canvas }) => {
    // ORACLE 1: the accessibility tree. The page title is a real heading at
    // level 2 — `headingLevel={2}`, design-system v0.24.0 (card KI-743).
    // Level 2 and not 1 because this page is NESTED: AdminUI.tsx owns the
    // admin area's <h1>, and until v0.24.0 the template's level was fixed at 1
    // and gave those pages two. Rendered standalone here, the page therefore
    // has no <h1> at all; that AdminUI's tree has exactly one is what
    // src/AdminUI.headings.test.tsx pins, which no story can (a story never
    // renders the app's routes).
    const heading = await canvas.findByRole('heading', { level: 2, name: NAME.overview });

    // ORACLE 2: the browser's CSSOM. index.css reverts h1-h6 margins to the
    // UA value in `@layer base`, so the template's heading is the element that
    // counterweight hits. The `m-0` that answers it moved from a
    // `[&>header_h1]:m-0` workaround on the call site into PageHeader itself
    // in v0.24.0; the assertion is deliberately unchanged, so it now pins the
    // component's guarantee. This number comes from the browser, not the repo.
    await expect(getComputedStyle(heading).marginTop).toBe('0px');

    // ORACLE 3: the fixture's `isGlobal` flags. Publish is offered only for a
    // still-private KB (the endpoint answers 409 otherwise) and transfer/
    // delete are superadmin-only, so two private + one public rows must give
    // 2 publish, 2 transfer, 3 delete. The three controls became DS Buttons;
    // their accessible names are what the existing jsdom suite also keys on.
    await expect(canvas.getAllByRole('button', { name: NAME.publish })).toHaveLength(2);
    await expect(canvas.getAllByRole('button', { name: NAME.transfer })).toHaveLength(2);
    await expect(canvas.getAllByRole('button', { name: NAME.delete })).toHaveLength(3);
  },
};

/** A plain system admin gets publish and nothing else. */
export const Admin: Story = {
  decorators: [authDecorator('admin')],
  parameters: { api: { kbOverview: OVERVIEW } },
  play: async ({ canvas }) => {
    await canvas.findByRole('heading', { level: 2 });
    // ORACLE: the backend's own route gating — POST /api/admin/kb/{id}/publish
    // sits on adminChain while delete/transfer are superadmin-only, so the
    // role in the provider decides exactly this set.
    await expect(canvas.getAllByRole('button', { name: NAME.publish })).toHaveLength(2);
    await expect(canvas.queryByRole('button', { name: NAME.delete })).toBeNull();
    await expect(canvas.queryByRole('button', { name: NAME.transfer })).toBeNull();
  },
};

/**
 * Zero data: no KBs and an empty queue summary. The three queue tiles still
 * render (the component defaults each to 0), which is the point — a deployment
 * whose worker has never run must not show three blank cards.
 */
export const Empty: Story = {
  decorators: [authDecorator('superadmin')],
  parameters: { api: { kbOverview: EMPTY_OVERVIEW } },
  play: async ({ canvas }) => {
    await canvas.findByRole('heading', { level: 2 });
    // ORACLE: the fixture's `queueSummary: {}`. The component's documented
    // fallback is `{ waiting: 0, active: 0, failed: 0 }` per queue, so nine
    // zeroes must be on the page — three tiles x three counters. Fewer means
    // a tile silently rendered nothing.
    await expect((await canvas.findAllByText('0')).length).toBeGreaterThanOrEqual(9);
    // And no row action exists, because there is no row.
    await expect(canvas.queryByRole('button', { name: NAME.delete })).toBeNull();
  },
};

/** Loading: the overview request hangs. */
export const Loading: Story = {
  decorators: [authDecorator('superadmin')],
  parameters: { api: { pending: ['kbOverview'] } },
  play: async ({ canvas }) => {
    // ORACLE: WAI-ARIA's `status` role, carried by the DS Spinner that
    // replaced `<Loader2 className="spin">` — `.spin` is not defined in
    // index.css at all, so the old marker only animated when some other
    // component happened to inject it.
    //
    // getAllByRole, not getByRole: this page has TWO live regions while the
    // first request is in flight (the page-level loader and the spinner
    // inside the disabled Refresh button, because `refreshing` is true too),
    // and that is correct behaviour rather than a defect to assert away.
    const statuses = await canvas.findAllByRole('status');
    await expect(statuses.length).toBeGreaterThanOrEqual(1);
    await expect(statuses.some((s) => s.textContent?.includes(NAME.loading))).toBe(true);
    // The table must not exist yet.
    await expect(canvas.queryByRole('table')).toBeNull();
  },
};
