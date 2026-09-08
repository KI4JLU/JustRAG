import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import SystemHealthDashboard from './SystemHealthDashboard';

/* ---------------------------------------------------------------------------
 * Card KI-714 (Stage 4b) replaced this page's outer shell with the design
 * system's `DashboardLayout`, swapped four raw <button>s and one native
 * checkbox for DS controls, and replaced the four hand-rolled range buttons
 * with the DS `SegmentedControl`. This file had no test at all.
 *
 * Every test names its oracle, and every oracle is an artifact other than this
 * component: the HTML Living Standard through jsdom, WAI-ARIA, a control
 * census of the PRE-migration source read out of git at the claim base
 * (`git show 3c53aa6:web/src/SystemHealthDashboard.tsx`), and — for the range
 * switch — date arithmetic done here rather than by the component.
 *
 * Layout, spacing and colour are NOT asserted here; the browser stories
 * (SystemHealthDashboard.stories.tsx) measure the shell's real computed style,
 * and only the developer's both-theme pass can accept the look.
 * ------------------------------------------------------------------------- */

vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn() },
}));
// ONE STABLE object, deliberately: `t` sits in this component's effect
// dependency list, so a fresh object per render makes the initial-load effect
// re-run forever. Measured: with an inline object literal the four /history
// requests became 3168 before the assertion timed out. Same trap
// Login.shell.test.tsx documents.
const themeMock = { t: (k: string) => k, language: 'en' as const };
vi.mock('./contexts/ThemeContext', () => ({ useTheme: () => themeMock }));

const mockedGet = axios.get as unknown as Mock;

const LIVE = {
    activeUsers: 2,
    processingFiles: 1,
    totalKnowledgeBases: 3,
    totalFiles: 40,
    totalStorageBytes: 2048,
    totalUsers: 12,
    totalMessages: 900,
    totalMessagesApi: 100,
    messages24h: 40,
    messages24hApi: 5,
    queueStats: {
        'rag-quick': { waiting: 0, active: 0, failed: 0 },
        'rag-heavy': { waiting: 0, active: 0, failed: 0 },
        'rag-batch': { waiting: 0, active: 0, failed: 0 },
    },
    resourceUsage: {
        nodeHeapUsedMB: 100,
        systemMemoryUsedPercent: 40,
        cpuLoadAvg1m: 1,
        cpuLoadAvg5m: 1,
        cpuLoadAvg15m: 1,
        cpuCount: 4,
    },
    subsystemHealth: {
        mainDb: { status: 'healthy', latencyMs: 2 },
        vectorDb: { status: 'degraded', latencyMs: 900 },
        redis: { status: 'unhealthy', error: 'connection refused' },
        storage: { status: 'healthy', latencyMs: 5 },
    },
    timestamp: '2026-09-02T12:00:00Z',
};

const HISTORY = {
    metric: 'fixture',
    data: [
        { timestamp: '2026-09-02T11:00:00Z', value: 1 },
        { timestamp: '2026-09-02T12:00:00Z', value: 4 },
    ],
};

/** Returns the params of every /history call made so far. */
function historyCalls(): Array<{ metric: string; from: string; to: string }> {
    return mockedGet.mock.calls
        .filter(([url]) => String(url).includes('/system-health/history'))
        .map(([, cfg]) => (cfg as { params: { metric: string; from: string; to: string } }).params);
}

beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockImplementation((url: string) =>
        String(url).includes('/history')
            ? Promise.resolve({ data: HISTORY })
            : Promise.resolve({ data: LIVE }),
    );
});

describe('SystemHealthDashboard — the shell', () => {
    it('renders the page title as the template h1, and only one of them', async () => {
        // ORACLE: the pre-migration source rendered `<h2 style={{margin: 0…}}>`
        // (line 482 at the claim base) and five `<h3>` section headings.
        // `DashboardLayout` routes `title` through `PageHeader`'s `<h1>` and
        // the level is not a prop, so the level change is the TEMPLATE's, not
        // a choice made here. Recorded so it cannot drift unnoticed.
        const { container } = render(<SystemHealthDashboard />);
        await waitFor(() => expect(container.querySelectorAll('h1')).toHaveLength(1));
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('System Health');
        expect(container.querySelectorAll('h2')).toHaveLength(0);
    });

    it('pairs every rendered <label> with a labelable control', async () => {
        // ORACLE: the HTML Living Standard, section 4.10.4 — the LABELABLE set
        // is exactly {button, input, meter, output, progress, select,
        // textarea} and `HTMLLabelElement.control` is jsdom's implementation
        // of the spec's "labeled control" algorithm. The pre-migration markup
        // WRAPPED its checkbox in the label (line 495), so nothing had to
        // resolve; `Label htmlFor` + `Checkbox id` does, and a dangling
        // `htmlFor` would be silent.
        const LABELABLE = ['button', 'input', 'meter', 'output', 'progress', 'select', 'textarea'];
        const { container } = render(<SystemHealthDashboard />);
        await screen.findByRole('heading', { level: 1 });

        const labels = Array.from(container.querySelectorAll<HTMLLabelElement>('label'));
        // Guard against a vacuous pass: the auto-refresh row is the one label.
        expect(labels).toHaveLength(1);
        for (const label of labels) {
            expect(label.control, `<label>${label.textContent}</label> has no control`).not.toBeNull();
            expect(LABELABLE).toContain(label.control!.tagName.toLowerCase());
        }
    });

    it('exposes auto-refresh through the checkbox role, on by default', async () => {
        // ORACLE: WAI-ARIA's `checkbox` role and `aria-checked` state, plus the
        // pre-migration source's own default (`useState(true)`, line 274 at
        // the claim base — this page polls by default, unlike the KB
        // overview). A Radix control's native input is visually hidden, so the
        // ARIA state is the only observable one (card KI-710).
        render(<SystemHealthDashboard />);
        await screen.findByRole('heading', { level: 1 });

        const box = screen.getByRole('checkbox', { name: 'Auto-Refresh (10s)' });
        expect(box).toHaveAttribute('aria-checked', 'true');
        await userEvent.click(box);
        expect(box).toHaveAttribute('aria-checked', 'false');
    });

    it('renders no raw <input> and no native constraint attribute', async () => {
        // ORACLE: the census of the pre-migration source, from git — 1 raw
        // <input> (the auto-refresh checkbox, line 503) and 4 raw <button>
        // (retry 437, refresh 511, AI check 658, range 719). The checkbox is
        // now a Radix control and Radix renders its hidden native input only
        // inside a <form>, of which this page has none. The constraint check
        // is card KI-710's rule.
        const { container } = render(<SystemHealthDashboard />);
        await screen.findByRole('heading', { level: 1 });

        expect(container.querySelectorAll('input')).toHaveLength(0);
        expect(container.querySelectorAll('[required]')).toHaveLength(0);
        expect(container.querySelectorAll('[min], [max], [step]')).toHaveLength(0);
    });

    it('resolves every aria-describedby IDREF to a real element', async () => {
        // ORACLE: WAI-ARIA 1.2 — a reference that resolves to nothing is
        // silently dropped by assistive technology (the KI-692 defect class).
        const { container } = render(<SystemHealthDashboard />);
        await screen.findByRole('heading', { level: 1 });

        expect(container.querySelectorAll('button').length).toBeGreaterThan(0);
        for (const el of Array.from(container.querySelectorAll('[aria-describedby]'))) {
            for (const id of el.getAttribute('aria-describedby')!.split(/\s+/).filter(Boolean)) {
                expect(document.getElementById(id), `aria-describedby="${id}" resolves to nothing`).not.toBeNull();
            }
        }
    });
});

describe('SystemHealthDashboard — the range switch survived the SegmentedControl swap', () => {
    it('announces the active range through aria-pressed', async () => {
        // ORACLE: WAI-ARIA's `aria-pressed` toggle-button state, which the
        // design system's `SegmentedControl` documents as its contract ("the
        // active segment is announced via aria-pressed") and implements — not
        // this repo. The pre-migration buttons signalled the active range
        // through a background colour ONLY, with nothing in the accessibility
        // tree, so this is a capability the swap added.
        render(<SystemHealthDashboard />);
        await screen.findByRole('heading', { level: 1 });

        const pressed = ['1h', '24h', '7d', '30d'].map(
            (label) => screen.getByRole('button', { name: label }).getAttribute('aria-pressed'),
        );
        // Default range is '24h' (the pre-migration source's own default,
        // line 276 at the claim base): exactly one segment pressed, and it is
        // the second.
        expect(pressed).toEqual(['false', 'true', 'false', 'false']);
    });

    it('refetches the four history metrics over the picked window', async () => {
        // ORACLE: date arithmetic done HERE, not by the component. Picking
        // '7d' must produce `to - from === 7 days` on every one of the four
        // metric requests; the pre-migration source computed
        // `to - 7 * 24 * 60 * 60 * 1000`. A window computed for the wrong
        // range (24h, 30d) fails, and so does a click that refetches nothing.
        // The metric NAMES are the second half of the oracle: the four
        // `system_health_metrics` keys the Go handler serves are
        // active_users / storage_bytes / total_files / queue_failed.
        render(<SystemHealthDashboard />);
        await screen.findByRole('heading', { level: 1 });
        await waitFor(() => expect(historyCalls()).toHaveLength(4));

        await userEvent.click(screen.getByRole('button', { name: '7d' }));
        await waitFor(() => expect(historyCalls()).toHaveLength(8));

        const refetched = historyCalls().slice(4);
        expect(refetched.map((p) => p.metric)).toEqual([
            'active_users', 'storage_bytes', 'total_files', 'queue_failed',
        ]);
        for (const params of refetched) {
            const span = new Date(params.to).getTime() - new Date(params.from).getTime();
            expect(span).toBe(7 * 24 * 60 * 60 * 1000);
        }
    });

    it('clicking the already-active range neither refetches nor strands the spinner', async () => {
        // ORACLE, two independent artifacts:
        //
        //  1. The design system's `SegmentedControl` source, read off the
        //     installed package (dist/index.js): its per-segment handler is
        //     `onClick: () => onValueChange(value)`, UNCONDITIONALLY — it
        //     fires for the active segment too. So the guard the
        //     pre-migration source had (`if (range === dateRange) return;`,
        //     line 722 at the claim base) is still load-bearing after the
        //     swap, not dead code.
        //  2. React's same-value bail-out. `setDateRange(sameValue)` does not
        //     re-render, so `getDateRange` keeps its identity and the
        //     history effect does NOT re-run — but `setLoading(true)` is a
        //     real state change, and nothing else would ever set it back.
        //     Dropping the guard therefore leaves the refresh button
        //     spinning forever while requesting nothing.
        //
        // Both halves are asserted, because the request count alone does not
        // notice the stranded spinner: measured, a version of this test that
        // checked only `historyCalls()` passed with the guard REMOVED.
        render(<SystemHealthDashboard />);
        await screen.findByRole('heading', { level: 1 });
        await waitFor(() => expect(historyCalls()).toHaveLength(4));

        const refresh = screen.getByRole('button', { name: 'Aktualisieren' });
        // The DS Spinner carries role="status"; the idle button holds none.
        expect(refresh.querySelector('[role="status"]')).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: '24h' }));

        expect(historyCalls()).toHaveLength(4);
        expect(refresh.querySelector('[role="status"]')).toBeNull();
    });
});

describe('SystemHealthDashboard — subsystem status', () => {
    it('renders one row per subsystem plus the AI provider row', async () => {
        // ORACLE: the response shape. `subsystemHealth` has exactly four keys
        // (mainDb, vectorDb, redis, storage — the Go handler's own struct in
        // internal/systemhealth), and the AI provider is a fifth, manually
        // checked row with its own button. The fixture's error string can only
        // reach the page through the unhealthy branch.
        render(<SystemHealthDashboard />);
        await screen.findByRole('heading', { level: 1 });

        expect(screen.getByText('Haupt-Datenbank')).toBeInTheDocument();
        expect(screen.getByText('Vektor-Datenbank')).toBeInTheDocument();
        expect(screen.getByText('Redis')).toBeInTheDocument();
        expect(screen.getByText(/connection refused/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Prüfen' })).toBeInTheDocument();
    });
});
