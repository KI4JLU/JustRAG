import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import AdminEvalTab from './AdminEvalTab';

/* ---------------------------------------------------------------------------
 * The evaluation-runner tab: golden sets, corpus generation, the kick-off
 * form, the run history and the compare view. Migrated onto the design system
 * in card KI-692, and the only one of the three admin tabs that genuinely
 * needs a network mock (card KI-728).
 *
 * `basePath` and `kbId` are its ONLY props — everything visible is derived
 * inside the component from three GET responses:
 *   GET {basePath}/golden-sets       -> the golden-set table + the select's options
 *   GET {basePath}/golden-sets/jobs  -> the generation-job list, and `genInFlight`
 *   GET {basePath}/runs?…            -> the history table, and `hasInFlight`
 * So these stories set those three responses and nothing else: no doubled
 * children, no injected state, no stateful wrapper. The kick-off form's own
 * fields are component state and are reached by typing, which is how a user
 * reaches them.
 *
 * The interception is at axios's adapter — see .storybook/mockApi.ts for what
 * that does and does not exercise. Two consequences worth naming:
 *   - one URL pattern serves BOTH `basePath` modes, because the admin prefix
 *     (/api/admin/eval) and the KB-scoped one (/api/kb/{id}/eval) share the
 *     same three path tails;
 *   - the team select's data source is NOT axios. `fetchKbAgents`
 *     (src/components/agents/api.ts:104) goes through `authFetch`, i.e. the
 *     browser's own `window.fetch`, which an axios adapter cannot see. It is
 *     answered at the fetch boundary, and only in the KB-scoped story — the
 *     admin-scope stories never put a KB in play, so the component never calls
 *     it and its `parameters.api.kbAgents` is deliberately absent.
 *
 * Endpoints deliberately left unmocked (upload, generate, download, delete)
 * fall through to the Storybook origin and 404, which the component surfaces
 * as its own error toast — the honest outcome for an action whose payload a
 * story cannot supply. Do not read those toasts as story failures; they only
 * appear if a reviewer presses one of those buttons.
 *
 * Both themes throughout, via a `…Dark` twin per state. No assertion below
 * makes a visual claim.
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * Fixtures. Structural mirrors of the endpoints' response shapes, written out
 * by hand and NOT imported from the component: a fixture that shares a type
 * with the code under test follows that code when it changes, which is exactly
 * what a fixture must not do. The authoritative shapes are the Go DTOs in
 * go-backend/internal/admineval.
 * ------------------------------------------------------------------------- */

const GOLDEN_SETS = {
    golden_sets: [
        {
            id: 'gs-baseline',
            name: 'pruefungsordnungen-baseline',
            description: 'kuratiert, 2026-01',
            content_hash: 'a1b2c3d4e5f60718',
            question_count: 89,
            created_at: '2026-01-02T10:00:00Z',
        },
        {
            id: 'gs-draft',
            name: 'pruefungsordnungen-draft',
            // The `auto-generated from corpus` prefix is what makes the row
            // show the "Entwurf" badge (AdminEvalTab.tsx:428) — a branch that
            // is invisible unless a generated set exists.
            description: 'auto-generated from corpus, lang=de',
            content_hash: '00112233445566778',
            question_count: 40,
            created_at: '2026-01-09T08:30:00Z',
        },
    ],
};

const NO_GOLDEN_SETS = { golden_sets: [] };

const NO_JOBS = { jobs: [] };

/** A queued generation job — what puts the Generate button in its busy state. */
const JOB_RUNNING = {
    jobs: [
        { id: 'job-1', status: 'running' },
        { id: 'job-0', status: 'completed', golden_set_id: 'gs-draft' },
    ],
};

/**
 * Two COMPLETED runs. Both matter: `otherRuns` in RunRow is non-empty for each
 * of them, so the compare disclosure renders; and because nothing is
 * queued/running, `hasInFlight` is false and the component's 5s poll never
 * starts — so the story is static rather than quietly refetching.
 */
const RUNS = {
    runs: [
        {
            id: 'run-aaaaaaaa-1111-2222-3333-444444444444',
            label: 'baseline',
            status: 'completed',
            created_at: '2026-01-02T10:00:00Z',
            started_at: '2026-01-02T10:00:00Z',
            finished_at: '2026-01-02T10:21:00Z',
            kb_id: 'kb-1111-2222',
            kb_name: 'Prüfungsordnungen',
            judge_enabled: true,
            aggregate: { count: 89, mean_recall: 0.72, mrr: 0.61 },
            route_mean_recall: { lookup: 0.81, enumeration: 0.64, complex_reasoning: 0.55 },
        },
        {
            id: 'run-bbbbbbbb-1111-2222-3333-444444444444',
            label: 'nach CRAG-Änderung',
            status: 'completed',
            created_at: '2026-01-09T09:00:00Z',
            started_at: '2026-01-09T09:00:00Z',
            finished_at: '2026-01-09T09:07:00Z',
            kb_id: 'kb-1111-2222',
            kb_name: 'Prüfungsordnungen',
            judge_enabled: false,
            aggregate: { count: 89, mean_recall: 0.78, mrr: 0.66 },
            route_mean_recall: { lookup: 0.86, enumeration: 0.7, complex_reasoning: 0.61 },
        },
    ],
    total: 2,
};

const NO_RUNS = { runs: [], total: 0 };

/** A run in flight, plus a failed one — the state that disables kick-off. */
const RUNS_IN_FLIGHT = {
    runs: [
        {
            id: 'run-cccccccc-1111-2222-3333-444444444444',
            label: 'läuft gerade',
            status: 'running',
            created_at: '2026-01-09T09:30:00Z',
            started_at: '2026-01-09T09:30:00Z',
            kb_id: 'kb-1111-2222',
            kb_name: 'Prüfungsordnungen',
            judge_enabled: true,
        },
        {
            id: 'run-dddddddd-1111-2222-3333-444444444444',
            label: 'abgebrochen',
            status: 'failed',
            created_at: '2026-01-08T09:30:00Z',
            started_at: '2026-01-08T09:30:00Z',
            finished_at: '2026-01-08T09:31:00Z',
            kb_id: 'kb-1111-2222',
            kb_name: 'Prüfungsordnungen',
            judge_enabled: false,
            error_message: 'judge model unavailable',
        },
    ],
    total: 2,
};

/** GET /api/kb/{id}/agents — the KB's attached teams, via authFetch. */
const KB_AGENTS = {
    agents: [],
    teams: [
        { id: 'team-1', name: 'Prüfungsamt-Team', description: '', icon: '', isDefault: true },
        { id: 'team-2', name: 'Recherche-Team', description: '', icon: '', isDefault: false },
    ],
};

const meta = {
    title: 'Admin/Eval-Tab',
    component: AdminEvalTab,
    parameters: {
        layout: 'fullscreen',
        // Defaults for all three GETs, so no story leaves an endpoint to
        // passthrough by accident. Story-level `parameters.api` merges onto
        // these.
        api: {
            evalGoldenSets: GOLDEN_SETS,
            evalGoldenSetJobs: NO_JOBS,
            evalRuns: RUNS,
        },
    },
} satisfies Meta<typeof AdminEvalTab>;

export default meta;
type Story = StoryObj<typeof meta>;

/* =====================================================================
 * Golden sets and runs, present and absent
 * ===================================================================== */

/**
 * The normal admin-scope page: two golden sets (one of them a generated
 * draft), two completed runs with per-route recall, both kb_id fields present.
 */
export const Populated: Story = {
    play: async ({ canvas }) => {
        // ORACLE: the fixture. Both names and the question count come from
        // GOLDEN_SETS above; the component only formats them.
        await expect(await canvas.findByText('pruefungsordnungen-baseline')).toBeInTheDocument();
        await expect(await canvas.findByText('89')).toBeInTheDocument();

        // ORACLE: the fixture's `description` prefix. The draft badge is
        // derived from the string starting with `auto-generated from corpus`,
        // so exactly one of the two rows may carry it.
        await expect(canvas.getAllByText('Entwurf')).toHaveLength(1);

        // ORACLE: the run labels the fixture set, read from the history table.
        await expect(await canvas.findByText('baseline')).toBeInTheDocument();
        await expect(await canvas.findByText('nach CRAG-Änderung')).toBeInTheDocument();

        // ORACLE: the two kb_id fields exist in admin scope. This is the
        // control case for the KbScoped story below, which asserts they are
        // gone — a pair of assertions is what makes that branch meaningful.
        await expect(canvas.getAllByLabelText('KB-ID')).toHaveLength(3);
    },
};

export const PopulatedDark: Story = {
    ...Populated,
    globals: { theme: 'dark' },
};

/**
 * No golden sets yet — the state of a fresh deployment, and the one in which
 * the kick-off form cannot be completed at all: the select has no options, so
 * its placeholder is the only thing on the trigger.
 */
export const GoldenSetsEmpty: Story = {
    parameters: { api: { evalGoldenSets: NO_GOLDEN_SETS } },
    play: async ({ canvas }) => {
        // ORACLE: the German source string for `evalGoldenSetsEmpty`.
        await expect(await canvas.findByText('Noch keine Golden-Sets. Oben hochladen.')).toBeInTheDocument();

        // ORACLE: Radix's documented placeholder rule — value '' is "nothing
        // selected", so the trigger shows the placeholder. The wording is the
        // German `evalPickGoldenSet` string.
        await expect(await canvas.findByLabelText('Golden-Set')).toHaveTextContent(
            'Golden-Set auswählen…',
        );
        // The table is gone, not empty: the component swaps it for the message.
        await expect(canvas.queryByText('pruefungsordnungen-baseline')).toBeNull();
    },
};

export const GoldenSetsEmptyDark: Story = {
    ...GoldenSetsEmpty,
    globals: { theme: 'dark' },
};

/**
 * Golden sets present, no runs yet — the state right after the first upload,
 * where the history section is a single line of text instead of a table.
 */
export const NoRuns: Story = {
    parameters: { api: { evalRuns: NO_RUNS } },
    play: async ({ canvas }) => {
        // ORACLE: the German source string for `evalNoRuns`.
        await expect(
            await canvas.findByText('Noch keine Durchläufe. Starten Sie einen oben.'),
        ).toBeInTheDocument();
        // ORACLE: the fixture's `total: 0`. The pager only renders above 50,
        // so it must be absent here.
        await expect(canvas.queryByRole('button', { name: 'Weiter' })).toBeNull();
    },
};

export const NoRunsDark: Story = {
    ...NoRuns,
    globals: { theme: 'dark' },
};

/**
 * Work in flight, on both of the tab's two independent axes at once: a corpus
 * generation job is running (which busies the Generate button) and an eval run
 * is running (which disables kick-off and shows the queue warning). Both are
 * states a hand-QA pass can only reach by starting real work and racing it.
 *
 * The running run also puts a `RunRow` into its ticking-elapsed branch — the
 * only place `Date.now()` is sampled — so the duration cell reads "N s …".
 */
export const WorkInFlight: Story = {
    parameters: {
        api: { evalGoldenSetJobs: JOB_RUNNING, evalRuns: RUNS_IN_FLIGHT },
    },
    play: async ({ canvas }) => {
        // ORACLE: the German source strings for `evalGenRunning` and
        // `evalInFlight`, plus the HTML `disabled` IDL attribute (which
        // Chromium, not this repo, computes from the rendered markup).
        const generate = await canvas.findByRole('button', { name: 'Generierung läuft…' });
        await expect(generate).toBeDisabled();

        await expect(
            await canvas.findByText('Ein Durchlauf läuft — neue Durchläufe werden eingereiht.'),
        ).toBeInTheDocument();
        await expect(
            await canvas.findByRole('button', { name: 'Evaluation starten' }),
        ).toBeDisabled();

        // ORACLE: the fixture. 'running' appears exactly twice — once in the
        // generation-job list (JOB_RUNNING's first entry) and once as the
        // status badge of the running run (RUNS_IN_FLIGHT's first entry). The
        // count is what distinguishes "both axes are busy" from "one of them
        // is", which is the whole point of this story.
        await expect(await canvas.findAllByText('running')).toHaveLength(2);

        // ORACLE: the fixture's statuses again — a running run's delete action
        // must be disabled (AdminEvalTab.tsx:914), the failed one's must not.
        const deletes = canvas.getAllByRole('button', { name: 'Löschen' });
        await expect(deletes.filter(b => (b as HTMLButtonElement).disabled)).toHaveLength(1);
    },
};

export const WorkInFlightDark: Story = {
    ...WorkInFlight,
    globals: { theme: 'dark' },
};

/* =====================================================================
 * The golden-set select after KI-710 removed its native `required`
 * ===================================================================== */

/**
 * Submitting the kick-off form with no golden set selected.
 *
 * WHY THIS STORY EXISTS. Until card KI-710 the select carried a native
 * `required`, which Radix puts on a VISUALLY HIDDEN <select>. A browser that
 * refuses to submit then has nowhere to render its bubble: Chrome logs "An
 * invalid form control … is not focusable" and the user sees nothing happen at
 * all. The attribute was removed and `handleKickOff`'s own guard became the
 * single source of truth, rendering its message on the field through
 * FieldRow's `error` -> FormMessage. This story is that path, in a real
 * browser — which is the only place the old failure mode was observable.
 */
export const GoldenSetNotSelected: Story = {
    play: async ({ canvas, userEvent }) => {
        // Wait for the mount fetches, so the select has options to NOT pick.
        await canvas.findByText('pruefungsordnungen-baseline');

        const trigger = await canvas.findByLabelText('Golden-Set');
        // A label is typed first — not decoration. `handleKickOff`'s SUCCESS
        // path ends with `setLabel('')` (AdminEvalTab.tsx:326), so the field
        // still holding this text is an observable, component-side consequence
        // of the request NOT having been sent. See the oracle note below.
        const labelField = await canvas.findByLabelText('Label');
        await userEvent.type(labelField, 'baseline-lauf');

        // Nothing is selected and the form is submitted the way a user submits
        // it — no state is injected.
        await expect(trigger).not.toHaveAttribute('aria-invalid', 'true');
        await userEvent.click(await canvas.findByRole('button', { name: 'Evaluation starten' }));

        /* ORACLE 1: the German source string for `evalSelectGoldenSet` in
         * src/translations.ts, read out of the rendered document. The message
         * the user sees has to be the app guard's, not the browser's.
         *
         * ORACLE 2: `aria-invalid` plus `aria-describedby` IDREF resolution —
         * the association an assistive technology follows. This is what the
         * hidden-required arrangement could not offer at all: it had no visible
         * message to point at. */
        await expect(
            await canvas.findByText('Zuerst ein Golden-Set auswählen.'),
        ).toBeInTheDocument();
        await expect(trigger).toHaveAttribute('aria-invalid', 'true');

        const describedBy = trigger.getAttribute('aria-describedby');
        await expect(describedBy).not.toBeNull();
        const message = document.getElementById((describedBy as string).split(/\s+/)[0]);
        await expect(message).toHaveTextContent('Zuerst ein Golden-Set auswählen.');

        /* ORACLE 3 — and the one that makes this story pin the GUARD rather
         * than merely the message. `goldenSetError` is derived from
         * `kickOffAttempted && !selectedGoldenSetId`, so the message renders
         * whether or not the request was sent: measured by deleting the guard
         * line from handleKickOff, the two assertions above stayed green.
         * What distinguishes the two is a side effect of the SUCCESS path —
         * `setLabel('')` — so the label still carrying the typed string is the
         * evidence that the early return happened and nothing was POSTed. The
         * string is this file's own; the clearing is the component's. (The
         * usual signal, the success toast, is unavailable here: preview.tsx
         * supplies `ToastProvider`, which only holds state — the container that
         * renders toasts lives in AuthenticatedApp and is not in a story.) */
        await expect(labelField).toHaveValue('baseline-lauf');

        /* And the message is DERIVED, not stored: picking a set clears it with
         * no separate reset path. Done through the real Radix listbox — click
         * the trigger, click the option — which is only possible in a real
         * browser (the unit suite has to stub pointer capture for jsdom).
         *
         * The option is looked up from `document.body`, not from `canvas`:
         * Radix renders SelectContent in a PORTAL outside the story root and
         * marks everything else `aria-hidden`, so a canvas-scoped query cannot
         * see the listbox at all. */
        await userEvent.click(trigger);
        await userEvent.click(
            await within(document.body).findByRole('option', {
                name: /pruefungsordnungen-baseline/,
            }),
        );
        await expect(canvas.queryByText('Zuerst ein Golden-Set auswählen.')).toBeNull();
        await expect(trigger).not.toHaveAttribute('aria-invalid', 'true');
    },
};

export const GoldenSetNotSelectedDark: Story = {
    ...GoldenSetNotSelected,
    globals: { theme: 'dark' },
};

/* =====================================================================
 * The KB-scoped variant
 * ===================================================================== */

/**
 * The tab as `KbSettingsPanel` mounts it (KbSettingsPanel.tsx:326):
 * `basePath="/api/kb/{id}/eval"` and `kbId` set. A whole branch of the
 * component that no reviewer has looked at — three kb_id inputs disappear
 * because the KB comes from the path, and the team select appears because a KB
 * is now in play.
 */
export const KbScoped: Story = {
    args: { basePath: '/api/kb/kb-1111-2222/eval', kbId: 'kb-1111-2222' },
    parameters: { api: { kbAgents: KB_AGENTS } },
    play: async ({ canvas }) => {
        await canvas.findByText('pruefungsordnungen-baseline');

        /* ORACLE: accessible-name lookup against the German `evalKbId` string.
         * All three kb_id fields — the generate row, the upload row and the
         * kick-off form — are behind `!kbId`, so in this mode there must be
         * none at all. `Populated` asserts the same query finds three, which is
         * what makes this a real branch check rather than a query that never
         * matched. */
        await expect(canvas.queryAllByLabelText('KB-ID')).toHaveLength(0);

        /* ORACLE: the KB_AGENTS fixture, delivered over the SECOND network
         * boundary (window.fetch, not axios). The team select only renders
         * when `kbTeams.length > 0`, so its presence proves the authFetch mock
         * was reached and the response was consumed — and its trigger text is
         * Radix's placeholder for the '' value, i.e. the German
         * `evalTeamStandard` wording. */
        const team = await canvas.findByLabelText('Agenten-Team');
        await expect(team).toHaveTextContent('Standard (kein Team)');
    },
};

export const KbScopedDark: Story = {
    ...KbScoped,
    globals: { theme: 'dark' },
};
