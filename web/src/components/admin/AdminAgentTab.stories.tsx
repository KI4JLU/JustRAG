import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import AdminAgentTab from './AdminAgentTab';

/* ---------------------------------------------------------------------------
 * The agent-configuration tab — 143 settings rows in 20 accordion sections,
 * the largest single file on the design-system migration train (card KI-691)
 * and, until this card (KI-728), the one with no story at all. Reviewing it
 * meant Postgres + Redis + the Go server + the worker + Vite and a superadmin
 * login; these stories make it one browser tab.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT
 *
 * `siteConfigs` / `setSiteConfigs` / `onSubmit` are props, so nothing about
 * the 143 rows needs mocking — the story sets the record and the component
 * derives every value, every default and every conditional `disabled` from it,
 * exactly as AdminUI does.
 *
 * But the STORY SUBJECT is the harness below, not `AdminAgentTab` directly,
 * and that is deliberate. `setSiteConfigs` is a `React.Dispatch`: handed a
 * no-op, every one of the 143 fields is frozen, so "filled", "edited" and any
 * state reached by typing become unreachable and the accordion is the only
 * thing a reviewer can move. The harness owns the state and passes the real
 * setter down, which is what AdminUI does too. Same treatment the unit suite
 * already uses (AdminAgentTab.test.tsx `renderTab`).
 *
 * TWO CHILDREN DO REACH THE NETWORK — and the card's claim-time measurement
 * missed them. `grep -cE 'axios\.|fetch\('` over AdminAgentTab.tsx really does
 * return 0, but the tab renders `AdminMCPSection` (GET /api/admin/mcp/status)
 * and `AdminAgentMetricsCard` (GET /api/admin/agent-metrics), both through
 * `authFetch` — a `window.fetch` wrapper, which no axios mock can see.
 * Unmocked, the 'Tools (MCP)' section and the metrics card at the bottom each
 * render `Error: HTTP 404`, i.e. two panels that look broken in every story.
 * Both are answered at the fetch boundary from `meta.parameters.api`; see
 * .storybook/mockApi.ts for what that interception does and does not exercise.
 *
 * THE localStorage TRAP. The component persists which sections are open to
 * `admin-agent-sections-open-v1` (AdminAgentTab.tsx:17, read in the `useState`
 * initialiser at :106, written from an effect at :112). Left alone, opening a
 * section in one story changes the NEXT story and the story order becomes
 * load-bearing. Every story below therefore declares the key's value in its
 * own `beforeEach` through `withSections()`, which both seeds it before the
 * initialiser runs and removes it again on teardown — so a story neither
 * inherits nor leaks a value. `Defaults` is the standing check on that: it
 * asserts the state the component reaches when the key is ABSENT, which is a
 * state no other story can produce, so it fails if anything leaked in.
 *
 * Light mode only: no story pins a theme. The toolbar's Theme switch renders
 * any story dark without reloading — see .storybook/preview.tsx. Dark-mode
 * coverage is an accessibility question, not one story per state.
 * No visual claim is made by any assertion below — the developer's visual
 * pass is the gate, and these stories exist to make it cheap.
 * ------------------------------------------------------------------------- */

const STORAGE_KEY = 'admin-agent-sections-open-v1';

/**
 * The 20 section titles, in render order, as German source strings from
 * src/translations.ts.
 *
 * ORACLE, and why it is independent: the component holds section IDENTIFIERS
 * (`SECTION_CONFIGS[].titleKey`) and resolves them through `t()` at render
 * time. This list is the rendered side, written out by hand — the same census
 * the unit suite keeps as `SECTION_IDS` (AdminAgentTab.test.tsx:69), one
 * abstraction layer further out. It is deliberately NOT imported from the
 * component: a census that follows the code it counts counts nothing. A
 * section added, removed, renamed or dropped from the accordion changes the
 * count or the lookup here and every accordion story fails.
 */
const SECTION_TITLES = [
    'Retrieval-Defaults',
    'Hybride Suche',
    'Reranker',
    'Top-N pro Routentyp',
    'Kontext-Kompression',
    'Anfrageverbesserung',
    'CRAG & Adaptives Routing',
    'Wissensgraph (GraphRAG)',
    'Mehrschritt-Pipelines',
    'Konversation & Folgefragen',
    'Korpus-Vergleichstabellen',
    'Dokumentenvergleich (im Chat)',
    'Agenten-Teams',
    'Long-Term-Memory',
    'Validierung & QA',
    'Ingestion & Parsing',
    'Observability',
    'Tabellen / Tabellenkalkulation',
    'Datumsbewusster Chat',
    'Tools (MCP)',
] as const;

/** The section ids the persisted `openMap` is keyed by, in the same order. */
const SECTION_IDS = [
    'general', 'hybrid', 'reranker', 'topn', 'compression', 'queryEnh', 'crag',
    'graph', 'multistep', 'conversation', 'corpusTable', 'compare', 'teams',
    'longmem', 'validation', 'ingestion', 'observability', 'tabular',
    'dateAware', 'tools',
] as const;

const ALL_OPEN = Object.fromEntries(SECTION_IDS.map(id => [id, true]));

/**
 * Per-story isolation of `admin-agent-sections-open-v1`.
 *
 * Returns a Storybook `beforeEach`, which runs BEFORE the story renders — so
 * the write lands before the component's `useState` initialiser reads the key,
 * which is the same ordering constraint the theme decorator in
 * .storybook/preview.tsx solves by writing in the decorator body. The returned
 * callback is the teardown and removes the key again, including whatever the
 * component's own effect wrote during the story. Isolation is therefore in
 * both directions: a story cannot inherit a value and cannot leave one.
 *
 * `undefined` means "no key at all" — the fresh-deployment state.
 */
function withSections(openMap?: Record<string, boolean>) {
    return () => {
        if (openMap === undefined) localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, JSON.stringify(openMap));
        return () => localStorage.removeItem(STORAGE_KEY);
    };
}

/**
 * The state owner. `initialConfigs` is the story's arg; the harness holds it in
 * real React state and hands `AdminAgentTab` the real setter, so every field is
 * editable and the conditional `disabled` chains react to a click the way they
 * do in AdminUI.
 */
function AgentTabHarness({
    initialConfigs,
    onSubmit,
}: {
    initialConfigs: Record<string, string>;
    onSubmit: (e: React.FormEvent) => void;
}) {
    const [siteConfigs, setSiteConfigs] = useState<Record<string, string>>(initialConfigs);
    return (
        <AdminAgentTab
            siteConfigs={siteConfigs}
            setSiteConfigs={setSiteConfigs}
            onSubmit={onSubmit}
        />
    );
}

/* ---------------------------------------------------------------------------
 * Fixtures for the two authFetch children. Structural mirrors of the response
 * shapes (adminmcp.StatusResponse, adminagentmetrics.AgentMetricsResponse),
 * written out here rather than imported: neither interface is exported, and a
 * fixture that shares a type with the code under test follows that code when
 * it changes.
 * ------------------------------------------------------------------------- */

const MCP_STATUS = {
    use_mcp_tools: false,
    builtins: [
        { name: 'kb_search', description: 'Search the knowledge base', origin: 'builtin' },
        { name: 'web_search', description: 'Search the web', origin: 'builtin' },
        { name: 'memory_read', description: 'Read long-term memory', origin: 'builtin' },
    ],
    servers: [],
    server_spec: [],
};

const AGENT_METRICS = {
    window_seconds: 86_400,
    agentic_chat: { total: 42, by_label: { answer: 30, search: 9, refuse: 3 } },
    plan_execute: { total: 11, by_label: { plan: 7, replan: 4 } },
    crag: { total: 18, by_label: { correct: 12, ambiguous: 4, incorrect: 2 } },
    median_hops: 2,
    median_rounds: 1,
    p95_latency_ms: 4310,
    tool_mix: [
        { tool: 'kb_search', calls: 61, median_duration_ms: 210, error_rate: 0 },
        { tool: 'web_search', calls: 9, median_duration_ms: 980, error_rate: 0.11 },
    ],
};

/**
 * A filled configuration. Every value is one this file chose, so a story that
 * asserts on one is asserting against its own fixture and not against a number
 * the component produced. Each one differs from the component's documented
 * default, which is what makes "filled" distinguishable from "default".
 */
const FILLED_CONFIGS: Record<string, string> = {
    default_top_k: '12',
    score_drop_threshold: '0.25',
    context_window_size: '2',
    chat_answer_temperature: '0.7',
    min_similarity_threshold: '0.45',
    mmr_lambda: '0.5',
    hnsw_ef_search: '250',
    bm25_simple_arm_enabled: 'true',
    query_instruction: 'Represent this query for retrieving supporting passages',
    rerank_instruction: 'Rank the passage by how directly it answers the question',
    crag_enabled: 'true',
    crag_min_relevant_chunks: '3',
    adaptive_routing_enabled: 'true',
    kg_extraction_enabled: 'true',
    chat_graph_routing_enabled: 'true',
    chat_agentic_enabled: 'true',
    chat_agentic_max_hops: '4',
    chat_plan_execute_enabled: 'true',
    docling_enabled: 'true',
    docling_base_url: 'http://docling.internal:5001',
    langfuse_base_url: 'https://langfuse.internal',
    chat_date_timezone: 'Europe/Berlin',
    mcp_servers: '[]',
};

const meta = {
    title: 'Admin/Agent-Tab',
    component: AgentTabHarness,
    // The tab is a full-width card inside AdminUI's own page frame; rendered in
    // Storybook's padded canvas the 400px field column would be measured
    // against that padding instead of the viewport.
    parameters: {
        layout: 'fullscreen',
        // Both of these are reached through authFetch by CHILDREN of the tab.
        // Story-level `parameters.api` entries merge onto these.
        api: { mcpStatus: MCP_STATUS, agentMetrics: AGENT_METRICS },
    },
    args: {
        initialConfigs: {},
        onSubmit: fn((e: React.FormEvent) => e.preventDefault()),
    },
} satisfies Meta<typeof AgentTabHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The 20 accordion headers, looked up by their accessible names. */
function headers(canvas: { getByRole: (role: string, opts: { name: string }) => HTMLElement }) {
    return SECTION_TITLES.map(title => canvas.getByRole('button', { name: title }));
}

/** The settings form, resolved through the DOM's own form-owner association. */
function settingsForm(button: HTMLElement) {
    return (button as HTMLButtonElement).form as HTMLFormElement;
}

/* =====================================================================
 * 1. Defaults — and the isolation check
 * ===================================================================== */

/**
 * A fresh deployment: `siteConfigs` empty, so every one of the 143 rows shows
 * the default written at its own call site, and the persisted open-state key is
 * ABSENT, so the accordion falls back to the component's own `{ general: true }`.
 *
 * This is also the standing check that story order does not matter. One section
 * open is a state no other story here produces: `AllSectionsExpanded` and
 * `FilledValues` open all 20, `AllSectionsCollapsed` opens none, and the two
 * gate stories open exactly one different section each. So if any of them
 * leaked its `openMap`, or if `withSections()` stopped removing the key, the
 * count below is wrong and this story fails — whichever order the runner picks.
 */
export const Defaults: Story = {
    beforeEach: withSections(undefined),
    play: async ({ canvas }) => {
        const sections = headers(canvas);
        // ORACLE: WAI-ARIA's `aria-expanded` on a disclosure, read from the
        // accessibility tree, against the hand-kept 20-section census above.
        // Nothing here is a value the component computed.
        await expect(sections).toHaveLength(20);
        const open = sections.filter(h => h.getAttribute('aria-expanded') === 'true');
        await expect(open).toHaveLength(1);
        await expect(open[0]).toHaveAccessibleName('Retrieval-Defaults');
    },
};

/* =====================================================================
 * 2 + 3. The two extremes of the accordion
 * ===================================================================== */

/**
 * Every section expanded — all 143 rows in the document at once, which is what
 * a reviewer wants in order to sample per section instead of clicking through
 * 20 disclosures.
 *
 * Reached through the real toolbar button (`expandAll`), not by seeding the
 * storage key, so the click path is covered too.
 */
export const AllSectionsExpanded: Story = {
    beforeEach: withSections(undefined),
    play: async ({ canvas, userEvent }) => {
        await userEvent.click(await canvas.findByRole('button', { name: 'Alle ausklappen' }));

        const sections = headers(canvas);
        for (const header of sections) {
            await expect(header).toHaveAttribute('aria-expanded', 'true');
        }

        // ORACLE: the HTML Living Standard's constraint-validation algorithm,
        // as implemented by CHROMIUM — a different engine from the jsdom that
        // runs the unit suite's equivalent assertion
        // (AdminAgentTab.test.tsx:367). With every section expanded, all 143
        // rows participate in validation, so a single row whose own default
        // violates its own min/max/step blocks Save for the whole form. That is
        // exactly the defect class card KI-710 fixed; nothing in this repo
        // computes this boolean.
        const save = await canvas.findByRole('button', { name: 'Einstellungen speichern' });
        await expect(settingsForm(save).checkValidity()).toBe(true);
    },
};

/**
 * Every section collapsed — the other extreme, and the state in which the page
 * is nothing but its own chrome. Worth a look on its own: 20 stacked
 * disclosure headers are the only thing carrying the layout here, and the
 * ghost Button they are built on is documented in AdminAgentTab.tsx:35 as not
 * yet visually confirmed (its `rounded-action` radius against the section body,
 * and `whitespace-nowrap` against a long title).
 */
export const AllSectionsCollapsed: Story = {
    beforeEach: withSections(ALL_OPEN),
    play: async ({ canvas, userEvent }) => {
        await userEvent.click(await canvas.findByRole('button', { name: 'Alle einklappen' }));

        for (const header of headers(canvas)) {
            await expect(header).toHaveAttribute('aria-expanded', 'false');
        }
        // ORACLE: the ARIA role of a text field / spin button. A collapsed
        // section does not render its children at all (AdminAgentTab.tsx:126
        // returns null), so with everything shut there must be exactly ONE
        // remaining field on the page — the settings filter — and the 143 rows
        // must be gone rather than merely hidden.
        await expect(canvas.queryAllByRole('spinbutton')).toHaveLength(0);
        await expect(canvas.getAllByRole('textbox')).toHaveLength(1);
        await expect(canvas.getByRole('textbox')).toHaveAccessibleName('Einstellungen filtern…');
    },
};

/* =====================================================================
 * 4 + 5. The conditionally-disabled rows, in their ENABLED state
 * ===================================================================== */

/**
 * Graph routing with path mode `ppr` — the state in which the three PPR rows
 * are editable.
 *
 * WHY THIS STORY EXISTS. A disabled control is barred from constraint
 * validation (`willValidate === false`), so while path mode is `neighbors` —
 * the default, and therefore every screenshot anyone ever took — the PPR rows'
 * `step` is never checked against their own values. That is precisely how
 * KI-710's defect hid: `step="0.05"` on a field with `min="0.01"` accepts only
 * 0.01, 0.06, 0.11 … so the row's own default of 0.85 was invalid and blocked
 * Save for the entire form the moment an operator picked `ppr`. This story puts
 * the rows in the one state where the browser will judge them.
 */
export const GraphPathModePpr: Story = {
    args: { initialConfigs: { chat_graph_routing_path_mode: 'ppr' } },
    beforeEach: withSections({ graph: true }),
    play: async ({ canvas }) => {
        const damping = await canvas.findByLabelText('PPR: Damping (1 - Teleport)');
        const maxIter = await canvas.findByLabelText('PPR: max. Iterationen');
        const topEntities = await canvas.findByLabelText('PPR: Top-K-Entities für Chunk-Projektion');

        // ORACLE: `willValidate`, the HTML spec's own name for "this control is
        // a candidate for constraint validation". Chromium computes it; it is
        // false for a disabled control. These three being TRUE is the whole
        // point of the story — it is the property whose absence hid the defect.
        for (const field of [damping, maxIter, topEntities]) {
            await expect((field as HTMLInputElement).willValidate).toBe(true);
        }

        // Control case in the other direction: the two `paths`-mode rows must
        // still be barred, which proves the form really is in the `ppr` branch
        // and not simply enabling everything.
        const pathsMaxLen = await canvas.findByLabelText('Pfade: max. Pfadlänge (Kanten)');
        await expect((pathsMaxLen as HTMLInputElement).willValidate).toBe(false);

        // ORACLE: Chromium's constraint validation over the now-validated
        // rows. This is the standing guard KI-710 asked for: restore
        // `step="0.05"` on the damping row and 0.85 stops satisfying
        // min + n*step, so this goes false.
        await expect((damping as HTMLInputElement).checkValidity()).toBe(true);
        const save = await canvas.findByRole('button', { name: 'Einstellungen speichern' });
        await expect(settingsForm(save).checkValidity()).toBe(true);
    },
};

/**
 * RAPTOR clustering set to `leiden` — the second row KI-710 fixed, and the
 * mirror image of the story above: the Leiden resolution row becomes editable
 * while the branching factor becomes irrelevant and is disabled. Same reason
 * for existing: with `kmeans` selected (the default) the resolution row is
 * barred from validation, so its `step` was never judged against its own
 * default of 1.0.
 */
export const IngestionClusteringLeiden: Story = {
    args: { initialConfigs: { raptor_clustering_algorithm: 'leiden' } },
    beforeEach: withSections({ ingestion: true }),
    play: async ({ canvas }) => {
        const resolution = await canvas.findByLabelText('RAPTOR: Leiden-Auflösung (γ)');
        const branching = await canvas.findByLabelText('RAPTOR: Verzweigungsfaktor');

        // ORACLE: `willValidate` again — enabled here, and disabled for the
        // row this choice makes meaningless. The pair is what shows the
        // conditional chain actually swapped, rather than one row changing.
        await expect((resolution as HTMLInputElement).willValidate).toBe(true);
        await expect((branching as HTMLInputElement).willValidate).toBe(false);

        // ORACLE: Chromium's constraint validation. `step={0.05}` with
        // `min={0.01}` rejected this row's own default of 1.0; `step={0.01}`
        // accepts it. Reverting that change turns this false.
        await expect((resolution as HTMLInputElement).checkValidity()).toBe(true);
        const save = await canvas.findByRole('button', { name: 'Einstellungen speichern' });
        await expect(settingsForm(save).checkValidity()).toBe(true);
    },
};

/* =====================================================================
 * 6. Filled values
 * ===================================================================== */

/**
 * An operator-configured deployment, every section open. The point is the
 * `FieldRow` composition with real content rather than defaults and
 * placeholders: long text values in the instruction rows, a URL in the Docling
 * row, checked booleans, and the gated rows switched on so their dependents are
 * live.
 */
export const FilledValues: Story = {
    args: { initialConfigs: FILLED_CONFIGS },
    beforeEach: withSections(ALL_OPEN),
    play: async ({ canvas }) => {
        // ORACLE: this file's own FILLED_CONFIGS fixture. Each value differs
        // from the component's documented default, so a row that ignored
        // `siteConfigs` and fell through to its default would show the other
        // number and fail here.
        await expect(await canvas.findByLabelText('Standard Top-K')).toHaveValue(12);
        await expect(await canvas.findByLabelText('HNSW ef_search')).toHaveValue(250);
        await expect(await canvas.findByLabelText('Docling-Basis-URL')).toHaveValue(
            'http://docling.internal:5001',
        );
        // A gated row whose gate this fixture switched on: `crag_enabled` is
        // 'true', so the dependent row is a validation candidate.
        const minChunks = await canvas.findByLabelText('CRAG: minimal relevante Chunks');
        await expect((minChunks as HTMLInputElement).willValidate).toBe(true);

        // Still submittable with edited values throughout.
        const save = await canvas.findByRole('button', { name: 'Einstellungen speichern' });
        await expect(settingsForm(save).checkValidity()).toBe(true);
    },
};
