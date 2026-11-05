import { describe, expect, it } from 'vitest';
import { DEFAULT_NAMES, namesFromSiteConfig, resolveNames } from './systemNames';

// Oracle: kbbehavior.Names (names.go) — blank is the default, both
// placeholders are replaced in one pass, any other {{…}} stays.
describe('systemNames', () => {
    it('reads the defaults where the site config sets none', () => {
        expect(namesFromSiteConfig(undefined)).toEqual(DEFAULT_NAMES);
        expect(namesFromSiteConfig({ system_name: '  ', assistant_name: '' })).toEqual(DEFAULT_NAMES);
        expect(namesFromSiteConfig({ system_name: ' Campus RAG ', assistant_name: 'Justus' })).toEqual({ system: 'Campus RAG', assistant: 'Justus' });
    });

    it('fills in both placeholders and leaves other braces alone', () => {
        const names = { assistant: 'Justus', system: 'Campus RAG' };
        expect(resolveNames('Du bist {{assistant_name}} auf {{system_name}}. {{assistant_name}}! {{other}}', names))
            .toBe('Du bist Justus auf Campus RAG. Justus! {{other}}');
    });

    it('does not resolve a name that reads like a placeholder', () => {
        expect(resolveNames('{{assistant_name}}', { assistant: '{{system_name}}', system: 'X' })).toBe('{{system_name}}');
    });
});
