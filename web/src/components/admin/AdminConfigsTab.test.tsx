import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import AdminConfigsTab from './AdminConfigsTab';
import { translations } from '../../translations';

/* ---------------------------------------------------------------------------
 * This suite exists because of the design-system migration of this file (board
 * card KI-692). There was no test on it before, so nothing checked the two
 * things the migration changed:
 *
 *   1. the label/control pairing — the four explicit ids (`config-name`,
 *      `config-provider`, `config-api-key`, `config-base-url`, plus
 *      `job-<key>`) were dropped in favour of <FormControl>'s injected id, and
 *      the five `<label>`s that headed a model LIST pointed at nothing at all;
 *   2. the write paths, because the controls changed type: a native checkbox
 *      became a Radix Checkbox (`onCheckedChange`) and nine native selects
 *      became Radix listboxes (`onValueChange`).
 *
 * Every test names its oracle. The oracles are the HTML spec (via jsdom),
 * WAI-ARIA, the Go request DTOs (go-backend/internal/adminconfigs/handler.go
 * and the site_config contract), Radix's documented placeholder rule, and a
 * census of the PRE-migration source at the card's claim base (4a40861).
 * ------------------------------------------------------------------------- */

const tMock = (key: string) => {
    const entry = translations[key as keyof typeof translations];
    return entry ? entry.en : key;
};
const themeMock = { t: tMock };
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
vi.mock('../../hooks/useReducedMotion', () => ({
    useReducedMotion: () => false,
    getMotionProps: () => ({}),
}));

beforeEach(() => {
    // Radix's Select trigger measures and captures pointers; jsdom implements
    // neither. Standard jsdom accommodation, it only enables opening the list.
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
});

const emptyModel = {
    isReasoning: false,
    isEmbedding: false,
    isRerank: false,
    isTts: false,
    isStt: false,
};

/**
 * The form fixture. Two chat models (so the per-row remove button, which the
 * source renders only when `length > 1`, is present) and one model in each of
 * the other four lists.
 */
const FORM_DATA = {
    name: 'HRZ vLLM',
    provider: 'openai',
    api_key: 'sk-secret',
    base_url: 'https://ai.example.org/v1',
    chat_models: [
        { ...emptyModel, name: 'gemma-4-26b', isReasoning: true },
        { ...emptyModel, name: 'qwen3-32b' },
    ],
    embedding_models: [{ ...emptyModel, name: 'bge-m3', isEmbedding: true, dimensions: 1024 }],
    rerank_models: [{ ...emptyModel, name: 'bge-reranker', isRerank: true }],
    tts_models: [{ ...emptyModel, name: 'tts-1', isTts: true }],
    stt_models: [{ ...emptyModel, name: 'whisper-1', isStt: true }],
};

const CONFIGS = [
    {
        id: 'cfg-1',
        name: 'HRZ vLLM',
        provider: 'openai',
        api_key: '***',
        chat_models: [{ ...emptyModel, name: 'gemma-4-26b' }],
        embedding_models: [{ ...emptyModel, name: 'bge-m3', isEmbedding: true }],
        rerank_models: [],
        tts_models: [],
        stt_models: [],
        is_active: false,
    },
];

/**
 * `availableChatModels` deliberately carries the SAME model name twice under
 * two config names — see the comment on `availableChatModels` in AdminUI.tsx:
 * "If the SAME name appears under multiple providers, show both". The values
 * collide, only the labels differ.
 */
const CHAT_MODEL_OPTIONS = [
    { value: 'gemma-4-26b', label: 'gemma-4-26b (HRZ vLLM)' },
    { value: 'gemma-4-26b', label: 'gemma-4-26b (Fallback)' },
    { value: 'qwen3-32b', label: 'qwen3-32b (HRZ vLLM)' },
];

const clearError = vi.fn();
const handleConfigSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
const onSiteConfigSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
const resetForm = vi.fn();
const startEditConfig = vi.fn();
const handleDelete = vi.fn();
const handleActivate = vi.fn();

type Overrides = {
    errors?: Record<string, string>;
    siteConfigs?: Record<string, string>;
    showForm?: boolean;
};

/**
 * Renders the tab with real state for the two records a control can write into
 * (`configFormData`, `siteConfigs`), so a write is observable. `latest()`
 * returns both.
 */
function renderTab({ errors = {}, siteConfigs = {}, showForm = true }: Overrides = {}) {
    const seen = { form: FORM_DATA as Record<string, unknown>, configs: siteConfigs };

    function Harness() {
        const [configFormData, setConfigFormData] = useState<typeof FORM_DATA>(FORM_DATA);
        const [site, setSiteConfigs] = useState<Record<string, string>>(siteConfigs);
        seen.form = configFormData;
        seen.configs = site;
        return (
            <AdminConfigsTab
                configs={CONFIGS}
                showForm={showForm}
                editingId={null}
                configFormData={configFormData}
                setConfigFormData={setConfigFormData as never}
                connectionTest={null}
                setConnectionTest={vi.fn()}
                handleConfigSubmit={handleConfigSubmit}
                startEditConfig={startEditConfig}
                handleDelete={handleDelete}
                handleActivate={handleActivate}
                resetForm={resetForm}
                configValidation={{ errors, clearError }}
                loading={false}
                siteConfigs={site}
                setSiteConfigs={setSiteConfigs}
                onSiteConfigSubmit={onSiteConfigSubmit}
                availableChatModels={CHAT_MODEL_OPTIONS}
            />
        );
    }

    const result = render(<Harness />);
    return {
        ...result,
        latestForm: () => seen.form as typeof FORM_DATA,
        latestSiteConfigs: () => seen.configs,
    };
}

describe('AdminConfigsTab — label/control pairing', () => {
    it('resolves every label to a real, labelable control', () => {
        // ORACLE: the HTML specification, applied by jsdom. `label[for]` must
        // name an element that exists and is labelable (button, input, meter,
        // output, progress, select, textarea). Pre-migration five of the
        // twelve `<label>`s in this file headed a model LIST and had no `for`
        // and no nested control — they are fieldset/legend now, so every
        // remaining label must resolve.
        const { container } = renderTab();

        const labels = Array.from(container.querySelectorAll('label[for]'));
        // name, provider, api key, base url, one "Reasoning" per chat model (2),
        // 8 MODEL_JOBS + model_tier_fast = 15.
        expect(labels).toHaveLength(15);

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

    it('leaves no label without a control at all', () => {
        // ORACLE: the HTML spec again — a <label> is defined by what it labels;
        // one with neither `for` nor a nested labelable descendant labels
        // nothing. The five model-list headings used to be exactly that.
        const { container } = renderTab();

        const orphans = Array.from(container.querySelectorAll('label'))
            .filter(l => !l.hasAttribute('for'))
            .filter(l => !l.querySelector('button, input, meter, output, progress, select, textarea'))
            .map(l => l.textContent?.trim());

        expect(orphans).toEqual([]);
    });

    it('names each model group with a legend instead', () => {
        // ORACLE: the HTML grouping semantics that replaced those labels —
        // fieldset/legend, one per model list, with the same five headings the
        // pre-migration source used.
        const { container } = renderTab();

        expect(Array.from(container.querySelectorAll('fieldset > legend')).map(l => l.textContent)).toEqual([
            tMock('chatModels'),
            tMock('embeddingModels'),
            tMock('rerankModels'),
            tMock('ttsModels'),
            tMock('sttModels'),
        ]);
    });

    it('leaves no aria-describedby pointing at a missing element', () => {
        // ORACLE: WAI-ARIA — an aria-describedby IDREF must resolve. Both
        // branches matter here: FormControl points it at the DESCRIPTION
        // normally and at the MESSAGE when a row carries an error, so this is
        // rendered with one of each.
        const { container } = renderTab({ errors: { name: 'Name is required' } });

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

describe('AdminConfigsTab — control census', () => {
    it('renders one control per row, of the right kind', () => {
        // ORACLE: a census of the PRE-migration source at the claim base
        // (`git show 4a40861:web/src/components/admin/AdminConfigsTab.tsx`) —
        // the artifact eslint-suppressions.json counted 28 hits in:
        //   10 raw <input> = 1 checkbox + 1 number + 1 password + 7 untyped text
        //   +  3 raw <select>
        //   + 18 raw <button>
        // With this fixture (2 chat models, 1 each of the other four lists) the
        // rendered instances are:
        //   password  : api key                                          = 1
        //   number    : dimensions, one per embedding model              = 1
        //   text      : name + base url (2) and one field per model name
        //               (2 chat + embedding + rerank + tts + stt = 6)      = 8
        //   checkbox  : "Reasoning", one per chat model                   = 2
        //   combobox  : provider + 8 MODEL_JOBS + model_tier_fast         = 10
        const { container } = renderTab();

        expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1);
        expect(container.querySelectorAll('input[type="number"]')).toHaveLength(1);
        // The DS Input renders no `type` attribute when none is passed, exactly
        // as the pre-migration `<input id="config-name" …>` did.
        expect(container.querySelectorAll('input:not([type])')).toHaveLength(8);
        expect(container.querySelectorAll('[role="checkbox"]')).toHaveLength(2);
        expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(10);
    });

    it('keeps every raw <button> out of the tab', () => {
        // ORACLE: the design-system rule this card burns down — this file's 28
        // entries leave web/eslint-suppressions.json, which only holds if no raw
        // <button> survives.
        //
        // The marker is `active:scale-95`, not `rounded-action`: `size="icon"`
        // adds `rounded-full`, and tailwind-merge resolves that conflict by
        // dropping `rounded-action` from the class list.
        const { container } = renderTab();

        const strays = Array.from(container.querySelectorAll('button')).filter(b => {
            if (b.getAttribute('role') === 'checkbox') return false; // DS Checkbox
            if (b.getAttribute('role') === 'combobox') return false; // DS SelectTrigger
            return !b.className.split(/\s+/).includes('active:scale-95'); // DS Button
        });

        expect(strays.map(b => b.getAttribute('aria-label') || b.textContent?.trim())).toEqual([]);
    });

    it('keeps the per-row model fields addressable by their accessible names', () => {
        // ORACLE: the pre-migration source's aria-labels, which are the only
        // accessible names those fields ever had ("Chat model 1", "Dimensions
        // for embedding model 1", …). They are carried over verbatim.
        renderTab();
        expect(screen.getByRole('textbox', { name: 'Chat model 1' })).toHaveValue('gemma-4-26b');
        expect(screen.getByRole('textbox', { name: 'Chat model 2' })).toHaveValue('qwen3-32b');
        expect(screen.getByRole('spinbutton', { name: 'Dimensions for embedding model 1' })).toHaveValue(1024);
        expect(screen.getByRole('textbox', { name: 'Rerank model 1' })).toHaveValue('bge-reranker');
    });
});

describe('AdminConfigsTab — validation errors', () => {
    it('associates the error with its control instead of leaving it loose', () => {
        // ORACLE: WAI-ARIA. Pre-migration the message was a sibling
        // `<span className="field-error" role="alert">` with NO association to
        // the input: a screen-reader user on the field never heard why it was
        // rejected. FieldRow's new `error` prop routes it through the DS
        // FormItem/FormControl/FormMessage wiring, which is what this asserts —
        // aria-invalid on the control, and its description resolving to the
        // message text.
        const { container } = renderTab({ errors: { name: 'Name is required', api_key: 'Key is required' } });

        for (const [label, message] of [
            [tMock('configName'), 'Name is required'],
            [tMock('apiKey'), 'Key is required'],
        ]) {
            const field = screen.getByLabelText(label);
            expect(field).toHaveAttribute('aria-invalid', 'true');
            const describedBy = field.getAttribute('aria-describedby')!;
            const described = container.querySelector(`[id="${CSS.escape(describedBy)}"]`);
            expect(described).toHaveTextContent(message);
            expect(described).toHaveAttribute('role', 'alert');
        }
    });

    it('reports no error on a clean field', () => {
        // ORACLE: the same wiring read the other way — a row without an error
        // must not claim aria-invalid, or every field would announce as invalid.
        renderTab();
        expect(screen.getByLabelText(tMock('configName'))).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('clears the error as the user types, as before', () => {
        // ORACLE: the pre-migration handler —
        // `onChange={e => { setConfigFormData(…); configValidation.clearError('name'); }}`.
        // The handler moved onto a DS Input; the call must still happen.
        renderTab({ errors: { name: 'Name is required' } });
        fireEvent.change(screen.getByLabelText(tMock('configName')), { target: { value: 'X' } });
        expect(clearError).toHaveBeenCalledWith('name');
    });
});

describe('AdminConfigsTab — bindings survive the migration', () => {
    it('writes a real boolean when the reasoning checkbox is toggled', async () => {
        // ORACLE: the backend DTO. go-backend/internal/adminconfigs/handler.go
        // declares `AIModelInput{ IsReasoning bool `json:"isReasoning"` }`, so
        // this must stay a JSON boolean — NOT the 'true'/'false' strings that
        // the site_config table uses (see AdminAgentTab.test.tsx). The handler
        // shape changed here, from `onChange={e => … e.target.checked …}` to
        // `onCheckedChange={checked => …}`, so this asserts the stored value.
        const { latestForm } = renderTab();

        const [first] = screen.getAllByRole('checkbox', { name: tMock('reasoning') });
        expect(first).toHaveAttribute('aria-checked', 'true');

        await userEvent.click(first);
        expect(latestForm().chat_models[0].isReasoning).toBe(false);
        expect(typeof latestForm().chat_models[0].isReasoning).toBe('boolean');
        // Only that row changed — the second chat model is untouched.
        expect(latestForm().chat_models[1].isReasoning).toBe(false);
    });

    it('stores a model name as the raw string the user typed', () => {
        // ORACLE: the same DTO — `Name string`. A DS Input that coerced or
        // trimmed would change the POST body.
        const { latestForm } = renderTab();
        fireEvent.change(screen.getByRole('textbox', { name: 'Chat model 2' }), { target: { value: 'llama-4  ' } });
        expect(latestForm().chat_models[1].name).toBe('llama-4  ');
    });

    it('keeps the dimensions field numeric and parsed through the shared helper', () => {
        // ORACLE: the DTO's `Dimensions int` plus utils/embeddingDimensions,
        // which is where the '' -> undefined / 'auto' handling lives. The field
        // must still route through it rather than through the DS Input.
        const { latestForm } = renderTab();
        const dims = screen.getByRole('spinbutton', { name: 'Dimensions for embedding model 1' });
        expect(dims).toHaveAttribute('min', '0');

        fireEvent.change(dims, { target: { value: '2560' } });
        expect(latestForm().embedding_models[0].dimensions).toBe(2560);
    });

    it('removes exactly the model row whose button was pressed', () => {
        // ORACLE: the pre-migration source —
        // `filter((_, i) => i !== idx)`, rendered only when `length > 1`.
        const { latestForm } = renderTab();

        const removes = screen.getAllByRole('button', { name: tMock('removeModel') });
        // One per chat model (2 rows), none for the single-entry lists.
        expect(removes).toHaveLength(2);

        fireEvent.click(removes[0]);
        expect(latestForm().chat_models.map(m => m.name)).toEqual(['qwen3-32b']);
    });
});

describe('AdminConfigsTab — per-job model selects', () => {
    it('shows the fall-through wording as the placeholder while unset', () => {
        // ORACLE: Radix's own rule (@radix-ui/react-select 2.3.7:
        // `shouldShowPlaceholder(value) => value === "" || value === undefined`).
        // The empty option is therefore expressed as the trigger placeholder;
        // the item with value '' still exists so the choice can be taken back.
        renderTab();
        expect(screen.getByRole('combobox', { name: tMock('cragGraderModel') }))
            .toHaveTextContent(tMock('useKbDefaultModel'));
    });

    it('shows a stored value even when it is no longer in the catalogue', () => {
        // ORACLE: the pre-migration source's extra <option> and the comment
        // above it — "If the saved value isn't in the catalogue (model removed
        // or renamed), keep it as an extra option so it stays visible until the
        // admin actively changes it."
        renderTab({ siteConfigs: { crag_grader_model: 'retired-model-v1' } });
        expect(screen.getByRole('combobox', { name: tMock('cragGraderModel') }))
            .toHaveTextContent('retired-model-v1');
    });

    it('writes the chosen model name into site_configs as a string', async () => {
        // ORACLE: the site_config wire contract — site_configs is a
        // Record<string,string> POSTed verbatim to /api/site-config, and the
        // backend's model resolution chain reads the per-task key as a model
        // NAME (CLAUDE.md, "Model tier resolution"). The control changed from a
        // native <select> to a Radix listbox, so this asserts the stored value.
        const { latestSiteConfigs } = renderTab();

        await userEvent.click(screen.getByRole('combobox', { name: tMock('cragGraderModel') }));
        await userEvent.click(await screen.findByRole('option', { name: 'qwen3-32b (HRZ vLLM)' }));

        expect(latestSiteConfigs().crag_grader_model).toBe('qwen3-32b');
        expect(typeof latestSiteConfigs().crag_grader_model).toBe('string');
    });

    it('lists a model name that exists in two configs exactly once', async () => {
        // ORACLE: Radix's own item bookkeeping (@radix-ui/react-select 2.3.7,
        // `jsx("option", { value: itemContext.value … }, itemContext.value)` —
        // the hidden native option is KEYED BY VALUE). `availableChatModels`
        // lists one entry per (model, config) pair, so the same name can arrive
        // twice; passing both through would produce a React duplicate-key
        // warning inside the Select and two simultaneously checked items. The
        // fixture contains that collision deliberately.
        renderTab();

        await userEvent.click(screen.getByRole('combobox', { name: tMock('modelTierFast') }));
        const options = await screen.findAllByRole('option');
        expect(options.map(o => o.textContent)).toEqual([
            tMock('useKbDefaultModel'),
            'gemma-4-26b (HRZ vLLM)',
            'qwen3-32b (HRZ vLLM)',
        ]);
    });

    it('can be set back to the fall-through option', async () => {
        // ORACLE: the pre-migration `<option value="">` was selectable, so the
        // migrated control must be able to write '' back — this is the reason
        // the empty option stays in the list instead of only being a
        // placeholder.
        const { latestSiteConfigs } = renderTab({ siteConfigs: { model_tier_fast: 'qwen3-32b' } });

        await userEvent.click(screen.getByRole('combobox', { name: tMock('modelTierFast') }));
        await userEvent.click(await screen.findByRole('option', { name: tMock('useKbDefaultModel') }));

        expect(latestSiteConfigs().model_tier_fast).toBe('');
    });
});

describe('AdminConfigsTab — submit', () => {
    it('submits each form from its own button and nothing else', async () => {
        // ORACLE: HTML form semantics. The DS Checkbox and SelectTrigger are
        // <button>s inside a <form>; one that defaulted to type="submit" would
        // save on every click. Radix sets type="button", and the icon buttons
        // pass it explicitly.
        renderTab();

        await userEvent.click(screen.getAllByRole('checkbox', { name: tMock('reasoning') })[0]);
        await userEvent.click(screen.getAllByRole('button', { name: tMock('addModel') })[0]);
        expect(handleConfigSubmit).not.toHaveBeenCalled();
        expect(onSiteConfigSubmit).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: new RegExp(tMock('saveConfig'), 'i') }));
        expect(handleConfigSubmit).toHaveBeenCalledTimes(1);

        await userEvent.click(screen.getByRole('button', { name: new RegExp(tMock('saveSettings'), 'i') }));
        expect(onSiteConfigSubmit).toHaveBeenCalledTimes(1);
    });

    it('reports no HTML constraint violation on the config form', () => {
        // ORACLE: the HTML constraint-validation algorithm, run by jsdom. The
        // migration moved min/step attributes onto DS controls; a mismatched
        // pair (as found on AdminAgentTab's hnsw_ef_search, card KI-691) makes
        // the browser silently refuse to submit the whole form.
        const { container } = renderTab();
        const invalid = Array.from(container.querySelectorAll('input')).filter(i => !i.checkValidity());
        expect(invalid.map(i => i.getAttribute('aria-label') || i.id)).toEqual([]);
    });

    it('offers activate, edit and delete per config row', () => {
        // ORACLE: the pre-migration source — three icon buttons per row, with
        // activate rendered only for an inactive config. All three carried an
        // aria-label already; they must keep it as DS Buttons.
        renderTab({ showForm: false });
        expect(screen.getByRole('button', { name: tMock('activateConfig') })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: tMock('editConfig') })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: tMock('deleteConfig') })).toBeInTheDocument();
    });
});
