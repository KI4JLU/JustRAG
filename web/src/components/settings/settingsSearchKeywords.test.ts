import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADMIN_SEARCH_KEYS } from '../admin/adminSearchKeywords';
import { KB_SETTINGS_SEARCH_KEYS } from '../kbSettings/kbSettingsSearchKeywords';
import { RIGHT_LABEL_KEY } from '../../utils/kbRoleRights';
import { USER_SETTINGS_SEARCH_KEYS } from './userSettingsSearchKeywords';

/*
 * Every setting in a settings window — admin console, user settings, KB settings — must be
 * findable from that window's search. Inside the open section the DS search finds any rendered
 * text by itself; to land in that section, the setting's label has to be among the section's
 * keywords. This rule reads each section's sources and checks that every literal label is
 * listed: a settings row's `label={t('key')}`, a `PanelSection` title, and the text of a
 * heading (h2–h4), a tab trigger or a `Label`.
 *
 * Oracle: the source files themselves. A label built at runtime (`t(job.labelKey)`,
 * `RIGHT_LABEL_KEY[right]`) is not seen; list such keys by hand or from their table.
 */
/** `components/`: the section paths below are relative to it. */
const COMPONENTS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type Dialog = { name: string; keys: Record<string, readonly string[]>; files: Record<string, string[]> };

const DIALOGS: Dialog[] = [
    {
        name: 'admin console (admin/adminSearchKeywords.ts, Agent rows: admin/agentSections.ts)',
        keys: ADMIN_SEARCH_KEYS,
        files: {
            configs: ['admin/AdminConfigsTab.tsx'],
            auth: ['admin/AdminAuthTab.tsx'],
            search: ['admin/AdminSearchTab.tsx'],
            agent: ['admin/AdminAgentTab.tsx', 'admin/AdminMCPSection.tsx'],
            site: ['admin/AdminSiteTab.tsx'],
            notice: ['admin/AdminSystemNoticeTab.tsx', 'admin/SystemNoticeEditorParts.tsx'],
            templates: ['admin/AdminTemplatesTab.tsx', 'admin/AdminCategoriesSection.tsx'],
            users: ['admin/AdminUsersTab.tsx'],
            eval: ['admin/AdminEvalTab.tsx'],
            health: ['admin/ReembedSection.tsx'],
        },
    },
    {
        name: 'user settings (settings/userSettingsSearchKeywords.ts)',
        keys: USER_SETTINGS_SEARCH_KEYS,
        files: {
            general: ['settings/UserSettingsModal.tsx'],
            connectors: ['apiKeys/ApiKeyManager.tsx', 'settings/ConfluenceTokenManager.tsx'],
        },
    },
    {
        name: 'KB settings (kbSettings/kbSettingsSearchKeywords.ts)',
        keys: KB_SETTINGS_SEARCH_KEYS,
        files: {
            start: [
                'kbSettings/assistant/StartPageSection.tsx', 'kbSettings/assistant/StartPageParts.tsx',
                'kbSettings/assistant/TitleCardEditor.tsx', 'kbSettings/assistant/ChatStartEditor.tsx',
            ],
            behavior: ['kbSettings/assistant/BehaviorSection.tsx', 'kbSettings/assistant/SystemPromptPanel.tsx', 'kbSettings/assistant/RoleEditorView.tsx'],
            roles: ['kbSettings/KbRolesRightsTab.tsx'],
            members: ['kbSettings/KbMembersPanel.tsx'],
            versions: ['kbSettings/assistant/VersionHistorySection.tsx'],
        },
    },
];

const LABEL_PATTERNS = [
    /<(?:FieldRow|SelectFieldRow|CheckboxFieldRow|TextareaFieldRow|SettingsRow)\b[^>]*?\blabel=\{t\('([^']+)'\)\}/gs,
    /<PanelSection\b[^>]*?\btitle=\{t\('([^']+)'\)\}/gs,
    /<(?:h2|h3|h4|TabsTrigger|Label)\b[^>]*>\s*\{t\('([^']+)'\)\}/gs,
];

/** The translation keys a source file shows literally as a setting's label or heading. */
function labelKeys(source: string): string[] {
    return LABEL_PATTERNS.flatMap((rx) => [...source.matchAll(rx)].map((m) => m[1]));
}

const read = (file: string) => readFileSync(resolve(COMPONENTS, file), 'utf8');

/** Tab files of the admin console without settings of their own (lists, tables, read-only references). */
const ADMIN_NO_ROWS = ['AdminRolesTab.tsx', 'AdminGlobalKbsTab.tsx'];

describe('settings search keywords', () => {
    for (const dialog of DIALOGS) {
        describe(dialog.name, () => {
            for (const [section, files] of Object.entries(dialog.files)) {
                it(`lists every label of ${section}`, () => {
                    // The user settings keep every section in one file: there, any section may hold the key.
                    const own = dialog.keys === USER_SETTINGS_SEARCH_KEYS && section === 'general'
                        ? Object.values(dialog.keys).flat()
                        : dialog.keys[section];
                    const missing = [...new Set(files.flatMap((f) => labelKeys(read(f))))].filter((k) => !own.includes(k));
                    expect(missing, `add these keys to ${section} in ${dialog.name}`).toEqual([]);
                });
            }
        });
    }

    // AdminRolesTab is exempt from the label scan (ADMIN_NO_ROWS) and builds its rights rows at
    // runtime, so the rights table is the oracle: every right's label finds the roles section.
    it('lists every topic right in the admin roles section', () => {
        const missing = Object.values(RIGHT_LABEL_KEY).filter((k) => !ADMIN_SEARCH_KEYS.roles.includes(k));
        expect(missing).toEqual([]);
    });

    // A new admin tab or section file has to be listed above, or its rows escape the rule.
    it('covers every admin tab and section file', () => {
        const listed = new Set(Object.values(DIALOGS[0].files).flat().map((f) => f.replace('admin/', '')));
        const files = readdirSync(resolve(COMPONENTS, 'admin')).filter((f) => /^Admin\w*(Tab|Section)\.tsx$/.test(f) && !ADMIN_NO_ROWS.includes(f));
        expect(files.filter((f) => !listed.has(f))).toEqual([]);
    });
});
