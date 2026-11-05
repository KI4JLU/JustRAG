import { describe, expect, it } from 'vitest';
import { DEFAULT_NAMES, namesFromSiteConfig, resolveNames } from './systemNames';

// Oracle: kbbehavior.Names (names.go) — blank is the default, the
// placeholders are replaced in one pass, any other {{…}} stays.
describe('systemNames', () => {
    it('reads the defaults where the site config sets none', () => {
        expect(namesFromSiteConfig(undefined)).toEqual(DEFAULT_NAMES);
        expect(namesFromSiteConfig({ institution_name: ' ', system_name: '  ', assistant_name: '' })).toEqual(DEFAULT_NAMES);
        expect(namesFromSiteConfig({ institution_name: ' TUM', system_name: ' Wissen ', assistant_name: 'Justus' }))
            .toEqual({ institution: 'TUM', system: 'Wissen', assistant: 'Justus' });
    });

    it('defaults institution and system to the environment, as kbbehavior.SetAppNameDefaults', () => {
        const env = { app_name_prefix: 'THM', app_name_product: 'Docs' };
        expect(namesFromSiteConfig(env)).toEqual({ institution: 'THM', system: 'Docs', assistant: DEFAULT_NAMES.assistant });
        expect(namesFromSiteConfig({ ...env, system_name: 'Wissen' })).toEqual({ institution: 'THM', system: 'Wissen', assistant: DEFAULT_NAMES.assistant });
    });

    it('fills in the placeholders and leaves other braces alone', () => {
        const names = { assistant: 'Justus', institution: 'TUM', system: 'Wissen' };
        expect(resolveNames('Du bist {{assistant_name}} auf {{institution_name}} {{system_name}}. {{assistant_name}}! {{other}}', names))
            .toBe('Du bist Justus auf TUM Wissen. Justus! {{other}}');
    });

    it('does not resolve a name that reads like a placeholder', () => {
        expect(resolveNames('{{assistant_name}}', { assistant: '{{system_name}}', institution: 'X', system: 'Y' })).toBe('{{system_name}}');
    });
});
