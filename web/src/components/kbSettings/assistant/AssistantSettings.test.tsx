import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KbSettingsDialog } from '../../KbSettingsDialog';
import { SOURCE_FLAG_DEFAULTS } from '../../../utils/kbRoleRights';
import type { KnowledgeBase } from '../../../types';
import type { AssistantSettingsInput, AssistantSettingsResponse, Behavior, SettingsVersion, StartPage } from './api';
import * as api from './api';

// Keys with a placeholder resolve to something a query can tell apart; every
// other key reads as itself.
const PLACEHOLDERS: Record<string, string> = {
    asstActionsFor: 'actions {name}',
    asstEntryActions: 'entry-actions {n}',
    asstQuestionLabel: 'question {n}',
    asstRestoreAs: 'restore-as v{m}',
    asstRestoredFlash: 'restored v{n} as v{m}',
};
vi.mock('../../../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => PLACEHOLDERS[k] ?? k, language: 'de' }) }));
const showConfirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../../contexts/ModalContext', () => ({ useModalContext: () => ({ showConfirm }) }));
vi.mock('axios', () => ({ default: { get: vi.fn(async () => ({ data: { prompt: 'RAG' } })), put: vi.fn(), isAxiosError: () => false } }));
vi.mock('../KbMembersPanel', () => ({ KbMembersPanel: () => null }));
// The role cards' carousel and cover band are newer than the pinned DS: stand-ins until the pin bump.

let behavior: Behavior;
let startPage: StartPage;
let version: number;
let versions: SettingsVersion[];

function response(): AssistantSettingsResponse {
    return {
        title: 'Personalrecht', description: null, categoryId: null,
        behavior: { behavior, customized: true, language: 'de' },
        startPage, startPageConfigured: true, version, canRename: true,
    };
}

vi.mock('./api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./api')>();
    return {
        ...actual,
        fetchAssistantSettings: vi.fn(async () => response()),
        saveAssistantSettings: vi.fn(async (_kb: string, input: AssistantSettingsInput) => {
            behavior = input.behavior;
            startPage = input.startPage;
            version += 1;
            return { ...response(), title: input.title, description: input.description };
        }),
        fetchSettingsVersions: vi.fn(async () => versions),
        restoreSettingsVersion: vi.fn(async () => { version += 1; return response(); }),
        resetBehavior: vi.fn(async () => ({ behavior, customized: false, language: 'de' })),
        fetchCategoryCatalog: vi.fn(async () => []),
        fetchBehaviorCatalog: vi.fn(async () => ({
            language: 'de',
            roles: [
                { id: 'research', name: 'Forschung', description: 'd', prompt: 'FORSCHUNG', icon: 'graduation-cap', isDefault: true },
                { id: 'tutor', name: 'Tutor', description: 'd', prompt: 'TUTOR', icon: 'book-open', isDefault: false },
            ],
            ruleGroups: [{ id: 'style', title: 'Stil', rules: [{ id: 'short', label: 'Kurz', description: '', text: 'Kurz antworten.', defaultOn: true }] }],
            rulesHeading: 'Regeln:',
            limits: { promptMax: 8000, roleNameMax: 80, ruleMax: 300, customRolesMax: 20, customRulesMax: 20 },
        })),
        fetchStarterQuestions: vi.fn(async () => ['Dyn 1', 'Dyn 2', 'Dyn 3', 'Dyn 4', 'Dyn 5']),
    };
});

// Radix Select opens on pointer events jsdom lacks.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => undefined;
Element.prototype.scrollIntoView ??= () => undefined;

function memoryStorage(): Storage {
    const m = new Map<string, string>();
    return {
        get length() { return m.size; },
        clear: () => m.clear(),
        getItem: (k) => m.get(k) ?? null,
        key: (i) => [...m.keys()][i] ?? null,
        removeItem: (k) => { m.delete(k); },
        setItem: (k, v) => { m.set(k, String(v)); },
    };
}

const entry = (id: string, roleId: string) => ({ id, roleId });
const inputStart = () => ({ kind: 'input' as const, text: '', send: true, instruction: '', suggestions: { questionsOn: false, questionMode: 'dynamic' as const, dynamicCount: 4 as const, fixedQuestions: [] } });

beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.mocked(api.saveAssistantSettings).mockClear();
    vi.mocked(api.restoreSettingsVersion).mockClear();
    behavior = {
        version: 1, activeRoleId: 'research',
        customRoles: [{ id: 'c-1', name: 'Eigene', description: '', prompt: 'EIGEN', icon: 'user-round' }],
        roleRules: { 'c-1': { rules: { short: true }, customRules: [] } },
    };
    startPage = {
        version: 1, colors: { from: '#0056B3', to: '#3897E8' }, startMode: 'input',
        questionsOn: false, questionMode: 'dynamic', dynamicCount: 4, fixedQuestions: ['Fix 1'],
        uploadLabel: '', uploadInstruction: '',
        roleStarts: { 'c-1': inputStart() },
        roleEntries: [entry('re-1', 'c-1')],
    };
    version = 2;
    versions = [
        { number: 2, kind: 'save', createdAt: '2026-10-20T10:00:00Z', authorId: 'u1', authorName: 'Anna Krüger', note: null, changes: [{ area: 'behavior', field: 'activeRole', from: 'Tutor', to: 'Forschung' }] },
        { number: 1, kind: 'baseline', createdAt: '2026-10-19T10:00:00Z', authorId: null, authorName: '', note: null, changes: [] },
    ];
});

const kb = { id: 'kb-1', name: 'Personalrecht', description: null, myRole: 'owner', fileCount: 3 } as KnowledgeBase;

async function renderSection(section: 'start' | 'behavior' | 'versions') {
    const onUpdateKb = vi.fn(async () => true);
    render(
        <KbSettingsDialog
            kb={kb} initialSection={section} onSave={vi.fn(async () => true)} onUpdateKb={onUpdateKb}
            onClose={vi.fn()} flags={{ ...SOURCE_FLAG_DEFAULTS }} onFlagsChange={vi.fn()} dirty={false}
        />,
    );
    if (section === 'start') await screen.findByText('asstStartNotice');
    else if (section === 'behavior') await screen.findByRole('radiogroup', { name: 'asstRoles' });
    else await screen.findByText('asstRestoreNote');
    return { onUpdateKb };
}

const saveButton = () => screen.getByRole('button', { name: /save/ });
const tile = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${name}.*asstShowPreview$`) });
const useRole = async (name: string) => {
    await userEvent.click(screen.getByRole('button', { name: `actions ${name}` }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /asstUseThisRole/ }));
};
const previewPanel = () => screen.getByRole('region', { name: 'asstPreviewOf' });
const savedInput = () => vi.mocked(api.saveAssistantSettings).mock.calls[0][1];
// „Bearbeiten" opens both editors; the chat start's „Fertig" closes both.
const editChatStart = () => userEvent.click(screen.getByRole('button', { name: 'asstEditStartPage' }));
const doneChatStart = () => userEvent.click(screen.getByRole('button', { name: /asstDone/ }));
// „Start bearbeiten" in the role edit screen swaps the chat image for the start's editor.
// The role's edit screen, from its card's ⋮ menu; „Änderungen übernehmen" takes it into the draft.
const openEditor = async (name: string) => {
    await userEvent.click(screen.getByRole('button', { name: `actions ${name}` }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /asstEdit/ }));
};
const applyEditor = () => userEvent.click(screen.getByRole('button', { name: /asstApplyChanges/ }));

// Oracle: ANWEISUNG §1.2 / §3 — a click only previews a role; it becomes the
// active one with „Diese Rolle verwenden" (since 28.10.2026 in the card's ⋮ menu).
describe('Verhalten · roles', () => {
    it('activates a role only with „Diese Rolle verwenden" and saves it as one version', async () => {
        await renderSection('behavior');
        await userEvent.click(tile('Tutor'));
        expect(screen.getByRole('region', { name: 'asstPreviewOf' })).toHaveTextContent('TUTOR');
        expect(screen.getByText('kbSettingsNoChanges')).toBeInTheDocument();
        await useRole('Tutor');
        expect(screen.getByText('asstUnsaved')).toBeInTheDocument();
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalledTimes(1));
        expect(savedInput().behavior.activeRoleId).toBe('tutor');
        expect(savedInput().baseVersion).toBe(2);
        expect(await screen.findByText('kbSettingsSaved')).toBeInTheDocument();
    });

    // Oracle: developer ruling 28.10.2026 — „Verwenden" is the left half of the
    // header's split button, shown on hover, never on the active card.
    it('activates a role from its card', async () => {
        await renderSection('behavior');
        const card = (name: string) => tile(name).parentElement as HTMLElement;
        expect(within(card('Tutor')).queryByRole('button', { name: /asstUseThisRole/ })).toBeNull();
        await userEvent.hover(card('Forschung'));
        expect(within(card('Forschung')).queryByRole('button', { name: /asstUseThisRole/ })).toBeNull();
        await userEvent.hover(card('Tutor'));
        await userEvent.click(within(card('Tutor')).getByRole('button', { name: /asstUseThisRole/ }));
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalled());
        expect(savedInput().behavior.activeRoleId).toBe('tutor');
    });

    it('saves a new role without making it active', async () => {
        await renderSection('behavior');
        await userEvent.click(screen.getByRole('button', { name: /asstNewRole/ }));
        await userEvent.type(screen.getByLabelText('asstName'), 'Neu');
        await userEvent.type(screen.getByLabelText('asstPrompt'), 'NEUER PROMPT');
        await userEvent.click(screen.getByRole('button', { name: /asstSaveRole/ }));
        // Back on the roles: the new one is previewed, not active.
        expect(previewPanel()).toHaveTextContent('NEUER PROMPT');
        expect(within(previewPanel()).queryByText('asstActive')).toBeNull();
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalled());
        expect(savedInput().behavior.activeRoleId).toBe('research');
        const added = savedInput().behavior.customRoles.find(r => r.name === 'Neu');
        expect(added).toBeDefined();
        // A new role starts with the catalog's default rules of its own.
        expect(savedInput().behavior.roleRules[added!.id]).toEqual({ rules: { short: true }, customRules: [] });
    });

    // Oracle: developer ruling 28.10.2026 — every own role's description is
    // editable, the legacy role's too; it is the text on the start page's card.
    it('edits a role\'s description', async () => {
        behavior = { ...behavior, customRoles: [...behavior.customRoles, { id: 'legacy', name: 'Personalrecht', description: 'Durchsucht die bereitgestellten Quellen.', prompt: '', icon: 'user-round' }] };
        await renderSection('behavior');
        await userEvent.click(screen.getByRole('button', { name: 'actions Personalrecht' }));
        await userEvent.click(await screen.findByRole('menuitem', { name: /asstEdit/ }));
        const desc = screen.getByLabelText('asstDescription');
        expect(desc).toHaveValue('Durchsucht die bereitgestellten Quellen.');
        await userEvent.clear(desc);
        await userEvent.type(desc, 'Prüft Arbeitsverträge.');
        await userEvent.clear(screen.getByLabelText('asstName'));
        await userEvent.type(screen.getByLabelText('asstName'), 'Vertragscheck');
        await userEvent.click(screen.getByRole('button', { name: /asstApplyChanges/ }));
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalled());
        expect(savedInput().behavior.customRoles.find(r => r.id === 'legacy')).toMatchObject({ name: 'Vertragscheck', description: 'Prüft Arbeitsverträge.' });
    });

    // Oracle: developer ruling 28.10.2026 — the edit screen revises the prompt
    // with AI help; the edited role keeps its id and name.
    it('revises an own role\'s prompt with the AI help', async () => {
        vi.spyOn(api, 'reviseRolePrompt').mockResolvedValue({ prompt: 'GENERIERT' });
        await renderSection('behavior');
        await openEditor('Eigene');
        expect(screen.getByLabelText('asstPrompt')).toHaveValue('EIGEN');
        await userEvent.type(screen.getByLabelText('asstReviseLabel'), 'Kürzer{Enter}');
        await waitFor(() => expect(screen.getByLabelText('asstPrompt')).toHaveValue('GENERIERT'));
        expect(api.reviseRolePrompt).toHaveBeenCalledWith('kb-1', 'EIGEN', 'Kürzer', 'de');
        // „Rückgängig" brings the prompt before the revision back.
        await userEvent.click(screen.getByRole('button', { name: 'asstUndo' }));
        expect(screen.getByLabelText('asstPrompt')).toHaveValue('EIGEN');
        expect(screen.queryByText('asstRevised')).toBeNull();
        await userEvent.type(screen.getByLabelText('asstReviseLabel'), 'Kürzer{Enter}');
        await waitFor(() => expect(screen.getByLabelText('asstPrompt')).toHaveValue('GENERIERT'));
        await userEvent.click(screen.getByRole('button', { name: /asstApplyChanges/ }));
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalled());
        const roles = savedInput().behavior.customRoles;
        expect(roles).toHaveLength(1);
        expect(roles[0]).toMatchObject({ id: 'c-1', name: 'Eigene', prompt: 'GENERIERT' });
    });

    // Oracle: developer ruling 28.10.2026 — the description can be written from the role's prompt.
    it('writes an own role\'s description from its prompt', async () => {
        vi.spyOn(api, 'describeRole').mockResolvedValue({ description: 'Hilft beim Prüfen von Anträgen.' });
        await renderSection('behavior');
        await openEditor('Eigene');
        await userEvent.click(screen.getByRole('button', { name: /asstDescribe/ }));
        await waitFor(() => expect(screen.getByLabelText('asstDescription')).toHaveValue('Hilft beim Prüfen von Anträgen.'));
        expect(api.describeRole).toHaveBeenCalledWith('kb-1', 'Eigene', 'EIGEN', 'de');
    });

    // Oracle: developer ruling 28.10.2026 — a role switched off in „Vorlagen"
    // is no longer offered, but a KB that uses it keeps seeing it.
    it('hides a disabled template unless the KB uses it', async () => {
        const withDisabled = async () => {
            const cat = await (vi.mocked(api.fetchBehaviorCatalog).getMockImplementation()!)('de');
            return { ...cat, roles: [...cat.roles, { id: 'old', name: 'Alt', description: 'd', prompt: 'ALT', icon: 'copy', isDefault: false, enabled: false }] };
        };
        vi.mocked(api.fetchBehaviorCatalog).mockImplementationOnce(withDisabled);
        await renderSection('behavior');
        expect(screen.queryByRole('radio', { name: /^Alt.*asstShowPreview$/ })).toBeNull();
        cleanup();
        behavior = { ...behavior, activeRoleId: 'old' };
        vi.mocked(api.fetchBehaviorCatalog).mockImplementationOnce(withDisabled);
        await renderSection('behavior');
        expect(tile('Alt')).toBeInTheDocument();
    });

    // Oracle: handoff „Rollen-Editor" §2 — a card click views the role; × closes the preview.
    it('closes the preview with its × until a card is clicked, also after reopening', async () => {
        await renderSection('behavior');
        expect(screen.getByRole('region', { name: 'asstPreviewOf' })).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'asstClosePreview' }));
        expect(screen.queryByRole('region', { name: 'asstPreviewOf' })).toBeNull();
        cleanup();
        await renderSection('behavior');
        expect(screen.queryByRole('region', { name: 'asstPreviewOf' })).toBeNull();
        await userEvent.click(tile('Tutor'));
        expect(screen.getByRole('region', { name: 'asstPreviewOf' })).toHaveTextContent('TUTOR');
        expect(tile('Tutor')).toHaveAttribute('aria-checked', 'true');
    });

    // Oracle: developer rulings 28.10.2026 — the preview only shows the rules;
    // each own role has its rules, set in its edit screen.
    it('shows rules in the preview and sets an own role\'s rules in its edit screen', async () => {
        await renderSection('behavior');
        await userEvent.click(tile('Eigene'));
        expect(within(previewPanel()).queryByRole('switch')).toBeNull();
        expect(previewPanel()).toHaveTextContent('Kurz antworten.');
        await openEditor('Eigene');
        await userEvent.click(screen.getByRole('button', { name: /asstOwnRules/ }));
        await userEvent.click(screen.getByRole('button', { name: /asstAddRule/ }));
        await userEvent.type(screen.getByLabelText('asstNewRuleLabel'), 'Immer duzen{Enter}');
        expect(screen.getByRole('switch', { name: 'Immer duzen' })).toBeChecked();
        await applyEditor();
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalled());
        expect(savedInput().behavior.roleRules['c-1'].customRules).toEqual([expect.objectContaining({ text: 'Immer duzen', on: true })]);
        // A template's rules are the system preset: never stored.
        expect(savedInput().behavior.roleRules.research).toBeUndefined();
    });

    // Oracle: developer ruling 28.10.2026 — a template's prompt and rules are
    // the system preset: its edit screen shows them, changes only its start.
    it('keeps a template\'s prompt and rules fixed in its edit screen', async () => {
        await renderSection('behavior');
        await openEditor('Tutor');
        expect(screen.queryByLabelText('asstPrompt')).toBeNull();
        // No rule switches; the one switch is the start's suggestions toggle (a template's start is editable).
        expect(screen.getAllByRole('switch').map(s => s.getAttribute('aria-label'))).toEqual([expect.stringMatching(/^asstQuestionsShow/)]);
        expect(screen.getByRole('button', { name: /asstCopyTemplate/ })).toBeInTheDocument();
    });

    it('offers no starter for the active role, nor once there are three further roles', async () => {
        await renderSection('behavior');
        await userEvent.click(screen.getByRole('button', { name: 'actions Forschung' }));
        expect(screen.getByRole('menuitem', { name: /asstOfferAsEntry/ })).toHaveAttribute('aria-disabled', 'true');
        cleanup();
        startPage.roleEntries = [1, 2, 3].map(i => entry(`re-${i}`, 'c-1'));
        await renderSection('behavior');
        await userEvent.click(screen.getByRole('button', { name: 'actions Tutor' }));
        expect(screen.getByRole('menuitem', { name: /asstOfferAsEntry/ })).toHaveAttribute('aria-disabled', 'true');
    });

    // Oracle: developer ruling 28.10.2026 — a role shows once on the start page.
    it('offers no second card of a role, and a card of the role made active passes to the one it replaces', async () => {
        await renderSection('behavior');
        await userEvent.click(screen.getByRole('button', { name: 'actions Eigene' }));
        expect(screen.getByRole('menuitem', { name: /asstOfferAsEntry/ })).toHaveAttribute('aria-disabled', 'true');
        await userEvent.keyboard('{Escape}');
        await useRole('Eigene');
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalled());
        expect(savedInput().behavior.activeRoleId).toBe('c-1');
        expect(savedInput().startPage.roleEntries).toEqual([{ id: 're-1', roleId: 'research' }]);
    });

    it('asks before deleting a role with role cards and removes the cards too', async () => {
        await renderSection('behavior');
        await userEvent.click(screen.getByRole('button', { name: 'actions Eigene' }));
        await userEvent.click(screen.getByRole('menuitem', { name: /delete/ }));
        const dialog = await screen.findByRole('dialog', { name: 'asstDeleteRoleTitle' });
        await userEvent.click(within(dialog).getByRole('button', { name: /asstDeleteRoleConfirm/ }));
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalled());
        expect(savedInput().behavior.customRoles).toEqual([]);
        expect(savedInput().startPage.roleEntries).toEqual([]);
        expect(savedInput().startPage.roleStarts).toEqual({});
    });

    // Oracle: developer ruling 27.10.2026 — „Rollenauswahl" needs a second
    // role; with one role the input field starts the same chat.
    it('falls back to the input field when the last further role card goes with its role', async () => {
        startPage.startMode = 'roles';
        await renderSection('behavior');
        await userEvent.click(screen.getByRole('button', { name: 'actions Eigene' }));
        await userEvent.click(screen.getByRole('menuitem', { name: /delete/ }));
        const dialog = await screen.findByRole('dialog', { name: 'asstDeleteRoleTitle' });
        await userEvent.click(within(dialog).getByRole('button', { name: /asstDeleteRoleConfirm/ }));
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalled());
        expect(savedInput().startPage).toMatchObject({ startMode: 'input', roleEntries: [] });
    });

    // Oracle: developer ruling 28.10.2026 — the error shows on Speichern, not while picking.
    it('does not save „Rollenauswahl" with the default role alone and says why on Speichern', async () => {
        startPage.roleEntries = [];
        await renderSection('start');
        await editChatStart();
        await userEvent.click(screen.getByText('asstStartRoles'));
        expect(screen.queryByText('asstRolesNeedSecond')).toBeNull();
        await userEvent.click(saveButton());
        expect(screen.getByText('asstRolesNeedSecond')).toBeInTheDocument();
        expect(screen.getByText('asstSaveIncomplete')).toBeInTheDocument();
        expect(api.saveAssistantSettings).not.toHaveBeenCalled();
    });

    // Oracle: developer ruling 28.10.2026 — „Fertig" refuses that choice too and says why.
    it('keeps the chat start editor open on „Fertig" with the default role alone', async () => {
        startPage.roleEntries = [];
        await renderSection('start');
        await editChatStart();
        await userEvent.click(screen.getByText('asstStartRoles'));
        expect(screen.getByText('asstChooseRolesHeading')).toBeInTheDocument();
        await doneChatStart();
        expect(screen.getByText('asstRolesNeedSecond')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /asstDone/ })).toBeInTheDocument();
    });

    // Oracle: ANWEISUNG §1.2 „Als Einstiegsfrage anbieten" / §2.2 „Von Verhalten aus".
    it('offering a role as a starter switches the chat start to „Rollenauswahl" with a card for it', async () => {
        startPage.roleEntries = [];
        await renderSection('behavior');
        await userEvent.click(screen.getByRole('button', { name: 'actions Tutor' }));
        await userEvent.click(screen.getByRole('menuitem', { name: /asstOfferAsEntry/ }));
        expect(await screen.findByText('asstModeSwitchedNotice')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'entry-actions Tutor' })).toBeInTheDocument();
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalled());
        expect(savedInput().startPage.startMode).toBe('roles');
        expect(savedInput().startPage.roleEntries.map(e => e.roleId)).toEqual(['tutor']);
        // No start of its own: it starts with the input field.
        expect(savedInput().startPage.roleStarts.tutor).toBeUndefined();
    });
});

// Oracle: ANWEISUNG §2 / §3.
describe('Startseite', () => {
    it('opens both editors from „Bearbeiten", closes both with „Fertig" and keeps nothing without Speichern', async () => {
        await renderSection('start');
        await userEvent.click(screen.getByRole('button', { name: 'asstEditStartPage' }));
        // Both blocks are in edit mode: the title field and the chat start's modes.
        expect(screen.getByLabelText('asstTitle')).toBeInTheDocument();
        expect(screen.getByText('asstStartUpload')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'asstEditStartPage' })).toBeNull();
        await userEvent.click(screen.getByText('asstStartUpload'));
        // One „Fertig", under the chat start, closes both.
        await userEvent.click(screen.getByRole('button', { name: /asstDone/ }));
        expect(screen.queryByLabelText('asstTitle')).toBeNull();
        expect(screen.getByRole('heading', { level: 2, name: 'Personalrecht' })).toBeInTheDocument();
        // The view again: the upload start's dropzone, as members see it.
        expect(screen.getByText('asstUploadLabelDefault')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'asstEditStartPage' })).toBeInTheDocument();
        expect(api.saveAssistantSettings).not.toHaveBeenCalled();
        expect(screen.getByText('asstUnsaved')).toBeInTheDocument();
    });

    it('has suggestions off by default and keeps the fixed questions across dynamic and off', async () => {
        await renderSection('start');
        await editChatStart();
        const sw = screen.getByRole('switch', { name: 'asstQuestionsShow' });
        expect(sw).not.toBeChecked();
        expect(screen.getByText(/asstQuestionsOff/)).toHaveTextContent('asstFixedKeptN');
        await userEvent.click(sw);
        await userEvent.click(screen.getByText('asstFixedMode'));
        expect(screen.getByDisplayValue('Fix 1')).toBeInTheDocument();
        await userEvent.click(screen.getByText('asstDynamic'));
        expect(screen.queryByDisplayValue('Fix 1')).toBeNull();
        await userEvent.click(screen.getByText('asstFixedMode'));
        // Back to fixed: the same list, not the dynamic example.
        expect(screen.getByDisplayValue('Fix 1')).toBeInTheDocument();
        expect(screen.queryByDisplayValue('Dyn 1')).toBeNull();
        await userEvent.click(screen.getByRole('switch', { name: 'asstQuestionsShow' }));
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalled());
        expect(savedInput().startPage).toMatchObject({ questionsOn: false, questionMode: 'fixed', fixedQuestions: ['Fix 1'] });
    });

    it('sorts the fixed questions with Alt + arrow keys', async () => {
        startPage.questionsOn = true;
        startPage.questionMode = 'fixed';
        startPage.fixedQuestions = ['A', 'B'];
        await renderSection('start');
        await editChatStart();
        const first = screen.getByRole('textbox', { name: 'question 1' });
        expect(first).toHaveAccessibleDescription('asstSortKeysHint');
        fireEvent.keyDown(first, { key: 'ArrowRight', altKey: true });
        expect(screen.getByRole('textbox', { name: 'question 1' })).toHaveValue('B');
        expect(screen.getByRole('textbox', { name: 'question 2' })).toHaveValue('A');
    });

    it('keeps the settings of every mode when the mode changes', async () => {
        await renderSection('start');
        await editChatStart();
        await userEvent.click(screen.getByText('asstStartUpload'));
        await userEvent.type(screen.getByLabelText('asstUploadLabel'), 'Antrag hochladen');
        await userEvent.click(screen.getByText('asstStartRoles'));
        await userEvent.click(screen.getByText('asstStartInput'));
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalled());
        expect(savedInput().startPage).toMatchObject({ startMode: 'input', uploadLabel: 'Antrag hochladen', fixedQuestions: ['Fix 1'] });
        expect(savedInput().startPage.roleEntries).toHaveLength(1);
    });

    it('shows no suggestions with an upload-only start, whose dropzone takes any file', async () => {
        startPage.questionsOn = true;
        await renderSection('start');
        expect(await screen.findByText('Dyn 1')).toBeInTheDocument();
        await editChatStart();
        await userEvent.click(screen.getByText('asstStartUpload'));
        // The editor shows the members' dropzone with the label in it; no file-type choice.
        expect(screen.getByLabelText('asstUploadLabel')).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: /asstUploadTypes/ })).toBeNull();
        await doneChatStart();
        expect(screen.queryByText('Dyn 1')).toBeNull();
        expect(screen.queryByText(/asstStartIncomplete/)).toBeNull();
        expect(saveButton()).toBeEnabled();
    });

    it('keeps the default role first, fixed and following the active role; further roles cannot pick it', async () => {
        startPage.startMode = 'roles';
        await renderSection('start');
        // View: the active role's card first, then the further one, each named
        // by its role and by how it starts (both the input field here). No card
        // is preselected or singled out (developer ruling 30.10.2026).
        const cards = within(screen.getByRole('region', { name: 'asstChooseRoleHeading' })).getAllByRole('button');
        expect(cards.map(c => c.getAttribute('aria-label'))).toEqual(['Forschung: asstStartChat', 'Eigene: asstStartChat']);
        expect(screen.queryByText('asstStandardBadge')).toBeNull();
        expect(cards[0].className).toBe(cards[1].className);
        await editChatStart();
        // The default role's menu has no move or delete.
        await userEvent.click(screen.getByRole('button', { name: 'entry-actions Forschung' }));
        expect(screen.queryByRole('menuitem', { name: /asstRemove/ })).toBeNull();
        expect(screen.queryByRole('menuitem', { name: /asstMoveForward/ })).toBeNull();
        await userEvent.keyboard('{Escape}');
    });

    // Oracle: developer ruling 28.10.2026 — „Rolle hinzufügen" opens the deck
    // of the KB's roles (every role starts with the input field until set
    // otherwise; not the active one, not one on the page already).
    it('picks a further card from a picker of the other roles', async () => {
        startPage.startMode = 'roles';
        await renderSection('start');
        await editChatStart();
        await userEvent.click(screen.getByRole('button', { name: /asstAddRoleEntry/ }));
        expect(screen.getByRole('menuitem', { name: /Tutor/ })).toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: /Forschung/ })).toBeNull();
        expect(screen.queryByRole('menuitem', { name: /Eigene/ })).toBeNull();
        await userEvent.click(screen.getByRole('menuitem', { name: /Tutor/ }));
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalled());
        expect(savedInput().startPage.roleEntries.map((e: { roleId: string }) => e.roleId)).toEqual(['c-1', 'tutor']);
    });

    // Oracle: developer ruling 28.10.2026 — a role's start is set up in
    // „Verhalten"; the bug of 27.10.2026 — a file start must reach the server.
    it('sets up a role\'s start in Verhalten, a file start too', async () => {
        await renderSection('behavior');
        await openEditor('Eigene');
        await userEvent.click(screen.getByRole('button', { name: /asstKind_file/ }));
        await applyEditor();
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalled());
        expect(savedInput().startPage.roleStarts['c-1']).toMatchObject({ kind: 'file' });
    });

    // Oracle: developer ruling 28.10.2026 — the start is picked from three
    // tiles, right in the edit screen (no chat preview there).
    it('starts every role with the input field until set, and switches back to it', async () => {
        startPage.roleStarts = { 'c-1': { ...inputStart(), kind: 'file' } };
        await renderSection('behavior');
        await openEditor('Tutor');
        // No start of its own: the input field, with its hint.
        expect(screen.getByRole('button', { name: /asstKind_input/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('asstKindHint_input')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /^cancel$/ }));
        await openEditor('Eigene');
        expect(screen.getByRole('button', { name: /asstKind_file/ })).toHaveAttribute('aria-pressed', 'true');
        await userEvent.click(screen.getByRole('button', { name: /asstKind_input/ }));
        await applyEditor();
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalled());
        const saved = savedInput().startPage;
        expect(saved.roleStarts['c-1']).toMatchObject({ kind: 'input' });
        // The card stays on the page, now starting with the input field.
        expect(saved.roleEntries).toEqual([{ id: 're-1', roleId: 'c-1' }]);
    });

    // Oracle: developer ruling 27.10.2026 — suggestions per role, like the input field's.
    it('keeps suggestions per role', async () => {
        await renderSection('behavior');
        await openEditor('Eigene');
        await userEvent.click(screen.getByRole('switch', { name: 'asstQuestionsShow · Eigene' }));
        await applyEditor();
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalled());
        const saved = savedInput().startPage;
        expect(saved.roleStarts['c-1'].suggestions).toMatchObject({ questionsOn: true, questionMode: 'dynamic' });
        expect(saved.roleStarts.research).toBeUndefined();
        expect(saved.questionsOn).toBe(false);
    });

    // Oracle: Codex review 29.10.2026 — a role being edited is not in the
    // draft yet, so the close guard has to ask about it on its own.
    it('asks before closing over a role being edited', async () => {
        showConfirm.mockClear();
        await renderSection('behavior');
        await userEvent.click(screen.getByRole('button', { name: /asstNewRole/ }));
        await userEvent.click(screen.getByRole('button', { name: 'close' }));
        expect(showConfirm).not.toHaveBeenCalled();
        cleanup();
        await renderSection('behavior');
        await userEvent.click(screen.getByRole('button', { name: /asstNewRole/ }));
        await userEvent.type(screen.getByLabelText('asstName'), 'Neu');
        await userEvent.click(screen.getByRole('button', { name: 'close' }));
        expect(showConfirm).toHaveBeenCalledTimes(1);
    });

    // Oracle: Codex review 29.10.2026 — „Löschen" resets the behaviour only;
    // unsaved edits on the Startseite survive it.
    it('keeps an unsaved title when the behaviour is reset', async () => {
        await renderSection('start');
        await userEvent.click(screen.getByRole('button', { name: 'asstEditStartPage' }));
        await userEvent.type(screen.getByLabelText('asstTitle'), ' neu');
        await userEvent.click(screen.getByRole('button', { name: 'kbSettingsTabBehavior' }));
        await userEvent.click(await screen.findByRole('button', { name: /^delete$/ }));
        await waitFor(() => expect(api.resetBehavior).toHaveBeenCalled());
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalled());
        expect(savedInput().title).toBe('Personalrecht neu');
    });

    it('cannot save without a title', async () => {
        await renderSection('start');
        await userEvent.click(screen.getByRole('button', { name: 'asstEditStartPage' }));
        await userEvent.clear(screen.getByLabelText('asstTitle'));
        expect(screen.getByText('asstTitleRequired')).toBeInTheDocument();
        expect(screen.getByText('asstUnsaved')).toBeInTheDocument();
        await userEvent.click(saveButton());
        expect(screen.getByText('asstSaveIncomplete')).toBeInTheDocument();
        expect(api.saveAssistantSettings).not.toHaveBeenCalled();
    });

    it('saves title and description in the combined save and brings the KB lists in step', async () => {
        const { onUpdateKb } = await renderSection('start');
        await userEvent.click(screen.getByRole('button', { name: 'asstEditStartPage' }));
        await userEvent.type(screen.getByLabelText('asstTitle'), ' neu');
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalled());
        expect(savedInput().title).toBe('Personalrecht neu');
        await waitFor(() => expect(onUpdateKb).toHaveBeenCalledWith({ name: 'Personalrecht neu' }));
        expect(await screen.findByText('kbSettingsSaved')).toBeInTheDocument();
    });

    // Oracle: developer ruling 29.10.2026 — the description is written from the
    // documents once, on request in the editor, and kept by the save like a typed one.
    it('writes the description from the documents on request and saves it', async () => {
        const generate = vi.spyOn(api, 'generateDescription').mockResolvedValue('Alles zum Personalrecht.');
        await renderSection('start');
        expect(generate).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: 'asstEditStartPage' }));
        await userEvent.click(screen.getByRole('button', { name: 'asstGenerateDescription' }));
        expect(generate).toHaveBeenCalledWith('kb-1', 'Personalrecht', 'de');
        await waitFor(() => expect(screen.getByLabelText('asstDescription')).toHaveValue('Alles zum Personalrecht.'));
        await userEvent.click(saveButton());
        await waitFor(() => expect(api.saveAssistantSettings).toHaveBeenCalled());
        expect(savedInput().description).toBe('Alles zum Personalrecht.');
    });
});

// Oracle: ANWEISUNG §2a.
describe('Versionsverlauf', () => {
    it('restores a version as a new one and keeps the old ones', async () => {
        await renderSection('versions');
        expect(screen.getByText('asstNoteOne')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /asstRestore$/ }));
        const dialog = await screen.findByRole('dialog', { name: 'asstRestoreTitle' });
        versions = [{ number: 3, kind: 'restore', restoredFrom: 1, createdAt: '2026-10-21T10:00:00Z', authorId: 'u1', authorName: 'Anna Krüger', note: null, changes: [] }, ...versions];
        await userEvent.click(within(dialog).getByRole('button', { name: /restore-as v3/ }));
        await waitFor(() => expect(api.restoreSettingsVersion).toHaveBeenCalledWith('kb-1', 1, 2));
        expect(await screen.findByText('restored v1 as v3')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText('asstRestoredFrom')).toBeInTheDocument());
        expect(screen.getByText('v2')).toBeInTheDocument();
    });

    it('brings the app\'s KB lists in step when a restore changes title or description', async () => {
        const { onUpdateKb } = await renderSection('versions');
        vi.mocked(api.restoreSettingsVersion).mockImplementationOnce(async () => {
            version += 1;
            return { ...response(), title: 'Personalrecht alt', description: 'Früher.' };
        });
        await userEvent.click(screen.getByRole('button', { name: /asstRestore$/ }));
        const dialog = await screen.findByRole('dialog', { name: 'asstRestoreTitle' });
        await userEvent.click(within(dialog).getByRole('button', { name: /restore-as/ }));
        await waitFor(() => expect(onUpdateKb).toHaveBeenCalledWith({ name: 'Personalrecht alt', description: 'Früher.' }));
    });

    it('filters by area and keeps the baseline in every filter', async () => {
        await renderSection('versions');
        await userEvent.click(within(screen.getByLabelText('asstFilterVersions')).getByText('asstStartPage'));
        const list = screen.getByRole('region', { name: 'asstVersionList' });
        expect(within(list).queryByText('v2')).toBeNull();
        expect(within(list).getByText('v1')).toBeInTheDocument();
    });
});
