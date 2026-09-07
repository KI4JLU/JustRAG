import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import AdminEvalTab from './AdminEvalTab';
import { translations } from '../../translations';

/* ---------------------------------------------------------------------------
 * This suite exists because of the design-system migration of this file (board
 * card KI-692). The file had NO test before, so the migration's two load-bearing
 * claims had no oracle at all:
 *
 *   1. the label/control pairing, which moved from hand-written `id`/`htmlFor`
 *      pairs to <FormControl>'s injected id (every explicit id was dropped —
 *      `eval-label`, `eval-kb-id`, `eval-golden-set`, `eval-team-id`,
 *      `eval-topk`, `eval-judge`, `gen-kb-id`, `gen-name`, `gen-lang`), and
 *   2. the request bodies, because the controls that produce them changed type:
 *      a native checkbox became a Radix Checkbox (`onCheckedChange`), four
 *      native selects became Radix listboxes (`onValueChange`), and the number
 *      fields now go through the DS Input.
 *
 * Every test below names its own oracle. None of them asserts a number this
 * component produced — the oracles are the HTML spec (via jsdom), WAI-ARIA, the
 * Go request DTOs in go-backend/internal/admineval, Radix's own documented
 * placeholder rule, and a control census taken from the PRE-migration source at
 * the card's claim base (4a40861).
 * ------------------------------------------------------------------------- */

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

const tMock = (key: string) => {
    const entry = translations[key as keyof typeof translations];
    return entry ? entry.en : key;
};
const themeMock = { t: tMock };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => toastMock }));
vi.mock('../../hooks/useReducedMotion', () => ({
    useReducedMotion: () => false,
    getMotionProps: () => ({}),
}));
// The team dropdown's data source. It only fetches once a KB is in play, and
// the teams themselves are another component's concern.
type KbAgentsResult = { agents: never[]; teams: { id: string; name: string }[] };
const fetchKbAgentsMock = vi.fn<(kbId: string) => Promise<KbAgentsResult>>();
vi.mock('../agents/api', () => ({ fetchKbAgents: (kbId: string) => fetchKbAgentsMock(kbId) }));

/**
 * Radix's Select trigger measures and captures pointers; jsdom implements
 * neither. Same treatment the Radix docs prescribe for jsdom — it enables
 * opening the listbox with a click, nothing more.
 */
beforeEach(() => {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
});

const GOLDEN_SETS = [
    {
        id: 'gs-1',
        name: 'baseline',
        description: '',
        content_hash: 'abcdef012345678',
        question_count: 89,
        created_at: '2026-01-02T10:00:00Z',
    },
    {
        id: 'gs-2',
        name: 'draft-set',
        description: 'auto-generated from corpus',
        content_hash: '0011223344556677',
        question_count: 40,
        created_at: '2026-01-03T10:00:00Z',
    },
];

// Two COMPLETED runs: `otherRuns` in RunRow is non-empty for each of them, so
// the compare disclosure renders — and no run is queued/running, so the
// component's 5s poll interval never starts.
const RUNS = [
    {
        id: 'run-aaaaaaaa',
        label: 'first',
        status: 'completed' as const,
        created_at: '2026-01-02T10:00:00Z',
        started_at: '2026-01-02T10:00:00Z',
        finished_at: '2026-01-02T10:05:00Z',
        kb_id: 'kb-1111',
        kb_name: 'Handbuch',
        judge_enabled: true,
        route_mean_recall: { lookup: 0.5 },
    },
    {
        id: 'run-bbbbbbbb',
        label: 'second',
        status: 'completed' as const,
        created_at: '2026-01-03T10:00:00Z',
        started_at: '2026-01-03T10:00:00Z',
        finished_at: '2026-01-03T10:04:00Z',
        kb_id: 'kb-1111',
        kb_name: 'Handbuch',
        judge_enabled: false,
    },
];

beforeEach(() => {
    vi.clearAllMocks();
    fetchKbAgentsMock.mockResolvedValue({ agents: [], teams: [] });
    mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('/golden-sets/jobs')) return Promise.resolve({ data: { jobs: [] } });
        if (url.includes('/golden-sets')) return Promise.resolve({ data: { golden_sets: GOLDEN_SETS } });
        if (url.includes('/runs')) return Promise.resolve({ data: { runs: RUNS, total: 2 } });
        return Promise.resolve({ data: {} });
    });
});

/** Admin scope (no kbId): both kb_id fields and every section are rendered. */
async function renderTab(props: { kbId?: string } = {}) {
    const result = render(<AdminEvalTab {...props} />);
    // The three mount fetches resolve before anything is asserted.
    await screen.findByText('baseline');
    return result;
}

describe('AdminEvalTab — label/control pairing', () => {
    it('resolves every label to a real, labelable control', async () => {
        // ORACLE: the HTML specification, applied by jsdom. `label[for]` must
        // name an element that exists and is labelable (button, input, meter,
        // output, progress, select, textarea). Before the migration this held
        // only because the hand-written id/htmlFor pairs happened to agree —
        // and four fields had no label at all. Now FormControl injects the id,
        // and this asserts the result rather than trusting it.
        const { container } = await renderTab();

        const labels = Array.from(container.querySelectorAll('label[for]'));
        // 4 generate-counts + label + kb-id + golden-set + top-k + judge = 9.
        expect(labels).toHaveLength(9);

        const LABELABLE = ['BUTTON', 'INPUT', 'METER', 'OUTPUT', 'PROGRESS', 'SELECT', 'TEXTAREA'];
        const broken = labels
            .map(l => {
                const id = l.getAttribute('for')!;
                const target = container.querySelector(`[id="${CSS.escape(id)}"]`);
                if (!target) return `${l.textContent?.trim()} -> #${id} (no such element)`;
                if (!LABELABLE.includes(target.tagName)) {
                    return `${l.textContent?.trim()} -> <${target.tagName.toLowerCase()}> (not labelable)`;
                }
                return null;
            })
            .filter(Boolean);

        expect(broken).toEqual([]);
    });

    it('leaves no aria-describedby pointing at a missing element', async () => {
        // ORACLE: WAI-ARIA — an aria-describedby IDREF must resolve. The DS
        // FormControl sets it unconditionally, so a row rendered without help
        // text has to clear it; that is FieldRow's describedBy() and this is
        // the check on it.
        const { container } = await renderTab();

        const dangling = Array.from(container.querySelectorAll('[aria-describedby]'))
            .flatMap(el =>
                el
                    .getAttribute('aria-describedby')!
                    .split(/\s+/)
                    .filter(id => id && !container.querySelector(`[id="${CSS.escape(id)}"]`))
                    .map(id => `${el.tagName.toLowerCase()} -> #${id}`),
            );

        expect(dangling).toEqual([]);
    });

    it('gives every field an accessible name, including the four that had none', async () => {
        // ORACLE: WCAG 4.1.2 / 2.5.3 — a placeholder is not an accessible name.
        // The three inline fields in "generate from corpus" and the three in the
        // upload row carried a placeholder only, and the language select carried
        // nothing at all; the pre-migration source is the record of that.
        await renderTab();

        // Three fields end up named "KB ID": the generate row and the upload
        // row (both previously placeholder-only, now aria-labelled) plus the
        // kick-off form's row, whose visible label always read that. DOM order
        // is generate, upload, kick-off — which is what the index lookups in the
        // request-body tests below rely on.
        expect(screen.getAllByRole('textbox', { name: tMock('evalKbId') })).toHaveLength(3);
        expect(screen.getByRole('textbox', { name: tMock('evalGenName') })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: tMock('evalGoldenSetName') })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: tMock('evalGoldenSetDescription') })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: tMock('evalGenLang') })).toBeInTheDocument();
    });
});

describe('AdminEvalTab — control census', () => {
    it('renders one control per row, of the right kind', async () => {
        // ORACLE: a census of the PRE-migration source at the card's claim base
        // (`git show 4a40861:web/src/components/admin/AdminEvalTab.tsx`), which
        // is the artifact eslint-suppressions.json counted 29 hits in:
        //   14 raw <input> = 1 checkbox + 5 number + 7 text + 1 file
        //   +  5 raw <select>
        //   + 15 raw <button>
        // With this fixture (admin scope, 2 golden sets, 2 completed runs, no
        // in-flight generation job, compare panel closed) the rendered instances
        // of those code sites are:
        //   number : 4 generate-counts + top-k                        = 5
        //   text   : 2 × kb_id + gen name + upload name + description  = 5
        //            (the 2 remaining text sites are the kick-off label and
        //             kb-id rows, so 7 in total)
        //   file   : 1
        //   checkbox (judge)                                           = 1
        //   combobox: language + golden set + status filter             = 3
        //            (team select hidden: no teams; compare picker closed)
        const { container } = await renderTab();

        expect(container.querySelectorAll('input[type="number"]')).toHaveLength(5);
        expect(container.querySelectorAll('input[type="text"]')).toHaveLength(7);
        expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1);
        // Radix Checkbox renders role="checkbox" on a <button>; count the role.
        expect(container.querySelectorAll('[role="checkbox"]')).toHaveLength(1);
        // Radix Select's trigger is role="combobox".
        expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(3);
    });

    it('keeps every raw <button> out of the tab', async () => {
        // ORACLE: the design-system rule this card burns down — this file's 29
        // entries leave web/eslint-suppressions.json, which is only true if no
        // raw <button> survives. Every <button> in the tree must now come from
        // the DS, observable as a class from the DS Button's base recipe or as a
        // Radix control's role.
        //
        // The marker is `active:scale-95`, NOT the `rounded-action` that
        // AdminAgentTab.test.tsx uses: this tab is full of icon-only buttons,
        // and `size="icon"` adds `rounded-full`, which tailwind-merge resolves
        // by DROPPING `rounded-action` from the class list. `active:scale-95`
        // has no conflicting utility and therefore survives every variant.
        const { container } = await renderTab();

        const strays = Array.from(container.querySelectorAll('button')).filter(b => {
            if (b.getAttribute('role') === 'checkbox') return false; // DS Checkbox
            if (b.getAttribute('role') === 'combobox') return false; // DS SelectTrigger
            return !b.className.split(/\s+/).includes('active:scale-95'); // DS Button
        });

        expect(strays.map(b => b.getAttribute('aria-label') || b.textContent?.trim())).toEqual([]);
    });

    it('leaves the run-history and golden-set tables as raw <table> markup', async () => {
        // ORACLE: the card's own scope split — the DS TableLayout migration is
        // Stage 5 (KI-694), so this file still has to contain exactly the two
        // <table>s the pre-migration source had. This is a scope marker, not an
        // endorsement: Stage 5 deletes it.
        const { container } = await renderTab();
        expect(container.querySelectorAll('table')).toHaveLength(2);
    });
});

describe('AdminEvalTab — the golden-set select', () => {
    it('shows the prompt as the trigger placeholder while nothing is selected', async () => {
        // ORACLE: Radix's own rule (@radix-ui/react-select 2.3.7,
        // `shouldShowPlaceholder(value) => value === "" || value === undefined`).
        // That is why the pre-migration `<option value="">Pick a golden set…`
        // became the trigger's placeholder instead of a listed item: an item with
        // value '' could never be displayed on the trigger.
        await renderTab();
        expect(screen.getByRole('combobox', { name: tMock('evalGoldenSet') }))
            .toHaveTextContent(tMock('evalPickGoldenSet'));
    });

    it('keeps the required flag the native select carried', async () => {
        // ORACLE: the pre-migration source — `<select id="eval-golden-set" …
        // required>`. Radix surfaces it on the trigger as aria-required (and on
        // its hidden native select, so browser constraint validation survives).
        await renderTab();
        expect(screen.getByRole('combobox', { name: tMock('evalGoldenSet') }))
            .toHaveAttribute('aria-required', 'true');
    });

    it('enables the run button only once a set is picked, and posts its id', async () => {
        // ORACLE: two independent artifacts.
        //   * the pre-migration source for the gate:
        //     `disabled={kickOffLoading || hasInFlight || !selectedGoldenSetId}`
        //   * go-backend/internal/admineval/types.go for the body:
        //     CreateRunRequest{ GoldenSetID *uuid.UUID `json:"golden_set_id"`,
        //     JudgeEnabled *bool, TopK *int, Label string } — so golden_set_id
        //     is a string id, judge_enabled a JSON boolean and top_k a NUMBER.
        //     A DS control that stringified top_k would 400 against that DTO.
        mockedAxios.post.mockResolvedValue({ data: { id: 'run-new' } });
        await renderTab();

        const runButton = screen.getByRole('button', { name: new RegExp(tMock('evalKickOff'), 'i') });
        expect(runButton).toBeDisabled();

        await userEvent.click(screen.getByRole('combobox', { name: tMock('evalGoldenSet') }));
        await userEvent.click(await screen.findByRole('option', { name: /baseline/ }));

        expect(screen.getByRole('combobox', { name: tMock('evalGoldenSet') })).toHaveTextContent('baseline');
        expect(screen.getByRole('button', { name: new RegExp(tMock('evalKickOff'), 'i') })).toBeEnabled();

        await userEvent.click(screen.getByRole('button', { name: new RegExp(tMock('evalKickOff'), 'i') }));

        await waitFor(() => expect(mockedAxios.post).toHaveBeenCalled());
        const [url, body] = mockedAxios.post.mock.calls[0];
        expect(url).toContain('/api/admin/eval/runs');
        expect(body).toMatchObject({ golden_set_id: 'gs-1', judge_enabled: true, top_k: 10 });
        expect(typeof (body as { top_k: unknown }).top_k).toBe('number');
        expect(typeof (body as { judge_enabled: unknown }).judge_enabled).toBe('boolean');
    });
});

describe('AdminEvalTab — judge mode', () => {
    it('is a checkbox, not a switch, and reports its state through aria-checked', async () => {
        // ORACLE: the decided rule recorded in CONTRIBUTING.md ("a staged
        // boolean is a Checkbox, never a Switch") plus the ARIA checkbox
        // pattern. The value is staged until "Run eval" is pressed — a Switch
        // would claim it already applies.
        await renderTab();

        const judge = screen.getByRole('checkbox', { name: tMock('evalJudge') });
        expect(judge).toHaveAttribute('aria-checked', 'true'); // useState(true)
        expect(screen.queryByRole('switch')).not.toBeInTheDocument();

        await userEvent.click(judge);
        expect(screen.getByRole('checkbox', { name: tMock('evalJudge') })).toHaveAttribute('aria-checked', 'false');
        // The judge warning is rendered from the same state, so it disappears.
        expect(screen.queryByText(tMock('evalJudgeWarning'))).not.toBeInTheDocument();
    });

    it('does not submit the form when the checkbox is toggled', async () => {
        // ORACLE: HTML form semantics. The DS Checkbox and SelectTrigger are
        // <button>s inside the <form>; one that defaulted to type="submit" would
        // kick off an eval run on every click. Radix sets type="button".
        mockedAxios.post.mockResolvedValue({ data: { id: 'x' } });
        await renderTab();

        await userEvent.click(screen.getByRole('checkbox', { name: tMock('evalJudge') }));
        expect(mockedAxios.post).not.toHaveBeenCalled();
    });
});

describe('AdminEvalTab — generate from corpus', () => {
    it('keeps the numeric bounds and posts the counts as numbers', async () => {
        // ORACLE: two artifacts again.
        //   * the pre-migration source: every count input had `min={0} max={200}`
        //     (they have to survive FormControl's Slot merge — a Slot that
        //     dropped unknown props would silently remove range validation)
        //   * go-backend/internal/admineval/generate_handler.go:
        //     `Counts struct { Lookup int; Complex int; Enumeration int;
        //     MultiHop int }` and `Lang string` — ints, so a stringified count
        //     would 400.
        mockedAxios.post.mockResolvedValue({ data: { job_id: 'job-1' } });
        await renderTab();

        const lookup = screen.getByLabelText(tMock('evalGenLookup'));
        expect(lookup).toHaveAttribute('min', '0');
        expect(lookup).toHaveAttribute('max', '200');

        fireEvent.change(lookup, { target: { value: '7' } });
        fireEvent.change(screen.getAllByRole('textbox', { name: tMock('evalKbId') })[0], {
            target: { value: 'kb-42' },
        });
        fireEvent.change(screen.getByRole('textbox', { name: tMock('evalGenName') }), {
            target: { value: 'fresh-set' },
        });

        await userEvent.click(screen.getByRole('button', { name: tMock('evalGenButton') }));

        await waitFor(() => expect(mockedAxios.post).toHaveBeenCalled());
        const [url, body] = mockedAxios.post.mock.calls[0];
        expect(url).toContain('/golden-sets/generate');
        expect(body).toMatchObject({
            kb_id: 'kb-42',
            name: 'fresh-set',
            lang: 'de',
            counts: { lookup: 7, complex: 10, enumeration: 5, multihop: 5 },
        });
        const counts = (body as { counts: Record<string, unknown> }).counts;
        for (const [k, v] of Object.entries(counts)) {
            expect(typeof v, `counts.${k}`).toBe('number');
        }
    });
});

describe('AdminEvalTab — golden-set upload', () => {
    it('posts the multipart fields and clears the file field afterwards', async () => {
        // ORACLE: the Go handler's multipart contract —
        // go-backend/internal/admineval/handler.go reads FormValue("name"),
        // FormValue("description"), FormValue("kb_id") and FormFile("file").
        // The clearing half is the reason this test matters for the migration:
        // the file field is the one control the component holds a ref to
        // (`fileInputRef.current.value = ''`), so it proves the DS Input still
        // forwards its ref to the underlying <input>.
        mockedAxios.post.mockResolvedValue({ data: { id: 'gs-3' } });
        await renderTab();

        const file = new File(['{"q":"x"}\n'], 'fixture.jsonl', { type: 'application/x-ndjson' });
        const fileField = screen.getByLabelText(tMock('evalGoldenSetUpload')) as HTMLInputElement;
        await userEvent.upload(fileField, file);
        expect(fileField.files?.[0]).toBe(file);

        fireEvent.change(screen.getByRole('textbox', { name: tMock('evalGoldenSetName') }), {
            target: { value: 'uploaded-set' },
        });
        fireEvent.change(screen.getAllByRole('textbox', { name: tMock('evalKbId') })[1], {
            target: { value: 'kb-9' },
        });

        await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${tMock('evalGoldenSetUpload')}$`) }));

        await waitFor(() => expect(mockedAxios.post).toHaveBeenCalled());
        const [url, body] = mockedAxios.post.mock.calls[0];
        expect(url).toContain('/golden-sets');
        const form = body as FormData;
        expect(form).toBeInstanceOf(FormData);
        expect(form.get('name')).toBe('uploaded-set');
        expect(form.get('kb_id')).toBe('kb-9');
        expect(form.get('file')).toBe(file);

        await waitFor(() => expect(fileField.value).toBe(''));
    });
});

describe('AdminEvalTab — KB-scoped mode', () => {
    it('hides both kb_id fields and offers the KB\'s teams', async () => {
        // ORACLE: the component's documented prop contract ("When set, the tab
        // is KB-scoped: kb_id pickers are hidden and kb_id is taken from the
        // path") plus the pre-migration source's `{!kbId && …}` guards. This is
        // the path KbSettingsPanel renders, and it is the only one that reaches
        // the team select — whose empty option means "standard, no team" and is
        // therefore a LISTED item as well as the placeholder.
        fetchKbAgentsMock.mockResolvedValue({ agents: [], teams: [{ id: 'team-1', name: 'Recht' }] });
        await renderTab({ kbId: 'kb-1111' });

        expect(fetchKbAgentsMock).toHaveBeenCalledWith('kb-1111');
        // All three "KB ID" fields are behind `{!kbId && …}` guards, so none of
        // them renders here.
        expect(screen.queryAllByRole('textbox', { name: tMock('evalKbId') })).toHaveLength(0);

        const teamSelect = await screen.findByRole('combobox', { name: tMock('evalTeamLabel') });
        expect(teamSelect).toHaveTextContent(tMock('evalTeamStandard'));

        await userEvent.click(teamSelect);
        expect((await screen.findAllByRole('option')).map(o => o.textContent)).toEqual([
            tMock('evalTeamStandard'),
            'Recht',
        ]);
    });
});

describe('AdminEvalTab — run history', () => {
    it('marks the compare control as a disclosure, not a toggle button', async () => {
        // ORACLE: the ARIA authoring practices' disclosure pattern —
        // aria-expanded, and NOT aria-pressed (a control must not claim to be
        // both a toggle button and a disclosure; a screen reader would announce
        // "pressed" and "expanded"). The DS ghost variant tints on
        // aria-pressed, which is why the open-state look is driven off Radix's
        // non-ARIA `data-state` instead. Same decision as KI-691.
        await renderTab();

        const [compare] = screen.getAllByRole('button', { name: tMock('evalCompareWith') });
        expect(compare).toHaveAttribute('aria-expanded', 'false');
        expect(compare).not.toHaveAttribute('aria-pressed');

        await userEvent.click(compare);
        // Asserted on the node captured before the click, not via a fresh role
        // query: the revealed picker is a Radix Select rendered `open`, and
        // Radix hides the rest of the document from AT (`aria-hidden`) while a
        // listbox is open, so nothing outside it is role-queryable.
        expect(compare).toHaveAttribute('aria-expanded', 'true');
        expect(compare).toHaveAttribute('data-state', 'open');
        expect(compare).not.toHaveAttribute('aria-pressed');
        // The revealed picker opens straight into its list (that is what the
        // pre-migration `autoFocus` was for) and offers exactly the OTHER
        // completed run — `otherRuns` filters out the row's own id.
        const options = screen.getAllByRole('option');
        expect(options.map(o => o.textContent)).toEqual(['second']);
    });

    it('gives every icon-only action an accessible name', async () => {
        // ORACLE: WCAG 4.1.2. Pre-migration these three carried a `title` only,
        // which is not a reliable accessible name for AT; the aria-labels are
        // new, and every run row has to have all three.
        await renderTab();

        expect(screen.getAllByRole('button', { name: tMock('evalExportSingle') })).toHaveLength(RUNS.length);
        expect(screen.getAllByRole('button', { name: tMock('evalCompareWith') })).toHaveLength(RUNS.length);
        expect(screen.getAllByRole('button', { name: tMock('delete') }).length).toBeGreaterThanOrEqual(RUNS.length);
    });
});
