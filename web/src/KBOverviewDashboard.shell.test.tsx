import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import KBOverviewDashboard from './KBOverviewDashboard';

/* ---------------------------------------------------------------------------
 * Card KI-714 (Stage 4b) replaced this page's outer shell with the design
 * system's `DashboardLayout`, moved the search field into a `ListToolbar`,
 * replaced the hand-rolled column popover with the DS `Popover` (Radix), and
 * swapped eight raw controls for DS ones — two of them native checkboxes,
 * which is the change that can silently break a label/control pair.
 *
 * `KBOverviewDashboard.actions.test.tsx` already covers WHICH row actions each
 * role gets, the Aktivität column and the sort. Nothing covered what the
 * migration changed:
 *   1. label/control pairing — `<label><input type="checkbox">…</label>`
 *      (wrapping) became `Label htmlFor` + `Checkbox id`, so a broken pairing
 *      is now silent;
 *   2. the column picker — an absolutely positioned `role="menu"` div plus a
 *      `document.mousedown` listener became a Radix Popover, so open/close and
 *      the checkbox wiring are new code paths;
 *   3. the page heading — h2 became the template's h1;
 *   4. the `<table>`, which this card must leave for Stage 5 (KI-694).
 *
 * Every test names its oracle. None of them is this component.
 * ------------------------------------------------------------------------- */

vi.mock('axios');
const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

// Identity `t`, the same convention KBOverviewDashboard.actions.test.tsx uses:
// the assertions are then about structure, not about translation strings.
//
// ONE STABLE object, unlike that older suite: `t` sits in `fetchData`'s
// dependency list and `fetchData` in an effect's, so a fresh object per render
// re-runs the fetch on every render. Measured on the sibling suite for this
// card: 3168 requests before a `waitFor` timed out.
const themeMock = { t: (k: string) => k, language: 'en' as const };
vi.mock('./contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
const authMock = { user: { id: 'op-1', role: 'superadmin' } };
vi.mock('./contexts/AuthContext', () => ({ useAuth: () => authMock }));

const OVERVIEW = {
    rows: [
        {
            id: 'kb-1', name: 'Alpha KB', ownerName: 'Ada Lovelace', ownerId: 'user-1', ownerUsername: 'ada',
            isGlobal: false, isPublished: true, fileCount: 2, totalSizeBytes: 1024, failedFileCount: 0,
            processingFileCount: 0, webTurns: 3, apiTurns: 1, chatCount: 1, createdAt: '2026-01-01T00:00:00Z',
        },
    ],
    queueSummary: {
        'rag-quick': { waiting: 1, active: 0, failed: 0 },
    },
    timestamp: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.get = vi.fn().mockResolvedValue({ data: OVERVIEW });
});

describe('KBOverviewDashboard — label and control pairing', () => {
    it('pairs every rendered <label> with a labelable control', async () => {
        // ORACLE: the HTML Living Standard, section 4.10.4 — the set of
        // LABELABLE elements is exactly {button, input, meter, output,
        // progress, select, textarea}, and `HTMLLabelElement.control` is
        // jsdom's implementation of the spec's "labeled control" algorithm.
        // Neither comes from this repo. This is the assertion that the DS
        // Checkbox (a Radix `<button role="checkbox">`) really is labelable
        // and that `htmlFor` really reaches it — the pre-migration markup
        // WRAPPED its input in the label instead, so nothing had to resolve.
        const LABELABLE = ['button', 'input', 'meter', 'output', 'progress', 'select', 'textarea'];
        render(<KBOverviewDashboard />);
        await screen.findByRole('heading', { level: 1 });

        // Open the column picker so its three labels are in the document too.
        await userEvent.click(screen.getByRole('button', { name: 'columnsToggle' }));
        await screen.findByRole('checkbox', { name: 'colProcessing' });

        const labels = Array.from(document.querySelectorAll<HTMLLabelElement>('label'));
        // Guard against a vacuous pass: auto-refresh plus three optional
        // columns is four labelled controls.
        expect(labels.length).toBeGreaterThanOrEqual(4);

        for (const label of labels) {
            expect(label.control, `<label>${label.textContent}</label> has no control`).not.toBeNull();
            expect(LABELABLE).toContain(label.control!.tagName.toLowerCase());
        }
    });

    it('exposes the two booleans through the checkbox role, not a hidden input', async () => {
        // ORACLE: WAI-ARIA's `checkbox` role and its required `aria-checked`
        // state, resolved by @testing-library. Card KI-710's finding is why
        // this matters: a Radix control's own native input is visually hidden,
        // so the ARIA state is the only thing a user or an assistive
        // technology can observe. Auto-refresh starts false (the component's
        // documented default is off here).
        render(<KBOverviewDashboard />);
        await screen.findByRole('heading', { level: 1 });

        const autoRefresh = screen.getByRole('checkbox', { name: 'kbAutoRefresh' });
        expect(autoRefresh).toHaveAttribute('aria-checked', 'false');

        await userEvent.click(autoRefresh);
        expect(autoRefresh).toHaveAttribute('aria-checked', 'true');
    });
});

describe('KBOverviewDashboard — the column picker survived the Popover swap', () => {
    it('opens on click, exposes its trigger state, and closes on Escape', async () => {
        // ORACLE: WAI-ARIA's button/`aria-expanded` contract plus the ARIA
        // Authoring Practices' dialog/popover keyboard behaviour, both
        // implemented by Radix — not by this repo. The pre-migration code
        // hand-maintained `aria-expanded` from its own state and had NO
        // Escape handling at all, so this is a capability the swap added and
        // the test pins.
        render(<KBOverviewDashboard />);
        await screen.findByRole('heading', { level: 1 });

        const trigger = screen.getByRole('button', { name: 'columnsToggle' });
        expect(trigger).toHaveAttribute('aria-expanded', 'false');

        await userEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(await screen.findByRole('checkbox', { name: 'colChats' })).toBeInTheDocument();

        await userEvent.keyboard('{Escape}');
        await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
        expect(screen.queryByRole('checkbox', { name: 'colChats' })).toBeNull();
    });

    it('adds exactly one column per box ticked', async () => {
        // ORACLE: the pre-migration source's own column table, read out of
        // git at the claim base (`git show
        // 3c53aa6:web/src/KBOverviewDashboard.tsx`): ALL_COLUMNS has ten
        // entries, three of them `optional: true`. With `showActions` true the
        // header therefore starts at 7 + 1 = 8 cells and each ticked box adds
        // one. The count is measured from the `columnheader` role, so it is
        // independent of how the header is built.
        render(<KBOverviewDashboard />);
        await screen.findByRole('heading', { level: 1 });
        expect(screen.getAllByRole('columnheader')).toHaveLength(8);

        await userEvent.click(screen.getByRole('button', { name: 'columnsToggle' }));
        await userEvent.click(await screen.findByRole('checkbox', { name: 'colProcessing' }));
        await waitFor(() => expect(screen.getAllByRole('columnheader')).toHaveLength(9));

        await userEvent.click(screen.getByRole('checkbox', { name: 'colChats' }));
        await waitFor(() => expect(screen.getAllByRole('columnheader')).toHaveLength(10));
    });
});

describe('KBOverviewDashboard — the shell', () => {
    it('renders the page title as the template h1, and only one of them', async () => {
        // ORACLE: the pre-migration source rendered `<h2 style={{margin: 0}}>`
        // (line 345 at the claim base). `DashboardLayout` routes `title`
        // through `PageHeader`'s `<h1>` and the level is not a prop, so the
        // level change is forced by the template. This assertion records that
        // fact so it cannot drift unnoticed — and so the open question about
        // AdminUI's own <h1> stays attached to something executable.
        const { container } = render(<KBOverviewDashboard />);
        await waitFor(() => expect(container.querySelectorAll('h1')).toHaveLength(1));
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('adminTabKbOverview');
        expect(container.querySelectorAll('h2')).toHaveLength(0);
    });

    it('keeps the search field a labelled text input', async () => {
        // ORACLE: @testing-library's accessible-name computation (a
        // third-party implementation of the ARIA algorithm).
        // `getByLabelText` deliberately does NOT match a placeholder, so this
        // fails if the `aria-label` the pre-migration source carried (line
        // 352) was dropped in the move into `ListToolbar`.
        render(<KBOverviewDashboard />);
        await screen.findByRole('heading', { level: 1 });

        const search = screen.getByLabelText('kbSearchPlaceholder');
        expect(search.tagName.toLowerCase()).toBe('input');
        expect(search).toHaveAttribute('type', 'text');

        await userEvent.type(search, 'zzz-no-such-kb');
        // Filtering still works: the one row disappears and the table's own
        // empty row takes its place.
        await waitFor(() => expect(screen.queryByText('Alpha KB')).toBeNull());
        expect(screen.getByText('kbNoKnowledgeBases')).toBeInTheDocument();
    });

    it('renders exactly one raw <input> — the search field', async () => {
        // ORACLE: the census of the pre-migration source, from git: 3 raw
        // <input> (search at 347, the three-times-rendered column checkbox at
        // 386, auto-refresh at 398) and 5 raw <button>. After the migration
        // only the search field is a raw input; both booleans are Radix
        // checkboxes, and Radix renders its hidden native input only inside a
        // <form>, of which this page has none.
        const { container } = render(<KBOverviewDashboard />);
        await screen.findByRole('heading', { level: 1 });

        expect(container.querySelectorAll('input')).toHaveLength(1);
        expect(container.querySelectorAll('input[type="text"]')).toHaveLength(1);
    });

    it('renders no required/min/max/step attribute', async () => {
        // ORACLE: card KI-710's measured rule — a native constraint on a DS
        // control lands on a visually hidden input, where the browser refuses
        // to submit with no bubble. This page has no form and must have no
        // constraint.
        const { container } = render(<KBOverviewDashboard />);
        await screen.findByRole('heading', { level: 1 });

        expect(container.querySelectorAll('[required]')).toHaveLength(0);
        expect(container.querySelectorAll('[min], [max], [step]')).toHaveLength(0);
    });

    it('resolves every aria-describedby IDREF to a real element', async () => {
        // ORACLE: WAI-ARIA 1.2 — an `aria-describedby` reference that resolves
        // to nothing is silently dropped by assistive technology (the KI-692
        // defect class). Checked with the popover OPEN, because that is where
        // the DS wiring is densest.
        render(<KBOverviewDashboard />);
        await screen.findByRole('heading', { level: 1 });
        await userEvent.click(screen.getByRole('button', { name: 'columnsToggle' }));
        await screen.findByRole('checkbox', { name: 'colChats' });

        const described = Array.from(document.querySelectorAll('[aria-describedby]'));
        for (const el of described) {
            for (const id of el.getAttribute('aria-describedby')!.split(/\s+/).filter(Boolean)) {
                expect(document.getElementById(id), `aria-describedby="${id}" resolves to nothing`).not.toBeNull();
            }
        }
    });
});

describe('KBOverviewDashboard — Stage 5 territory is untouched', () => {
    it('leaves the overview as raw table markup', async () => {
        // ORACLE: the pre-migration source's one `<table>` with `<thead>` and
        // `<tbody>` (lines 440-548 at the claim base). Card KI-694 migrates it
        // to `Table`/`TableLayout`; a premature swap changes these counts.
        const { container } = render(<KBOverviewDashboard />);
        await screen.findByRole('heading', { level: 1 });

        expect(container.querySelectorAll('table')).toHaveLength(1);
        expect(container.querySelectorAll('thead')).toHaveLength(1);
        expect(container.querySelectorAll('tbody')).toHaveLength(1);
    });

    it('keeps the row actions addressable by their accessible names', async () => {
        // ORACLE: the `aria-label`/`title` strings in the pre-migration source
        // (lines 509, 520, 531), which this card must preserve — the controls
        // changed from raw <button> to the DS Button INSIDE the untouched
        // <td>, so the swap must be invisible from the outside. The existing
        // actions suite keys on the same names.
        render(<KBOverviewDashboard />);
        await screen.findByRole('heading', { level: 1 });

        const row = screen.getByText('Alpha KB').closest('tr')!;
        expect(within(row).getByRole('button', { name: 'kbActionPublish' })).toBeInTheDocument();
        expect(within(row).getByRole('button', { name: 'kbActionTransfer' })).toBeInTheDocument();
        expect(within(row).getByRole('button', { name: 'kbActionDelete' })).toBeInTheDocument();
    });
});
