import type { KbSettingsSection } from '../../types';
import { RIGHT_LABEL_KEY } from '../../utils/kbRoleRights';
import { assistantTranslations } from '../../translations.assistant';

/*
 * What the KB settings search matches besides a section's name: the labels, headings and
 * rights inside it, so „Herunterladen" or „Systemprompt" find the section that holds them.
 * Translation keys, read in the session language. The kbSettingsKeywords* entries are
 * word lists of their own (synonyms). settingsSearchKeywords.test.ts fails when a settings
 * row's label is missing here.
 */
export const KB_SETTINGS_SEARCH_KEYS: Record<KbSettingsSection, readonly string[]> = {
    start: [
        'asstTitle', 'asstCategory', 'asstDescription', 'asstQuestions', 'asstRoleEntries', 'asstChatStart',
        'asstChooseRoleHeading', 'asstGenerateDescription',
        'asstDynamic', 'asstFixedMode', 'asstCount', 'asstUploadLabel', 'asstUploadInstruction',
    ],
    behavior: [
        'asstTabRole', 'asstTabRules', 'asstRagInstructions', 'kbSettingsKeywordsBehavior', 'asstSystemPrompt',
        'asstRagSearch', 'asstRulesForThisRole', 'kbAdvancedSettings',
    ],
    roles: ['kbSettingsKeywordsRoles', ...Object.values(RIGHT_LABEL_KEY), 'kbRoleOwner', 'kbRoleAdmin', 'kbRoleEdit', 'kbRoleView'],
    members: [
        'addMembers', 'inviteLinks', 'kbSettingsKeywordsMembers', 'allMembers', 'pendingInvites', 'usernamesLabel',
        'roleLabel', 'newInviteLink', 'inviteLinkTitle', 'activeInviteLinks', 'byUsername',
    ],
    // Every field a version can change (Titel, Farben, Systemprompt, …), as its changes list them.
    versions: ['asstRestore', 'asstAllChanges', ...Object.keys(assistantTranslations).filter(k => k.startsWith('asstField_'))],
};

/** The search keywords of one section, in the session language. */
export function kbSettingsKeywords(section: KbSettingsSection, t: (key: string) => string): string[] {
    // A field label may carry a placeholder („Vorschläge · {ref}"): the search matches the words.
    return KB_SETTINGS_SEARCH_KEYS[section].map(k => t(k).replace(/\s*·?\s*\{\w+\}/g, ''));
}
