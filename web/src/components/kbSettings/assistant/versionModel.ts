import type { SettingsVersion, VersionChange } from './api';

type T = (k: string) => string;

/** The label of a change's field (codes: API.md "Assistant settings and versions"). */
export function changeFieldLabel(c: VersionChange, t: T): string {
    const label = t(`asstField_${c.field}`);
    return label.replace('{ref}', c.ref ?? '');
}

/**
 * A stored display value in the reader's words: on/off, colours, mode ids
 * and the start summaries („task: …") the server writes in a fixed form.
 */
export function changeValue(c: VersionChange, raw: string | undefined, t: T): string {
    if (raw === undefined) return '';
    switch (c.field) {
        case 'questionsOn':
        case 'rule':
        case 'customRuleToggled':
            return raw === 'on' ? t('asstOn') : raw === 'off' ? t('asstOff') : raw;
        case 'roleSuggestions':
            return raw === 'off' ? t('asstOff')
                : raw.startsWith('dynamic ') ? `${t('asstDynamic')} (${raw.slice(8)})`
                    : raw.startsWith('fixed: ') ? `${t('asstFixedMode')}: ${raw.slice(7)}` : raw;
        case 'colors':
            return raw ? raw.replace(' ', ' → ') : t('asstColorsNone');
        case 'startMode':
            return raw === 'input' ? t('asstStartInput') : raw === 'upload' ? t('asstStartUpload') : raw === 'roles' ? t('asstStartRoles') : raw;
        case 'questionMode':
            return raw === 'dynamic' ? t('asstDynamic') : raw === 'fixed' ? t('asstFixedMode') : raw;
        case 'description':
            return raw || t('asstAutomatic');
        case 'category':
            return raw || t('asstNoCategory');
        case 'roleStart':
            return raw ? entryValue(raw, t) : t('asstRoleStartNone');
        default:
            return raw || t('asstEmptyValue');
    }
}

/** The server's start summary of a role card: "input", "task: …", "task (prefill): …", "file: …". */
function entryValue(raw: string, t: T): string {
    if (raw === 'input') return t('asstKind_input');
    if (raw.startsWith('task (prefill): ')) return `${t('asstKind_task')} „${raw.slice(16)}“ (${t('asstPrefillOnly')})`;
    if (raw.startsWith('task: ')) return `${t('asstKind_task')} „${raw.slice(6)}“`;
    if (raw.startsWith('file: ')) return `${t('asstKind_file')}: ${raw.slice(6).trim()}`;
    return raw;
}

/** The version's note: the author's, or one written from its changes (then „automatisch"). */
export function versionNote(v: SettingsVersion, t: T): { text: string; auto: boolean } {
    if (v.note) return { text: v.note, auto: false };
    if (v.kind === 'baseline') return { text: t('asstNoteBaseline'), auto: true };
    if (v.kind === 'restore' && v.restoredFrom) return { text: t('asstNoteRestored').replace('{n}', String(v.restoredFrom)), auto: true };
    const n = v.changes.length;
    if (n === 0) return { text: t('asstNoteMinor'), auto: true };
    if (n === 1) return { text: t('asstNoteOne').replace('{field}', changeFieldLabel(v.changes[0], t)), auto: true };
    const areas = new Set(v.changes.map(c => c.area));
    const key = areas.size > 1 ? 'asstNoteBothN' : areas.has('start') ? 'asstNoteStartN' : 'asstNoteBehaviorN';
    return { text: t(key).replace('{n}', String(n)), auto: true };
}

/** Initials for the author avatar. */
export function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
