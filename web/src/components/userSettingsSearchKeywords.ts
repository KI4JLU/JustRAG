import type { SettingsTab } from './UserSettingsModal';

/*
 * What the user settings search matches besides a section's name: the labels inside it.
 * Translation keys (read in the session language) plus a few fixed words.
 * settingsSearchKeywords.test.ts fails when a settings row's label is missing here.
 */
export const USER_SETTINGS_SEARCH_KEYS: Record<SettingsTab, readonly string[]> = {
    general: ['appearance', 'contrast', 'accentColor', 'languageLabel'],
    chat: ['promptSuggestions', 'followUpsLabel', 'autoScrollLabel'],
    profile: ['username', 'firstName', 'lastName', 'emailAddress', 'role'],
    connectors: ['apiKeys', 'confluenceProfileTitle'],
};

const FIXED_WORDS: Partial<Record<SettingsTab, readonly string[]>> = {
    connectors: ['API', 'Confluence'],
};

/** The search keywords of one section, in the session language. */
export function userSettingsKeywords(section: SettingsTab, t: (key: string) => string): string[] {
    return [...USER_SETTINGS_SEARCH_KEYS[section].map(t), ...(FIXED_WORDS[section] ?? [])];
}
