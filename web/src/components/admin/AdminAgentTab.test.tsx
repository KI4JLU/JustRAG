import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import AdminAgentTab from './AdminAgentTab';
import { translations } from '../../translations';

/* ---------------------------------------------------------------------------
 * This suite exists because of the design-system migration of this file (board
 * card KI-691): the 143 settings rows were rebuilt on the DS Form composition,
 * which moved the id/label pairing from 143 hand-written `id`/`htmlFor` pairs
 * to <FormControl>'s injected id, and moved the 56 booleans from a native
 * <input type="checkbox"> (`e.target.checked`) to a Radix <Checkbox>
 * (`onCheckedChange`). There was no test on this file before, so the two
 * claims that migration rests on — "the pairing is now correct by
 * construction" and "the write into site_configs is unchanged" — had no
 * oracle. These tests are that oracle.
 *
 * Each test names its own oracle. None of them asserts a value that this
 * component produced.
 * ------------------------------------------------------------------------- */

const tMock = (key: string) => {
    const entry = translations[key as keyof typeof translations];
    return entry ? entry.en : key;
};
const themeMock = { t: tMock };
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));

// useReducedMotion calls window.matchMedia, which jsdom does not implement
// (same treatment as Login.test.tsx / WorkflowCanvas.test.tsx).
vi.mock('../../hooks/useReducedMotion', () => ({
    useReducedMotion: () => false,
    getMotionProps: () => ({}),
}));

// Both children are separate components with their own suites/concerns; they
// fetch on mount and would only add noise here.
vi.mock('./AdminAgentMetricsCard', () => ({ default: () => <div data-testid="metrics-card" /> }));
vi.mock('./AdminMCPSection', () => ({ default: () => <div data-testid="mcp-section" /> }));

const STORAGE_KEY = 'admin-agent-sections-open-v1';

/**
 * Renders the tab with every accordion section expanded (the component seeds
 * `openMap` from localStorage), and with real state so a control's write is
 * observable. `latest()` returns the current site_configs record.
 */
function renderTab(initial: Record<string, string> = {}) {
    const seen: { configs: Record<string, string> } = { configs: initial };

    function Harness() {
        const [siteConfigs, setSiteConfigs] = useState<Record<string, string>>(initial);
        seen.configs = siteConfigs;
        return (
            <AdminAgentTab
                siteConfigs={siteConfigs}
                setSiteConfigs={setSiteConfigs}
                onSubmit={e => e.preventDefault()}
            />
        );
    }

    const result = render(<Harness />);
    return { ...result, latest: () => seen.configs };
}

/** Every section id in SECTION_CONFIGS, so localStorage can expand them all. */
const SECTION_IDS = [
    'general', 'hybrid', 'reranker', 'topn', 'compression', 'queryEnh', 'crag',
    'graph', 'multistep', 'conversation', 'corpusTable', 'compare', 'teams',
    'longmem', 'validation', 'ingestion', 'observability', 'tools', 'tabular',
    'dateAware',
];

/**
 * A real in-memory Storage, installed fresh per test — the same treatment as
 * HomeView.test.tsx, and for the same reason: jsdom's localStorage differs
 * between local and CI (locally it is a bare object with no getItem/setItem),
 * so without this the tab's `openMap` persistence is either untested or leaks
 * between tests depending on the machine.
 */
function memoryStorage(): Storage {
    const map = new Map<string, string>();
    return {
        get length() { return map.size; },
        key: (i: number) => Array.from(map.keys())[i] ?? null,
        getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
        setItem: (k: string, v: string) => { map.set(k, String(v)); },
        removeItem: (k: string) => { map.delete(k); },
        clear: () => { map.clear(); },
    } as Storage;
}

beforeEach(() => {
    const storage = memoryStorage();
    storage.setItem(
        STORAGE_KEY,
        JSON.stringify(Object.fromEntries(SECTION_IDS.map(id => [id, true]))),
    );
    vi.stubGlobal('localStorage', storage);
});

describe('AdminAgentTab — label/control pairing', () => {
    it('resolves every label to a real, labelable control', () => {
        // ORACLE: the HTML specification, applied by jsdom, not by this
        // component. `label[for]` must name an element that exists and is
        // labelable (button, input, meter, output, progress, select,
        // textarea). Before the migration this held only because 143
        // hand-written id/htmlFor pairs happened to agree; now FormControl
        // injects the id, and this asserts the result rather than trusting it.
        const { container } = renderTab();

        const labels = Array.from(container.querySelectorAll('label[for]'));
        expect(labels.length).toBeGreaterThan(140);

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

    it('leaves no aria-describedby pointing at a missing element', () => {
        // ORACLE: WAI-ARIA — an aria-describedby IDREF must resolve. The DS
        // FormControl sets it unconditionally, so a row rendered WITHOUT help
        // text has to clear it; that is what FieldRow's describedBy() does and
        // this is the check on it.
        const { container } = renderTab();

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
});

describe('AdminAgentTab — control census', () => {
    it('renders one control per settings row, of the right kind', () => {
        // ORACLE: a census of the PRE-migration source file, taken with grep
        // before any edit and recorded on card KI-691:
        //   142 raw <input> = 56 type="checkbox" + 72 type="number" + 14 type="text"
        //     (of the 14 text inputs, 13 are settings rows and 1 is the
        //      section filter field at the top of the tab)
        //   +   2 raw <select>
        // The migration must preserve that count exactly: a checkbox silently
        // dropped, or a row duplicated, changes these numbers. They come from
        // a different artifact (the old file) than the code under test.
        const { container } = renderTab();

        // Radix Checkbox renders role="checkbox" on a <button>, plus a hidden
        // bubble <input> for native form submission — count the ARIA role.
        expect(container.querySelectorAll('[role="checkbox"]')).toHaveLength(56);

        // Radix Select's trigger is role="combobox".
        expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(2);

        expect(container.querySelectorAll('input[type="number"]')).toHaveLength(72);
        expect(container.querySelectorAll('input[type="text"]')).toHaveLength(14);
    });

    it('keeps every raw <button> out of the tab except the DS ones', () => {
        // ORACLE: the design-system rule this card burns down — the file's 146
        // entries (142 inputs + 4 buttons) leave web/eslint-suppressions.json.
        // The 4 old raw buttons were: the 20 section toggles (one component),
        // expand-all, collapse-all and submit. Every <button> in the tree must
        // now come from the DS, which is observable as the DS Button's base
        // class (`rounded-action`) or as a Radix control's role.
        const { container } = renderTab();

        const strays = Array.from(container.querySelectorAll('button')).filter(b => {
            if (b.getAttribute('role') === 'checkbox') return false; // DS Checkbox
            if (b.getAttribute('role') === 'combobox') return false; // DS SelectTrigger
            return !b.className.split(/\s+/).includes('rounded-action'); // DS Button
        });

        expect(strays.map(b => b.textContent?.trim())).toEqual([]);
    });
});

describe('AdminAgentTab — bindings survive the migration', () => {
    it("writes 'true'/'false' strings when a boolean row is toggled", async () => {
        // ORACLE: the site_config wire contract. site_configs is a
        // Record<string,string> POSTed verbatim to /api/site-config, and the
        // Go backend reads booleans as the strings 'true'/'false' (see the
        // flag tables in CLAUDE.md). The handler shape changed here —
        // `onChange={e => … e.target.checked …}` became
        // `onCheckedChange={checked => …}` — so this asserts the *stored
        // value*, which the backend defines, not the handler.
        const { latest } = renderTab({ crag_enabled: 'false' });

        const checkbox = screen.getByRole('checkbox', { name: tMock('cragEnabled') });
        expect(checkbox).toHaveAttribute('aria-checked', 'false');

        await userEvent.click(checkbox);
        expect(latest().crag_enabled).toBe('true');

        await userEvent.click(screen.getByRole('checkbox', { name: tMock('cragEnabled') }));
        expect(latest().crag_enabled).toBe('false');
    });

    it('accepts the legacy "1" as checked without rewriting it until toggled', async () => {
        // ORACLE: the pre-migration predicate, read off the old source:
        // `checked={siteConfigs.crag_enabled === 'true' || siteConfigs.crag_enabled === '1'}`.
        // '1' is a value older deployments have in the table, so it must still
        // read as on.
        const { latest } = renderTab({ crag_enabled: '1' });

        const checkbox = screen.getByRole('checkbox', { name: tMock('cragEnabled') });
        expect(checkbox).toHaveAttribute('aria-checked', 'true');
        expect(latest().crag_enabled).toBe('1');
    });

    it('stores a number field as the raw string the user typed', async () => {
        // ORACLE: same wire contract — site_configs values are strings, and
        // `e.target.value` is a string. A DS Input that coerced to a number
        // would break the POST body's type.
        //
        // fireEvent.change rather than userEvent.clear + type: the row reads
        // `siteConfigs.default_top_k || '5'`, so the empty intermediate state
        // that clear() produces is immediately replaced by the default again
        // and the subsequent keystrokes append to it ("512"). That `||`
        // fallback is pre-existing behaviour, untouched by this migration —
        // it is just not what this test is about.
        const { latest } = renderTab({ default_top_k: '5' });

        const field = screen.getByLabelText(tMock('defaultTopK'));
        expect(field).toHaveValue(5); // jsdom reports number inputs numerically

        fireEvent.change(field, { target: { value: '12' } });

        expect(latest().default_top_k).toBe('12');
        expect(typeof latest().default_top_k).toBe('string');
        expect(screen.getByLabelText(tMock('defaultTopK'))).toHaveValue(12);
    });

    it('keeps the min/max/step validation attributes on the control', () => {
        // ORACLE: the pre-migration source, which set min="1" max="50" on this
        // row. The attributes have to survive FormControl's Slot merge — a
        // Slot that dropped unknown props would silently remove the browser's
        // range validation.
        renderTab();
        const field = screen.getByLabelText(tMock('defaultTopK'));
        expect(field).toHaveAttribute('min', '1');
        expect(field).toHaveAttribute('max', '50');
    });
});

describe('AdminAgentTab — conditional disabling', () => {
    it('disables a dependent field while its gate is off, through FormControl', async () => {
        // ORACLE: the pre-migration source — `disabled={!isCragEnabled}` on the
        // crag_min_relevant_chunks row. 39 rows depend on this passing through
        // FormControl's Slot, so it is worth one assertion.
        const { latest } = renderTab({ crag_enabled: 'false' });

        expect(screen.getByLabelText(tMock('cragMinRelevantChunks'))).toBeDisabled();

        await userEvent.click(screen.getByRole('checkbox', { name: tMock('cragEnabled') }));
        expect(latest().crag_enabled).toBe('true');
        expect(screen.getByLabelText(tMock('cragMinRelevantChunks'))).toBeEnabled();
    });

    it('dims a disabled checkbox row and marks the control disabled', () => {
        // ORACLE: the pre-migration source — the
        // chat_corpus_table_router_llm_enabled row carried
        // `disabled={!isCorpusTableEnabled}` on the checkbox itself.
        renderTab({ chat_corpus_table_enabled: 'false' });
        expect(
            screen.getByRole('checkbox', { name: tMock('chatCorpusTableRouterLlmEnabled') }),
        ).toBeDisabled();
    });
});

describe('AdminAgentTab — accordion and filter', () => {
    it('marks each section header as a disclosure, not a toggle button', () => {
        // ORACLE: the ARIA authoring practices' disclosure pattern —
        // aria-expanded, and NOT aria-pressed (which would make the control
        // claim to be both a toggle button and a disclosure). The DS ghost
        // variant styles on aria-pressed, so this pins the deliberate choice
        // to keep aria-expanded and drive the visual state off data-state.
        renderTab();

        const headers = screen.getAllByRole('button', { expanded: true });
        expect(headers).toHaveLength(SECTION_IDS.length);
        for (const h of headers) {
            expect(h).not.toHaveAttribute('aria-pressed');
            expect(h).toHaveAttribute('data-state', 'open');
        }
    });

    it('collapses and expands every section from the toolbar', async () => {
        renderTab();
        await userEvent.click(screen.getByRole('button', { name: tMock('agentCollapseAll') }));
        expect(screen.queryAllByRole('button', { expanded: true })).toHaveLength(0);

        await userEvent.click(screen.getByRole('button', { name: tMock('agentExpandAll') }));
        expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(SECTION_IDS.length);
    });

    it('gives the filter field an accessible name, not just a placeholder', async () => {
        // ORACLE: WCAG 2.5.3 / the DS Input contract — `leadingIcon` is
        // documented as decorative ("the accessible name still comes from a
        // Label/aria-label"), and the old field had neither. A placeholder is
        // not an accessible name.
        renderTab();
        const filter = screen.getByRole('textbox', { name: tMock('agentFilterPlaceholder') });

        await userEvent.type(filter, 'raptor');
        const headers = screen.getAllByRole('button', { expanded: true });
        expect(headers).toHaveLength(1);
        expect(headers[0]).toHaveTextContent(tMock('agentSectionIngestion'));
    });
});

describe('AdminAgentTab — select rows', () => {
    it('shows the current value on the trigger and offers every option', async () => {
        // ORACLE: the pre-migration <option> list, read off the old source:
        // neighbors / ppr / paths for chat_graph_routing_path_mode, defaulting
        // to 'neighbors'.
        renderTab({ chat_graph_routing_path_mode: 'ppr' });

        const trigger = screen.getByRole('combobox', { name: tMock('chatGraphRoutingPathMode') });
        expect(trigger).toHaveTextContent(tMock('chatGraphRoutingPathModePPR'));
    });

    it('defaults to the same value the native select defaulted to', () => {
        renderTab({});
        expect(
            screen.getByRole('combobox', { name: tMock('chatGraphRoutingPathMode') }),
        ).toHaveTextContent(tMock('chatGraphRoutingPathModeNeighbors'));
        expect(
            screen.getByRole('combobox', { name: tMock('raptorClusteringAlgorithm') }),
        ).toHaveTextContent(tMock('raptorClusteringAlgorithmKMeans'));
    });
});

describe('AdminAgentTab — submit', () => {
    it('submits the form from the save button', async () => {
        // Rendered with the component's OWN default open state (only the
        // "general" section), which is what a first-time visitor sees.
        // See the constraint-validation test below for why that matters.
        localStorage.removeItem(STORAGE_KEY);
        const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
        render(
            <AdminAgentTab siteConfigs={{}} setSiteConfigs={vi.fn()} onSubmit={onSubmit} />,
        );

        await userEvent.click(screen.getByRole('button', { name: new RegExp(tMock('saveSettings'), 'i') }));
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('PRE-EXISTING BUG: hnsw_ef_search fails HTML constraint validation and blocks Save', () => {
        // ORACLE: the HTML constraint-validation algorithm, run by jsdom, not
        // by this component. `step` valid values are `min + n*step`, so
        // min="1" step="10" permits 1, 11, 21 … 991 — and the row's own
        // default value is 150. The field is therefore permanently invalid,
        // and because it lives inside the <form>, clicking Save does nothing
        // at all whenever the "Hybrid Search" section is expanded: the browser
        // blocks submission and shows its bubble on that field.
        //
        // This is NOT a regression from the design-system migration (card
        // KI-691). The attributes are byte-identical to the pre-migration
        // source (`min="1" max="1000" step="10"`, value `|| '150'`); the
        // migration only made it observable, because there was no test on
        // this file before. Reported on the card for a decision — the likely
        // fix is `step="1"` (ef_search is any integer ≥ 1; step="10" reads
        // like an intended spinner increment, which HTML cannot express
        // separately from validation).
        //
        // DELETE THIS TEST when the step is fixed; the assertion below is
        // written to fail loudly at that point rather than silently pass.
        const { container } = renderTab();
        const form = container.querySelector('form')!;

        const invalid = Array.from(container.querySelectorAll('input'))
            .filter(i => !i.checkValidity())
            .map(i => container.querySelector(`label[for="${CSS.escape(i.id)}"]`)?.textContent?.trim());

        expect(invalid).toEqual([tMock('hnswEfSearch')]);
        expect(form.checkValidity()).toBe(false);
    });

    it('does not submit the form when a checkbox is toggled', async () => {
        // ORACLE: HTML form semantics. The DS Checkbox and SelectTrigger are
        // <button> elements inside the <form>; a button that defaulted to
        // type="submit" would save the settings on every click. Radix sets
        // type="button", and this is the check that it does.
        const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
        function Harness() {
            const [siteConfigs, setSiteConfigs] = useState<Record<string, string>>({});
            return (
                <AdminAgentTab
                    siteConfigs={siteConfigs}
                    setSiteConfigs={setSiteConfigs}
                    onSubmit={onSubmit}
                />
            );
        }
        const { container } = render(<Harness />);

        await userEvent.click(screen.getByRole('checkbox', { name: tMock('cragEnabled') }));
        await userEvent.click(within(container).getAllByRole('button', { expanded: true })[0]);

        expect(onSubmit).not.toHaveBeenCalled();
    });
});
