import { describe, expect, it } from 'vitest';
import type { SettingsVersion, StartPage } from './api';
import { ROLE_COVER_DEFAULTS, categoryGlowStyle, colorsStyle, chatStartIncomplete, roleCardCover, showsGeneratedQuestions, suggestionQuestions, startEntries, visibleQuestions } from './startPageModel';
import { changeValue, versionNote } from './versionModel';
import { draftAfterReset, type AssistantDraft } from './useAssistantSettings';

const page = (patch: Partial<StartPage> = {}): StartPage => ({
    version: 1, colors: { from: '#0056B3', to: '#3897E8' }, startMode: 'input',
    questionsOn: false, questionMode: 'dynamic', dynamicCount: 4, fixedQuestions: ['Fix'],
    uploadLabel: '', uploadInstruction: '',
    roleStarts: {},
    roleEntries: [],
    ...patch,
});

const t = (k: string) => k;

// Oracle: the role cover's two colours, as given — a gradient for the
// swatch; none without colours.
describe('cover colours', () => {
    it('builds the swatch gradient from the two colours', () => {
        expect(String(colorsStyle({ from: '#EE4589', to: '#B46EF7' })?.backgroundImage)).toBe('linear-gradient(120deg, #EE4589, #B46EF7)');
        expect(colorsStyle(null)).toBeUndefined();
    });
});

// Oracle: developer ruling 30.10.2026 — the start page glows in its
// category's colour (the palette slot, as on its cards), and a topic without
// a category has no glow; the glow fades out on every side.
describe('start page glow', () => {
    it('takes the category\'s palette colour', () => {
        const glow = categoryGlowStyle({ colorSlot: 4 });
        expect(String(glow?.backgroundImage)).toContain('var(--color-category-4)');
        expect(String(glow?.maskImage)).toMatch(/radial-gradient\(ellipse .*transparent 100%\)/);
    });

    it('draws nothing without a category', () => {
        expect(categoryGlowStyle(null)).toBeUndefined();
    });
});

// Oracle: developer ruling 28.10.2026 — a template's own band (admin
// „Vorlagen"), else the system default by what the card starts: blue fade for
// a chat (also the original role), light green into blue for a file upload.
describe('role card cover', () => {
    it('takes a template\'s own colours, else the default for the card\'s kind', () => {
        const own = { from: '#EC4899', to: '#A855F7' };
        expect(roleCardCover({ cover: own }, 'file')).toBe(own);
        expect(roleCardCover({}, 'input')).toEqual({ from: '#0B4FB0', to: '#1B3A70' });
        expect(roleCardCover(undefined, 'file')).toEqual({ from: '#14B8A6', to: '#7DD3FC' });
        expect(roleCardCover({}, 'task')).toBe(ROLE_COVER_DEFAULTS.task);
    });
});

describe('chat start', () => {
    const sugg = { questionsOn: false, questionMode: 'dynamic' as const, dynamicCount: 4 as const, fixedQuestions: [] };
    const task = (text: string) => ({ kind: 'task' as const, text, send: true, instruction: '', suggestions: sugg });

    it('puts the active role first, each card with its role\'s start (none set up = the input field)', () => {
        const p = page({ roleStarts: { tutor: task('Los') }, roleEntries: [{ id: 're-1', roleId: 'tutor' }] });
        const cards = startEntries(p, 'research');
        expect(cards.map(e => [e.roleId, e.kind])).toEqual([['research', 'input'], ['tutor', 'task']]);
        expect(cards[1]).toMatchObject({ id: 're-1', text: 'Los' });
    });

    it('is incomplete in the roles mode without a further role or with a shown start prompt without text', () => {
        expect(chatStartIncomplete(page({ startMode: 'upload' }), 'research')).toBe(false);
        // One role leaves nothing to choose: the input field starts the same chat.
        expect(chatStartIncomplete(page({ startMode: 'roles' }), 'research')).toBe(true);
        const further = { roleStarts: { tutor: task('Los') }, roleEntries: [{ id: 'r', roleId: 'tutor' }] };
        expect(chatStartIncomplete(page({ startMode: 'roles', ...further }), 'research')).toBe(false);
        expect(chatStartIncomplete(page({ startMode: 'roles', ...further, roleStarts: { ...further.roleStarts, research: task(' ') } }), 'research')).toBe(true);
        // A role set up but not shown may stay a draft.
        expect(chatStartIncomplete(page({ startMode: 'roles', ...further, roleStarts: { ...further.roleStarts, editor: task('') } }), 'research')).toBe(false);
        expect(chatStartIncomplete(page({ startMode: 'input', roleStarts: { research: task('') } }), 'research')).toBe(false);
    });

    it('shows suggestions only when on and in the input-field start', () => {
        expect(visibleQuestions(page(), ['D1'])).toEqual([]);
        expect(visibleQuestions(page({ questionsOn: true }), ['D1', 'D2'])).toEqual(['D1', 'D2']);
        expect(visibleQuestions(page({ questionsOn: true, questionMode: 'fixed' }), ['D1'])).toEqual(['Fix']);
        expect(visibleQuestions(page({ questionsOn: true, startMode: 'upload' }), ['D1'])).toEqual([]);
        expect(visibleQuestions(page({ questionsOn: true, startMode: 'roles' }), ['D1'])).toEqual([]);
    });
});

describe('card suggestions', () => {
    it('shows a card\'s own questions only while on', () => {
        const s = { questionsOn: true, questionMode: 'fixed' as const, dynamicCount: 4, fixedQuestions: ['Wie?', ' '] };
        expect(suggestionQuestions(s, ['D1'])).toEqual(['Wie?']);
        expect(suggestionQuestions({ ...s, questionMode: 'dynamic' as const, dynamicCount: 3 }, ['D1', 'D2', 'D3', 'D4'])).toEqual(['D1', 'D2', 'D3']);
        expect(suggestionQuestions({ ...s, questionsOn: false }, ['D1'])).toEqual([]);
        expect(suggestionQuestions(undefined, ['D1'])).toEqual([]);
    });
});

// Oracle: what the chat start shows (visibleQuestions / suggestionQuestions):
// a model call only where generated questions will appear.
describe('generated questions', () => {
    const dyn = { questionsOn: true, questionMode: 'dynamic' };
    it('asks for them only where they will be shown', () => {
        expect(showsGeneratedQuestions(null, null)).toBe(true);
        expect(showsGeneratedQuestions(null, page({ questionsOn: true }))).toBe(true);
        expect(showsGeneratedQuestions(null, page({ questionsOn: false }))).toBe(false);
        expect(showsGeneratedQuestions(null, page({ questionsOn: true, questionMode: 'fixed' }))).toBe(false);
        expect(showsGeneratedQuestions(null, page({ questionsOn: true, startMode: 'upload' }))).toBe(false);
        expect(showsGeneratedQuestions(null, page({ questionsOn: true, startMode: 'roles' }))).toBe(false);
        expect(showsGeneratedQuestions({ kind: 'input', suggestions: dyn }, page())).toBe(true);
        expect(showsGeneratedQuestions({ kind: 'file', suggestions: dyn }, null)).toBe(false);
        expect(showsGeneratedQuestions({ kind: 'input', suggestions: { ...dyn, questionsOn: false } }, null)).toBe(false);
    });
});

// Oracle: Codex review 29.10.2026 — the reset touches the behaviour only.
describe('draft after a behaviour reset', () => {
    const behavior = { version: 1, activeRoleId: 'research', customRoles: [], roleRules: {} } as unknown as AssistantDraft['behavior'];
    const base: AssistantDraft = { behavior, startPage: page(), title: 'T', description: null, categoryId: null };
    it('keeps unsaved edits outside Verhalten and drops cards of roles that went', () => {
        const server = { ...base, title: 'T' };
        const draft: AssistantDraft = {
            ...base, title: 'T neu',
            startPage: page({ startMode: 'roles', roleEntries: [{ id: 'e1', roleId: 'mine' }], roleStarts: { mine: { kind: 'input' } as never } }),
        };
        const next = draftAfterReset(draft, base, server, new Set(['research', 'tutor']));
        expect(next.title).toBe('T neu');
        expect(next.startPage.roleEntries).toEqual([]);
        expect(next.startPage.roleStarts).toEqual({});
        expect(next.startPage.startMode).toBe('input');
    });
    it('takes the server state where nothing was edited', () => {
        const server = { ...base, title: 'Server' };
        expect(draftAfterReset({ ...base }, base, server, new Set()).title).toBe('Server');
    });
});

describe('version history', () => {
    const v = (patch: Partial<SettingsVersion>): SettingsVersion => ({
        number: 2, kind: 'save', createdAt: '', authorId: null, authorName: '', note: null, changes: [], ...patch,
    });

    it('writes a note from the changes when the author left none', () => {
        expect(versionNote(v({ kind: 'baseline' }), t)).toEqual({ text: 'asstNoteBaseline', auto: true });
        expect(versionNote(v({ kind: 'restore', restoredFrom: 1 }), t).text).toBe('asstNoteRestored');
        expect(versionNote(v({ changes: [{ area: 'start', field: 'title' }, { area: 'behavior', field: 'rule' }] }), t).text).toBe('asstNoteBothN');
        expect(versionNote(v({ note: 'Eigene Notiz' }), t)).toEqual({ text: 'Eigene Notiz', auto: false });
    });

    it('shows stored values in the reader’s words', () => {
        expect(changeValue({ area: 'behavior', field: 'rule' }, 'on', t)).toBe('asstOn');
        expect(changeValue({ area: 'start', field: 'colors' }, '#112233 #445566', t)).toBe('#112233 → #445566');
        expect(changeValue({ area: 'start', field: 'colors' }, '', t)).toBe('asstColorsNone');
        expect(changeValue({ area: 'start', field: 'description' }, '', t)).toBe('asstAutomatic');
        expect(changeValue({ area: 'behavior', field: 'roleStart' }, 'task (prefill): Los', t)).toBe('asstKind_task „Los“ (asstPrefillOnly)');
        expect(changeValue({ area: 'behavior', field: 'roleStart' }, '', t)).toBe('asstRoleStartNone');
    });
});
