import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import Dashboard from './Dashboard';

/* ---------------------------------------------------------------------------
 * Card KI-714 (Stage 4b) replaced this page's hand-built outer shell with the
 * design system's `DashboardLayout` TEMPLATE, swapped five raw <button>s for
 * DS controls, and replaced a hand-rolled date-range dropdown with the DS
 * `Select`. Nothing covered any of it — this file had no test at all.
 *
 * Every test names its oracle, and every oracle is an artifact other than this
 * component:
 *   - a control census of the PRE-migration source, read out of git at the
 *     card's claim base (`git show 3c53aa6:web/src/Dashboard.tsx`);
 *   - the HTML Living Standard, through jsdom (heading semantics, the
 *     constraint-validation algorithm, the labelable-element set);
 *   - WAI-ARIA (`aria-describedby` IDREF resolution, the `combobox` role Radix
 *     gives the Select trigger).
 *
 * What is deliberately NOT here: anything about spacing, colour or the
 * template's own layout. That is what the browser stories
 * (Dashboard.stories.tsx) measure with the real stylesheet, and what only the
 * developer's both-theme pass can accept.
 * ------------------------------------------------------------------------- */

vi.mock('axios', () => ({
    default: { get: vi.fn() },
}));

const mockedGet = axios.get as unknown as Mock;

/** Minimal populated response; the shape is the endpoint's, not the code's. */
const ANALYTICS = {
    files: {
        byType: [{ type: 'application/pdf', count: 4, totalSize: 4096 }],
        byStatus: [{ status: 'completed', count: 4 }],
        byOrigin: [{ origin: 'upload', count: 4 }],
        totalFiles: 4,
        totalSize: 4096,
    },
    activity: {
        filesOverTime: [{ date: '2026-09-01', count: 4 }],
        chatsOverTime: [{ date: '2026-09-01', count: 2 }],
        messagesOverTime: [{ date: '2026-09-01', count: 9 }],
    },
    chats: {
        totalChats: 2,
        totalMessages: 9,
        messagesByRole: [{ role: 'user', count: 5 }, { role: 'assistant', count: 4 }],
        avgMessagesPerChat: 4.5,
    },
    generatedContent: { byType: [{ type: 'summary', count: 1 }], totalGenerated: 1, overTime: [] },
};

const QUALITY = {
    feedbackStats: [{ feedback: 'positive', count: 3 }, { feedback: 'none', count: 6 }],
    scoreOverTime: [{ day: '2026-09-01', avgScore: 0.62, messageCount: 9 }],
    lowScoreQueries: [
        { id: 'q1', content: 'Fixture-Anfrage', createdAt: '2026-09-01T10:00:00Z', avgScore: 0.19 },
    ],
};

/** Both endpoints answer; `quality` decides whether the optional one does. */
function mockAnalytics({ quality = true }: { quality?: boolean } = {}) {
    mockedGet.mockImplementation((url: string) => {
        if (url.includes('/retrieval-quality')) {
            return quality ? Promise.resolve({ data: QUALITY }) : Promise.reject(new Error('404'));
        }
        return Promise.resolve({ data: ANALYTICS });
    });
}

function renderDashboard() {
    return render(<Dashboard kbId="kb-fixture" kbName="Fixture-KB" />);
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('Dashboard — the template supplies the page heading', () => {
    it('renders exactly one <h1>, named by the template title', async () => {
        // ORACLE: the pre-migration source at the claim base
        // (`git show 3c53aa6:web/src/Dashboard.tsx`) contained exactly one
        // heading element, `<h1 …>Dashboard</h1>` at line 295, plus one <h3>
        // inside ChartCard. The template must preserve that: unlike
        // `AuthLayout`, whose title lands in a `CardTitle` <div>,
        // `DashboardLayout` routes it through `PageHeader`'s real <h1> — but
        // the level is the TEMPLATE's decision, not a prop, so a change on
        // that side would silently move the page's only top-level heading.
        // Heading role/level resolution is @testing-library's implementation
        // of the ARIA mapping, not this repo's.
        mockAnalytics();
        const { container } = renderDashboard();
        await waitFor(() => expect(container.querySelectorAll('h1')).toHaveLength(1));

        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Dashboard');
        // The KB name is the description slot, not a second heading.
        expect(screen.getByText('Fixture-KB').tagName.toLowerCase()).toBe('p');
    });
});

describe('Dashboard — control census', () => {
    it('keeps the two header controls the pre-migration source had', async () => {
        // ORACLE: the census of the pre-migration file, taken from git and so
        // independent of the code under test. `git show
        // 3c53aa6:web/src/Dashboard.tsx` had 5 raw <button>s and 0 raw
        // <input>s. In the LOADED state exactly two of those five were on the
        // page — the date-range trigger (line 306) and the refresh button
        // (line 368); the other three are the four range options inside the
        // dropdown panel (only when open) and the error-state retry (line
        // 257). The migration must therefore still expose two, and only two,
        // controls in the header.
        mockAnalytics();
        const { container } = renderDashboard();
        await screen.findByRole('heading', { level: 1 });

        expect(container.querySelectorAll('button')).toHaveLength(2);
        // Radix gives the Select trigger role="combobox"; it is still a
        // <button> element, which is why it counts above.
        expect(screen.getByRole('combobox', { name: 'Zeitraum' }).tagName.toLowerCase()).toBe('button');
        expect(screen.getByRole('button', { name: 'Aktualisieren' })).toBeInTheDocument();
        // No raw <input> before, none after.
        expect(container.querySelectorAll('input')).toHaveLength(0);
    });

    it('renders one region per ChartCard call site', async () => {
        // ORACLE: the pre-migration source had 9 `<ChartCard …>` call sites —
        // six unconditional and three gated on the optional retrieval-quality
        // response — and each wraps its body in `role="img"` with the title as
        // the accessible name. Counting the ARIA regions rather than the DOM
        // nodes means the assertion survives the Card/CardHeader/CardContent
        // swap while still failing if a panel was dropped.
        mockAnalytics();
        renderDashboard();
        await screen.findByRole('heading', { level: 1 });

        await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(9));
    });

    it('drops exactly the three optional panels when retrieval quality is unavailable', async () => {
        // ORACLE: the same census, minus the three quality-gated call sites
        // (`Feedback-Verteilung`, `Retrieval-Score im Zeitverlauf`, `Niedrig
        // bewertete Anfragen …`). The component swallows the failure by
        // design; what the count pins is that it swallows it without taking
        // any of the six required panels with it.
        mockAnalytics({ quality: false });
        renderDashboard();
        await screen.findByRole('heading', { level: 1 });

        await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(6));
        expect(screen.queryByRole('img', { name: 'Feedback-Verteilung' })).toBeNull();
    });
});

describe('Dashboard — Stage 5 territory is untouched', () => {
    it('leaves the low-score table as raw table markup', async () => {
        // ORACLE: the pre-migration source's one `<table>` (line 680) with its
        // `<thead>`/`<tbody>` and three `<th>`. Card KI-714 is the outer page
        // shell only; Stage 5 (KI-694) migrates this to `Table`/`TableLayout`.
        // A premature swap to the DS Table would change these counts.
        mockAnalytics();
        const { container } = renderDashboard();
        await screen.findByRole('heading', { level: 1 });

        await waitFor(() => expect(container.querySelectorAll('table')).toHaveLength(1));
        expect(container.querySelectorAll('thead')).toHaveLength(1);
        expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    });

    it('keeps the 280px scroll box that bounds the table, and keeps it wrapping the table', async () => {
        // ORACLE: line 679 of the pre-migration source, verbatim —
        //   <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
        // read out of git, not out of this file. The card names this style
        // explicitly: it is the only thing bounding that block's growth, and
        // Stage 5 needs it alive so it can move it onto `Table`'s
        // `containerClassName`. Deleting it while removing the other inline
        // styles is the specific regression this test exists to catch, so the
        // assertion is on the two declared values AND on the box still being
        // the table's ancestor (a surviving style on the wrong element bounds
        // nothing).
        mockAnalytics();
        const { container } = renderDashboard();
        await screen.findByRole('heading', { level: 1 });

        const table = await waitFor(() => {
            const t = container.querySelector('table');
            expect(t).not.toBeNull();
            return t!;
        });

        const box = table.parentElement as HTMLElement;
        expect(box.style.maxHeight).toBe('280px');
        expect(box.style.overflowY).toBe('auto');
    });
});

describe('Dashboard — no native constraint validation anywhere', () => {
    it('renders no required/min/max/step attribute', async () => {
        // ORACLE: the rule card KI-710 measured — a `required`/`min`/`max`/
        // `step` constraint on a DS control can land on a visually hidden
        // native input, where Chrome refuses to submit and has nowhere to show
        // its bubble ("An invalid form control … is not focusable", no
        // bubble). This page adds no numeric field, so the correct count is
        // zero, and the check is cheap insurance against a later one.
        mockAnalytics();
        const { container } = renderDashboard();
        await screen.findByRole('heading', { level: 1 });

        expect(container.querySelectorAll('[required]')).toHaveLength(0);
        expect(container.querySelectorAll('[min], [max], [step]')).toHaveLength(0);
    });

    it('resolves every aria-describedby IDREF to a real element', async () => {
        // ORACLE: WAI-ARIA 1.2 — `aria-describedby` is an ID reference LIST
        // and every reference must resolve to an element in the same document;
        // a dangling reference is silently dropped by assistive technology.
        // This is the KI-692 defect class, and DS components (FormControl,
        // Select) set the attribute themselves, so the call site cannot assume
        // it is clean.
        mockAnalytics();
        const { container } = renderDashboard();
        await screen.findByRole('heading', { level: 1 });

        // Guard against a vacuous pass: the page must actually have rendered.
        expect(container.querySelectorAll('button').length).toBeGreaterThan(0);

        for (const el of Array.from(container.querySelectorAll('[aria-describedby]'))) {
            for (const id of el.getAttribute('aria-describedby')!.split(/\s+/).filter(Boolean)) {
                expect(document.getElementById(id), `aria-describedby="${id}" resolves to nothing`).not.toBeNull();
            }
        }
    });
});

describe('Dashboard — the date range still drives the request', () => {
    it('sends a `from` 30 days back on first load', async () => {
        // ORACLE: arithmetic done here, not by the component — the default
        // range is '30d' and the pre-migration source computed
        // `now - 30 * 24 * 60 * 60 * 1000`. The assertion allows a few seconds
        // of clock drift between the component's `new Date()` and this one,
        // and would fail outright for 7d (7 days off) or for a dropped
        // parameter.
        mockAnalytics();
        renderDashboard();
        await screen.findByRole('heading', { level: 1 });

        const url = mockedGet.mock.calls.find(([u]) => !String(u).includes('/retrieval-quality'))![0] as string;
        const from = new URL(url, 'http://localhost').searchParams.get('from');
        expect(from).not.toBeNull();

        const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
        expect(Math.abs(new Date(from!).getTime() - expected)).toBeLessThan(10_000);
    });
});
