import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetKbStartPages, startShapeOf } from './useKbStartPage';
import type { StartPage } from '../components/kbSettings/assistant/api';

vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ language: 'de' }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

const page = (over: Partial<StartPage> = {}): StartPage => ({
    version: 2, colors: null, startMode: 'input', uploadLabel: '', uploadInstruction: '', roleStarts: {}, roleEntries: [],
    questionsOn: false, questionMode: 'dynamic', dynamicCount: 4, fixedQuestions: [],
    ...over,
} as StartPage);
const suggestions = { questionsOn: false, questionMode: 'dynamic' as const, dynamicCount: 4 as const, fixedQuestions: [] };
const start = (kind: 'input' | 'task' | 'file', text = '') => ({ kind, text, send: false, instruction: '', suggestions });

// Oracle: the skeleton's shape is the start the chat view shows — the input
// field, the wide role-prompt card (an instruction with text, alone), the
// upload area, or one card per role once further role cards exist.
describe('startShapeOf', () => {
    beforeEach(() => forgetKbStartPages());

    it('is the input field for a page never set up', () => {
        expect(startShapeOf({ page: page(), activeRoleId: 'chat', roles: [] })).toEqual({ kind: 'input', cards: 0 });
    });

    it('is the upload area when the active role starts with a file', () => {
        expect(startShapeOf({ page: page({ roleStarts: { chat: start('file') } }), activeRoleId: 'chat', roles: [] }))
            .toEqual({ kind: 'upload', cards: 0 });
    });

    it('is the prompt card for an instruction with text, the input field for one without', () => {
        expect(startShapeOf({ page: page({ roleStarts: { chat: start('task', 'Los') } }), activeRoleId: 'chat', roles: [] }))
            .toEqual({ kind: 'prompt', cards: 0 });
        expect(startShapeOf({ page: page({ roleStarts: { chat: start('task') } }), activeRoleId: 'chat', roles: [] }))
            .toEqual({ kind: 'input', cards: 0 });
    });

    it('counts the active role with the further role cards', () => {
        const withCards = page({ roleEntries: [{ id: 'e1', roleId: 'summary' }, { id: 'e2', roleId: 'it' }] });
        expect(startShapeOf({ page: withCards, activeRoleId: 'chat', roles: [] })).toEqual({ kind: 'cards', cards: 3 });
    });
});
