import { describe, expect, it } from 'vitest';
import type { BehaviorCatalog } from './api';
import { activeRuleTexts } from './roleModel';

const catalog = {
    ruleGroups: [{
        id: 'lang', title: 'Sprache', rules: [
            { id: 'mirror', label: '', description: '', text: 'Spiegeln.', defaultOn: true },
            { id: 'formal', label: '', description: '', text: 'Sie.', offText: 'du.', defaultOn: false },
        ],
    }],
} as unknown as BehaviorCatalog;

// Oracle: kbbehavior.Compile (templateRule.sent) — a rule's text while on,
// its offText while switched off, nothing while the set does not name it.
describe('activeRuleTexts', () => {
    it('sends the off text of a rule switched off', () => {
        expect(activeRuleTexts(catalog, { rules: { mirror: true, formal: false }, customRules: [] })).toEqual(['Spiegeln.', 'du.']);
        expect(activeRuleTexts(catalog, { rules: { mirror: false, formal: true }, customRules: [] })).toEqual(['Sie.']);
    });

    it('sends nothing for a rule the set does not name', () => {
        expect(activeRuleTexts(catalog, { rules: {}, customRules: [] })).toEqual([]);
    });
});
