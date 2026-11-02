import { describe, expect, it } from 'vitest';
import { DEFAULT_SUGGESTIONS } from '../kbSettings/assistant/api';
import { startIn, withStart } from './roleTemplatesApi';

const input = (questionsOn: boolean, fixedQuestions: string[]) => ({
    kind: 'input' as const, text: '', send: true, instruction: '',
    suggestions: { ...DEFAULT_SUGGESTIONS, questionsOn, questionMode: 'fixed' as const, fixedQuestions },
});

describe('withStart', () => {
    // Oracle: the untouched input field is no start of its own.
    it('drops the plain input field', () => {
        expect(withStart(null, 'de', startIn(null, 'de'))).toBeNull();
    });

    // Oracle: switching suggestions off keeps the questions, mode and count as a draft.
    it('keeps switched-off questions as a draft', () => {
        const on = withStart(null, 'de', input(true, ['Was?']));
        const off = withStart(on, 'de', input(false, ['Was?']));
        expect(off?.suggestions).toMatchObject({ questionsOn: false, questionMode: 'fixed', fixedQuestions: { de: ['Was?'] } });
        expect(startIn(off, 'de').suggestions).toMatchObject({ questionMode: 'fixed', fixedQuestions: ['Was?'] });
    });
});
