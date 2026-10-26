import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { AdminHarness } from './test/AdminHarness';

/* ---------------------------------------------------------------------------
 * No `<h1>` inside the admin console.
 *
 * The console is a dialog over a page that owns the `<h1>`; the DS
 * `SettingsDialog` titles itself and its sections with `<h2>`s.
 * `KBOverviewDashboard` and `SystemHealthDashboard` sit on the design system's
 * `DashboardLayout`, whose `PageHeader` renders an `<h1>` unless
 * `headingLevel` says otherwise (design-system v0.24.0); the two call sites
 * pass 2. This is the only place in the suite that renders AdminUI together
 * with those two nested dashboards, and that composition is the point: neither
 * half can see the defect alone, and a story renders one component, never the
 * console.
 *
 * ORACLE for both tests: WAI-ARIA's heading levels as computed by
 * @testing-library's role queries over jsdom's DOM. The assertion is a COUNT
 * over the whole rendered tree, so it fails if a nested page reintroduces a
 * top-level heading. Mutation-verified by deleting `headingLevel={2}` from the
 * two call sites.
 * ------------------------------------------------------------------------- */

vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn() },
}));

// ONE STABLE object per mocked context, deliberately: `t` and `toast` sit in
// AdminUI's `fetchConfigs`/`fetchSiteConfigs` dependency lists and those in an
// effect's, so a fresh object per render re-runs the fetch on every render.
// The same trap is documented in the two dashboards' shell suites.
const themeMock = { t: (k: string) => k, language: 'en' as const };
vi.mock('./contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('./contexts/ToastContext', () => ({ useToast: () => toastMock }));
const modalMock = { showConfirm: vi.fn(), showAlert: vi.fn(), showPrompt: vi.fn() };
vi.mock('./contexts/ModalContext', () => ({ useModalContext: () => modalMock }));
const authMock = { user: { id: 'op-1', role: 'superadmin' } };
vi.mock('./contexts/AuthContext', () => ({ useAuth: () => authMock }));
// jsdom has no `window.matchMedia`, which this hook reads through
// `useSyncExternalStore` — the same accommodation AdminConfigsTab.test.tsx
// makes. Unrelated to headings; without it the configs tab cannot mount.
vi.mock('./hooks/useReducedMotion', () => ({
    useReducedMotion: () => false,
    getMotionProps: () => ({}),
}));

/** Minimal payloads: these tests count headings, not data. */
const KB_OVERVIEW = {
    rows: [
        {
            id: 'kb-1', name: 'Alpha KB', ownerName: 'Ada Lovelace', ownerId: 'user-1',
            ownerUsername: 'ada', isGlobal: false, isPublished: true, fileCount: 2,
            totalSizeBytes: 1024, failedFileCount: 0, processingFileCount: 0,
            webTurns: 3, apiTurns: 1, chatCount: 1, createdAt: '2026-01-01T00:00:00Z',
        },
    ],
    queueSummary: { 'rag-quick': { waiting: 0, active: 0, failed: 0 } },
    timestamp: '2026-01-01T00:00:00Z',
};

const HEALTH_LIVE = {
    activeUsers: 0, processingFiles: 0, totalKnowledgeBases: 1, totalFiles: 1,
    totalStorageBytes: 1024, totalUsers: 1, totalMessages: 1, totalMessagesApi: 0,
    messages24h: 0, messages24hApi: 0,
    // All three queues: SystemHealthDashboard renders one QueueCard per known
    // queue name and indexes into this map unconditionally.
    queueStats: {
        'rag-quick': { waiting: 0, active: 0, failed: 0 },
        'rag-heavy': { waiting: 0, active: 0, failed: 0 },
        'rag-batch': { waiting: 0, active: 0, failed: 0 },
    },
    resourceUsage: {
        nodeHeapUsedMB: 1, systemMemoryUsedPercent: 1,
        cpuLoadAvg1m: 0, cpuLoadAvg5m: 0, cpuLoadAvg15m: 0, cpuCount: 1,
    },
    subsystemHealth: {
        mainDb: { status: 'healthy', latencyMs: 1 },
        vectorDb: { status: 'healthy', latencyMs: 1 },
        redis: { status: 'healthy', latencyMs: 1 },
        storage: { status: 'healthy', latencyMs: 1 },
    },
    timestamp: '2026-01-01T00:00:00Z',
};

const HEALTH_HISTORY = { metric: 'fixture', data: [] };

const mockedGet = axios.get as unknown as Mock;

beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes('/admin/kb-overview')) return Promise.resolve({ data: KB_OVERVIEW });
        if (u.includes('/system-health/history')) return Promise.resolve({ data: HEALTH_HISTORY });
        if (u.includes('/system-health/live')) return Promise.resolve({ data: HEALTH_LIVE });
        if (u.includes('/admin/configs')) return Promise.resolve({ data: [] });
        return Promise.resolve({ data: {} });
    });
});

function renderAdmin() {
    return render(<AdminHarness userRole="superadmin" />);
}

describe('AdminUI — no top-level heading inside the console', () => {
    it('adds no <h1> on the KB overview section', async () => {
        renderAdmin();
        await userEvent.click(screen.getByRole('button', { name: 'adminTabKbOverview' }));

        // The nested page has rendered before the count is taken — otherwise
        // the assertion would pass on an empty section. Its fixture row is not
        // something the dialog itself can produce.
        expect(await screen.findByText('Alpha KB')).toBeInTheDocument();

        expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
    });

    it('adds no <h1> on the system health section', async () => {
        renderAdmin();
        await userEvent.click(screen.getByRole('button', { name: 'adminTabHealth' }));

        // „System Health" is the dashboard's own title; the dialog's section
        // heading says adminTabHealth.
        expect(await screen.findByRole('heading', { level: 2, name: /System Health/ })).toBeInTheDocument();

        expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
    });
});
