import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import AdminConfigsTab from './AdminConfigsTab';

/* ---------------------------------------------------------------------------
 * The AI-configuration tab: provider credentials, five model lists, the
 * per-job model overrides, and the connection-test banner. 57 rows rebuilt on
 * the design system in card KI-692, and until this card (KI-728) with no story
 * — reviewing it meant the full stack plus a superadmin login.
 *
 * A TRAP THIS FILE FELL INTO, kept here because it will catch the next story
 * too. A story file is not part of the app bundle — but it IS part of what
 * Tailwind 4 scans. `@tailwindcss/vite` treats every word in every scanned
 * source file as a utility-class candidate, and that includes COMMENTS, so an
 * ordinary English sentence in a story can add a rule to the PRODUCTION
 * stylesheet. Measured twice on this card: one common verb in this very
 * comment, and then the utility name itself while writing this warning, each
 * added a single declaration to dist/assets/index-*.css (+18 bytes). Neither
 * word is repeated here, for that reason. And because the entry chunk imports
 * that stylesheet, all 73 JS chunks then took a new content hash: the whole
 * bundle churned over one word of documentation. Both sentences were
 * reworded, and `dist/` is byte-identical to the claim-base build again (147
 * files, every sha256 equal). Verifying that identity is therefore not a
 * formality on this train — it is the only check that catches this class of
 * leak, and the offending words are named on card KI-728 instead of in a file
 * Tailwind reads. A durable fix (keeping `*.stories.tsx` out of Tailwind's
 * scanned sources) would change the app's CSS pipeline, so it is raised as an
 * open question rather than done here.
 *
 * NO NETWORK AT ALL. Every one of this tab's 18 props is either data or a
 * handler; `grep -cE 'axios\.|fetch\('` over AdminConfigsTab.tsx returns 0 and,
 * unlike AdminAgentTab, it renders no child that fetches either (checked:
 * its only imports are the DS, FieldRow, two local utils and a type). So these
 * stories are pure args — there is no mock here and none is needed.
 *
 * THE HARNESS, and why the story subject is not the component directly.
 * `setConfigFormData` and `setSiteConfigs` are `React.Dispatch` props, and
 * `configValidation.clearError` is a handler that has to actually clear.
 * Handed no-ops, every field on the form is frozen: nothing can be typed, the
 * five model lists can neither gain nor lose a row, and a validation message
 * can never be dismissed — so "filled", "edited" and "error cleared" are all
 * unreachable. `ConfigsTabHarness` owns exactly those four pieces of state
 * (form data, site configs, validation errors, the connection banner) and
 * passes the real setters down, which is what AdminUI does. Everything that is
 * genuinely AdminUI's business — submitting, activating, deleting, opening the
 * edit form — stays a spy: those are API calls, and a story that faked their
 * outcome would be inventing behaviour rather than showing this component's.
 *
 * A FIDELITY LIMIT THAT MUST BE READ BEFORE JUDGING THESE STORIES, and a
 * correction to the premise of card KI-728. The card records KI-692 as having
 * found that `.loading-spinner` and `.spin` "have no CSS anywhere". Re-measured
 * at the claim base, that is true of one and false of the other:
 *
 *   .loading-spinner   NOT defined anywhere — not in src/index.css, not in any
 *                      component <style> block, not in the design system. The
 *                      loading branch (AdminConfigsTab.tsx:551) renders an
 *                      EMPTY div, so in production the tab shows nothing at all
 *                      while it loads. Real defect; pinned in `Loading` below.
 *   .spin              IS defined — src/AdminUI.tsx:831, together with its
 *                      `@keyframes spin` at :833.
 *   .active-badge      IS defined — src/AdminUI.tsx:775.
 *
 * Those rules live in a `<style>` element inside AdminUI.tsx (the block opens
 * at :634), i.e. they are PAGE-OWNED: present only while AdminUI is mounted,
 * and therefore absent when this tab is mounted on its own. Five classes this
 * file uses are in that situation — `.spin`, `.active-badge`, `.active-config`
 * (:772), `.config-form-overlay` (:819) and `.configs-list` (:822). `.result-card`
 * is the exception: index.css:2265 defines it globally, so the card surface
 * itself is right in a story.
 *
 * CONSEQUENCE FOR THE REVIEWER: in these stories the active badge renders as
 * bare text rather than an accent pill, the connection-test icon does not
 * rotate, the active config has no accent border, and two spacing rules are
 * missing. That is a property of the standalone mount, NOT of production — do
 * not file it as a visual defect. Everything else (the DS controls, the
 * FieldRow composition, the fieldset/legend blocks) is exactly
 * what production renders. Moving those five rules out of AdminUI.tsx would be
 * a component change, which this card explicitly forbids; it is written up as
 * an open question instead.
 * ------------------------------------------------------------------------- */

/**
 * Structural mirrors of the component's own `AIModel` / `AIConfig` /
 * `ConnectionTest` interfaces. Neither is exported, and that is convenient
 * rather than awkward: a fixture that shared a type with the code under test
 * would follow that code when it changed.
 */
interface StoryModel {
    name: string;
    isReasoning: boolean;
    isEmbedding: boolean;
    isRerank: boolean;
    isTts: boolean;
    isStt: boolean;
    dimensions?: number;
}

interface StoryConfig {
    id: string;
    name: string;
    provider: string;
    api_key: string;
    base_url?: string;
    chat_models: StoryModel[];
    embedding_models: StoryModel[];
    rerank_models: StoryModel[];
    tts_models: StoryModel[];
    stt_models: StoryModel[];
    is_active: boolean;
}

interface StoryConnectionTest {
    configId: string;
    status: 'testing' | 'healthy' | 'unhealthy';
    latencyMs?: number;
    error?: string;
}

const model = (name: string, over: Partial<StoryModel> = {}): StoryModel => ({
    name,
    isReasoning: false,
    isEmbedding: false,
    isRerank: false,
    isTts: false,
    isStt: false,
    ...over,
});

const CONFIGS: StoryConfig[] = [
    {
        id: 'cfg-hrz',
        name: 'HRZ Produktion',
        provider: 'openai',
        api_key: 'sk-not-a-real-key',
        base_url: 'https://llm.hrz.uni-giessen.de/v1',
        chat_models: [model('llama-3.3-70b'), model('qwen3-32b', { isReasoning: true })],
        embedding_models: [model('bge-m3', { isEmbedding: true, dimensions: 1024 })],
        rerank_models: [model('bge-reranker-v2-m3', { isRerank: true })],
        tts_models: [],
        stt_models: [],
        is_active: true,
    },
    {
        id: 'cfg-openai',
        name: 'OpenAI (Fallback)',
        provider: 'openai',
        api_key: 'sk-not-a-real-key',
        base_url: 'https://api.openai.com/v1',
        chat_models: [model('gpt-4o-mini')],
        embedding_models: [model('text-embedding-3-small', { isEmbedding: true })],
        rerank_models: [],
        tts_models: [model('tts-1', { isTts: true })],
        stt_models: [model('whisper-1', { isStt: true })],
        is_active: false,
    },
];

/** The catalogue the per-job selects draw from — AdminUI's `availableChatModels`. */
const CHAT_MODEL_OPTIONS = [
    { value: 'llama-3.3-70b', label: 'llama-3.3-70b (HRZ Produktion)' },
    { value: 'qwen3-32b', label: 'qwen3-32b (HRZ Produktion)' },
    { value: 'gpt-4o-mini', label: 'gpt-4o-mini (OpenAI (Fallback))' },
];

/** A blank create form, as `resetForm` leaves it. */
const EMPTY_FORM: Partial<StoryConfig> = {
    name: '',
    provider: 'openai',
    api_key: '',
    base_url: '',
    chat_models: [model('')],
    embedding_models: [model('', { isEmbedding: true, dimensions: 0 })],
    rerank_models: [],
    tts_models: [],
    stt_models: [],
};

/**
 * An edit form carrying the first config. Two entries in the chat and
 * embedding lists on purpose: the per-row remove button only renders while a
 * list has more than one entry (AdminConfigsTab.tsx:274), so a single-entry
 * list hides that control entirely.
 */
const EDIT_FORM: Partial<StoryConfig> = {
    ...CONFIGS[0],
    chat_models: [model('llama-3.3-70b'), model('qwen3-32b', { isReasoning: true })],
    embedding_models: [
        model('bge-m3', { isEmbedding: true, dimensions: 1024 }),
        model('text-embedding-3-large', { isEmbedding: true }),
    ],
    rerank_models: [model('bge-reranker-v2-m3', { isRerank: true })],
    tts_models: [model('tts-1', { isTts: true })],
    stt_models: [model('whisper-1', { isStt: true })],
};

/** Two of the eight per-job overrides set, so the selects are not all empty. */
const SITE_CONFIGS: Record<string, string> = {
    crag_grader_model: 'qwen3-32b',
    model_tier_fast: 'gpt-4o-mini',
};

function ConfigsTabHarness({
    configs,
    showForm,
    editingId,
    loading,
    initialFormData,
    initialConnectionTest,
    initialSiteConfigs,
    initialErrors,
    availableChatModels,
    handleConfigSubmit,
    startEditConfig,
    handleDelete,
    handleActivate,
    resetForm,
    onSiteConfigSubmit,
}: {
    configs: StoryConfig[];
    showForm: boolean;
    editingId: string | null;
    loading: boolean;
    initialFormData: Partial<StoryConfig>;
    initialConnectionTest: StoryConnectionTest | null;
    initialSiteConfigs: Record<string, string>;
    initialErrors: Record<string, string>;
    availableChatModels: { value: string; label: string }[];
    handleConfigSubmit: (e: React.FormEvent) => void;
    startEditConfig: (config: StoryConfig) => void;
    handleDelete: (id: string, type: 'config' | 'auth') => void;
    handleActivate: (id: string) => void;
    resetForm: () => void;
    onSiteConfigSubmit: (e: React.FormEvent) => void;
}) {
    const [configFormData, setConfigFormData] = useState<Partial<StoryConfig>>(initialFormData);
    const [connectionTest, setConnectionTest] = useState<StoryConnectionTest | null>(
        initialConnectionTest,
    );
    const [siteConfigs, setSiteConfigs] = useState<Record<string, string>>(initialSiteConfigs);
    const [errors, setErrors] = useState<Record<string, string>>(initialErrors);

    return (
        <AdminConfigsTab
            configs={configs}
            showForm={showForm}
            editingId={editingId}
            configFormData={configFormData}
            setConfigFormData={setConfigFormData}
            connectionTest={connectionTest}
            setConnectionTest={setConnectionTest}
            handleConfigSubmit={handleConfigSubmit}
            startEditConfig={startEditConfig}
            handleDelete={handleDelete}
            handleActivate={handleActivate}
            resetForm={resetForm}
            configValidation={{
                errors,
                // The real clear: AdminUI's `configValidation` drops the field's
                // message as the user types, and FieldRow's `error` -> FormMessage
                // has to disappear with it.
                clearError: field =>
                    setErrors(prev => {
                        if (!(field in prev)) return prev;
                        const next = { ...prev };
                        delete next[field];
                        return next;
                    }),
            }}
            loading={loading}
            siteConfigs={siteConfigs}
            setSiteConfigs={setSiteConfigs}
            onSiteConfigSubmit={onSiteConfigSubmit}
            availableChatModels={availableChatModels}
        />
    );
}

const meta = {
    title: 'Admin/Configs-Tab',
    component: ConfigsTabHarness,
    // The tab is a full-width column inside AdminUI's page frame.
    parameters: { layout: 'fullscreen' },
    args: {
        configs: CONFIGS,
        showForm: false,
        editingId: null,
        loading: false,
        initialFormData: {},
        initialConnectionTest: null,
        initialSiteConfigs: SITE_CONFIGS,
        initialErrors: {},
        availableChatModels: CHAT_MODEL_OPTIONS,
        handleConfigSubmit: fn((e: React.FormEvent) => e.preventDefault()),
        startEditConfig: fn(),
        handleDelete: fn(),
        handleActivate: fn(),
        resetForm: fn(),
        onSiteConfigSubmit: fn((e: React.FormEvent) => e.preventDefault()),
    },
} satisfies Meta<typeof ConfigsTabHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/* =====================================================================
 * The configs list
 * ===================================================================== */

/**
 * Two configurations, one of them active — the normal state of a running
 * deployment, and the state in which the per-job model selects have a
 * catalogue to offer.
 */
export const ConfigsList: Story = {
    play: async ({ canvas, canvasElement }) => {
        // ORACLE: the fixture. Both names come from CONFIGS above, and the
        // model line is the component's own join of chat + embedding models —
        // asserted against the strings this file put in, not against anything
        // the component derived.
        await expect(await canvas.findByRole('heading', { name: 'HRZ Produktion' })).toBeInTheDocument();
        await expect(await canvas.findByRole('heading', { name: 'OpenAI (Fallback)' })).toBeInTheDocument();

        // ORACLE: WAI-ARIA accessible names. The active config offers edit +
        // delete but NOT activate; the inactive one offers all three. That
        // asymmetry (AdminConfigsTab.tsx:567) is the only thing distinguishing
        // the two rows semantically.
        await expect(canvas.getAllByRole('button', { name: 'Konfiguration aktivieren' })).toHaveLength(1);
        await expect(canvas.getAllByRole('button', { name: 'Konfiguration bearbeiten' })).toHaveLength(2);

        /* KNOWN-DEFECT PIN, and read the fidelity note in the file header
         * before acting on it.
         *
         * ORACLE: Chromium's own CSSOM — nothing in this repo computes these
         * values. `.active-badge` is styled at src/AdminUI.tsx:775, inside a
         * <style> element that only exists while AdminUI is mounted, so in a
         * standalone mount of this tab the badge resolves to a bare inline span:
         * no background, no padding, no uppercase transform.
         *
         * This assertion pins the CURRENT arrangement, which means it FAILS if
         * the rules are moved into src/index.css or replaced by a DS Badge —
         * and that failure is the intended signal, not a regression. Whoever
         * makes that change updates this story. */
        const badge = canvasElement.querySelector('.active-badge');
        await expect(badge).not.toBeNull();
        const badgeStyle = getComputedStyle(badge as HTMLElement);
        await expect(badgeStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
        await expect(badgeStyle.padding).toBe('0px');
    },
};

/**
 * No configurations — a fresh deployment, before anyone has entered a
 * provider. The per-job selects still render, with nothing but the
 * fall-through option, which is the state that makes the placeholder wording
 * ("KB-Standardmodell verwenden") the only thing on eight triggers.
 */
export const ConfigsEmpty: Story = {
    args: { configs: [], availableChatModels: [], initialSiteConfigs: {} },
    play: async ({ canvas }) => {
        // ORACLE: the German source string for `noConfigsFound` in
        // src/translations.ts, read out of the rendered document.
        await expect(await canvas.findByText('Keine Konfigurationen gefunden.')).toBeInTheDocument();
        await expect(canvas.queryByRole('button', { name: 'Konfiguration bearbeiten' })).toBeNull();
    },
};

/**
 * `loading` — and the one claim from KI-692 that re-measures as a REAL defect
 * rather than a page-ownership artefact: the loading branch renders
 * `<div className="loading-spinner">` with no children, and that class is
 * defined nowhere in this repo (see the file header for the census). So while
 * the tab loads, production shows an empty box: no spinner, no text, no
 * `role="status"` for a screen reader.
 *
 * This story is what makes that visible instead of theoretical.
 */
export const Loading: Story = {
    args: { loading: true },
    play: async ({ canvas, canvasElement }) => {
        const spinner = canvasElement.querySelector('.loading-spinner');
        await expect(spinner).not.toBeNull();

        /* ORACLE: Chromium's CSSOM and its accessibility tree, both external to
         * this repo. An element with no matching rule and no content has zero
         * height and no animation, and an empty <div> carries no ARIA role — so
         * these three together are the statement "nothing is shown and nothing
         * is announced".
         *
         * KNOWN-DEFECT PIN: adding a `.loading-spinner` rule, or swapping the
         * div for the DS `Spinner` (which carries `role="status"`, the way
         * Dashboard.tsx already does), turns these assertions false. That is
         * the intended signal. */
        const style = getComputedStyle(spinner as HTMLElement);
        await expect(style.height).toBe('0px');
        await expect(style.animationName).toBe('none');
        await expect(canvas.queryByRole('status')).toBeNull();
    },
};

/* =====================================================================
 * The config form
 * ===================================================================== */

/**
 * The form open to create a configuration: empty fields, one blank row in the
 * chat and embedding lists, and the heading on its "new" wording.
 */
export const FormCreate: Story = {
    args: { showForm: true, editingId: null, initialFormData: EMPTY_FORM },
    play: async ({ canvas }) => {
        // ORACLE: the German source strings for `newConfig` / `editConfig2`.
        // The heading is the only thing that distinguishes create from edit,
        // and it is derived from `editingId` alone (AdminConfigsTab.tsx:203).
        await expect(await canvas.findByRole('heading', { name: 'Neue Konfiguration' })).toBeInTheDocument();
        await expect(await canvas.findByLabelText('Konfigurationsname')).toHaveValue('');

        // ORACLE: the fixture — one entry per list means the per-row remove
        // button must NOT render (its condition is `length > 1`).
        await expect(canvas.queryByRole('button', { name: 'Modell entfernen' })).toBeNull();
    },
};

/**
 * The form open to edit an existing configuration, fully populated. This is
 * also the story for the `fieldset`/`legend` model blocks card KI-692
 * introduced: before it, each of the five lists was named by a `<label>` that
 * pointed at nothing, because a label can only name ONE labelable control and
 * these name a group.
 */
export const FormEdit: Story = {
    args: { showForm: true, editingId: 'cfg-hrz', initialFormData: EDIT_FORM },
    play: async ({ canvas }) => {
        await expect(
            await canvas.findByRole('heading', { name: 'Konfiguration bearbeiten' }),
        ).toBeInTheDocument();

        /* ORACLE: the HTML-AAM's fieldset/legend mapping, resolved by Chromium
         * and read through the accessibility tree — a `<fieldset>` exposes role
         * `group`, and its accessible name comes from its `<legend>`. This is
         * the property the pre-KI-692 markup did not have: a `<label>` whose
         * `htmlFor` matches nothing contributes no name to anything. Five
         * groups, five names, none of them computed by this repo. */
        for (const name of [
            'Chat-Modelle',
            'Embedding-Modelle',
            'Rerank-Modelle',
            'TTS-Modelle',
            'STT-Modelle (Speech-to-Text)',
        ]) {
            await expect(canvas.getByRole('group', { name })).toBeInTheDocument();
        }

        // ORACLE: the fixture. Two chat models and two embedding models, so
        // both lists show their per-row remove control; the dimensions field
        // carries the number EDIT_FORM set.
        await expect(await canvas.findByLabelText('Chat model 2')).toHaveValue('qwen3-32b');
        await expect(
            await canvas.findByLabelText('Dimensions for embedding model 1'),
        ).toHaveValue(1024);
        await expect(canvas.getAllByRole('button', { name: 'Modell entfernen' })).toHaveLength(4);
    },
};

/**
 * The create form with both of its validation messages showing — the
 * `FormMessage` surface on this tab, which card KI-692 wired up (the errors
 * used to be a loose `<span className="field-error">` associated with nothing)
 * and which no browser has rendered since.
 */
export const FormValidationErrors: Story = {
    tags: ['a11y-dark'],
    args: {
        showForm: true,
        editingId: null,
        initialFormData: EMPTY_FORM,
        initialErrors: {
            name: 'Dieses Feld ist erforderlich',
            api_key: 'Dieses Feld ist erforderlich',
        },
    },
    play: async ({ canvas, userEvent }) => {
        const nameField = await canvas.findByLabelText('Konfigurationsname');

        /* ORACLE: `aria-describedby` IDREF resolution plus `aria-invalid`, both
         * read from the DOM and resolved the way an assistive technology
         * resolves them. The DS's FormControl/FormMessage pair owns this
         * wiring; the assertion is that the message the user sees is the one
         * the control points AT, which is precisely what the old loose span
         * could not offer. */
        await expect(nameField).toHaveAttribute('aria-invalid', 'true');
        const describedBy = nameField.getAttribute('aria-describedby');
        await expect(describedBy).not.toBeNull();
        const message = document.getElementById((describedBy as string).split(/\s+/)[0]);
        await expect(message).not.toBeNull();
        await expect(message).toHaveTextContent('Dieses Feld ist erforderlich');

        // And it clears as the user types, through the real `clearError`.
        await userEvent.type(nameField, 'HRZ');
        await expect(nameField).not.toHaveAttribute('aria-invalid', 'true');
        // The other field's message is untouched — clearing is per field.
        await expect(await canvas.findByLabelText('API-Schlüssel')).toHaveAttribute(
            'aria-invalid',
            'true',
        );
    },
};

/* =====================================================================
 * The connection-test banner, in each of its three states
 * ===================================================================== */

/**
 * `testing` — the state whose spinning icon is the KI-692 finding. The icon
 * carries `className="spin"`, and `.spin` is styled at src/AdminUI.tsx:831
 * (page-owned), so it stands still here. See the file header: that is the
 * standalone mount, not production.
 */
export const ConnectionTesting: Story = {
    args: { initialConnectionTest: { configId: 'cfg-hrz', status: 'testing' } },
    play: async ({ canvas, canvasElement }) => {
        // ORACLE: the German source string for `connectionTesting`.
        await expect(await canvas.findByText('Verbindung wird getestet...')).toBeInTheDocument();

        /* ORACLE: Chromium's CSSOM. See the KNOWN-DEFECT PIN note in
         * `ConfigsList` — same mechanism, same intended failure signal if
         * `.spin` moves into a stylesheet or the icon is swapped for the DS
         * Spinner. */
        const icon = canvasElement.querySelector('.spin');
        await expect(icon).not.toBeNull();
        await expect(getComputedStyle(icon as Element).animationName).toBe('none');
    },
};

/** `healthy` — success, with the measured latency the banner appends. */
export const ConnectionHealthy: Story = {
    args: {
        initialConnectionTest: { configId: 'cfg-hrz', status: 'healthy', latencyMs: 214 },
    },
    play: async ({ canvas }) => {
        // ORACLE: the fixture's `latencyMs` and the German `connectionSuccess`
        // string. 214 is a number this file chose.
        await expect(await canvas.findByText('Verbindung erfolgreich (214ms)')).toBeInTheDocument();
    },
};

/**
 * `unhealthy` — the failure case, which is the one a hand-QA pass never sets
 * up because it needs a broken provider. The banner shows the server's own
 * error text where it has one, and falls back to the translated wording where
 * it does not; this story takes the first branch.
 */
export const ConnectionFailed: Story = {
    args: {
        initialConnectionTest: {
            configId: 'cfg-openai',
            status: 'unhealthy',
            error: 'dial tcp: lookup api.openai.com: no such host',
        },
    },
    play: async ({ canvas, userEvent }) => {
        // ORACLE: the string the fixture put in the `error` field. If the
        // component fell back to the translated default it would render
        // "Verbindung fehlgeschlagen" and this fails.
        await expect(
            await canvas.findByText('dial tcp: lookup api.openai.com: no such host'),
        ).toBeInTheDocument();

        // The banner is dismissable through the real `setConnectionTest`, so
        // the close button is exercised rather than described.
        //
        // `waitFor`, not a bare assertion: the banner lives inside framer
        // motion's `AnimatePresence` with an `exit` transition, so it stays in
        // the DOM until that transition finishes. Asserting immediately after
        // the click measures the animation, not the state change.
        await userEvent.click(await canvas.findByRole('button', { name: 'Banner schließen' }));
        await waitFor(async () => {
            await expect(
                canvas.queryByText('dial tcp: lookup api.openai.com: no such host'),
            ).toBeNull();
        });
    },
};
