import type { KbRole, KbSourceFlag, KbSourceFlags, KnowledgeBase } from '../types';

/**
 * The "Rollen & Rechte" matrix of one KB: what each KB role may do in it.
 * Rendered rotated (decided 2026-10-16): rights are rows, grouped; roles are
 * columns.
 *
 * Most of it is FIXED: the role ladder is code, not data
 * (kbaccess.EffectiveRole in go-backend/internal/kbaccess/middleware.go), and
 * each right below names the routes whose gate it mirrors. Only the cells
 * bound to a per-KB source flag (migration 0089) are editable; their value is
 * the KB's own flag. Changing a fixed cell would need a configurable permission
 * model, which does not exist (decided 2026-10-16: show it, don't fake it).
 */
export type KbRight =
    | 'invite'          // invite people (/members, /invite-links — kbAdminChain today)
    | 'seeSources'      // the sidebar source list
    | 'addSources'      // upload / add sources: file, text, web, RSS, Confluence, Git
    | 'downloadSources' // download + in-app preview (PDF, spreadsheet tabs)
    | 'editSources'     // change, sync, delete, reprocess sources (kbManageSourcesChain: role ≥ edit)
    | 'seeCitations';   // citations under answers

/** Row groups as rendered: the topic, the sidebar's sources, the answers. */
export const KB_RIGHT_GROUPS: readonly { id: 'topic' | 'sidebar' | 'answers'; rights: readonly KbRight[] }[] = [
    { id: 'topic', rights: ['invite'] },
    { id: 'sidebar', rights: ['seeSources', 'addSources', 'downloadSources', 'editSources'] },
    { id: 'answers', rights: ['seeCitations'] },
];

export const KB_RIGHTS: readonly KbRight[] = KB_RIGHT_GROUPS.flatMap(g => g.rights);

/** Columns left to right: strongest role first. */
export const KB_ROLE_COLUMNS: readonly KbRole[] = ['owner', 'admin', 'edit', 'view'];

/** Roles whose rights are all fixed (shown muted, and not in the narrow layout). */
export const KB_ALWAYS_ALL_ROLES: readonly KbRole[] = ['owner', 'admin'];

/** Roles a KB admin configures here (the narrow layout's role switcher). */
export const KB_CONFIGURABLE_ROLES: readonly KbRole[] = ['edit', 'view'];

/**
 * A cell is fixed by the ladder, bound to one of the KB's flags, or not
 * applicable to the role at all ("–": a viewer who could add or edit sources
 * would be an editor). `scope` is the translation key of the text a granted
 * cell shows instead of a check mark (which roles the right reaches, e.g.
 * "bis Admin"). A fixed cell can still depend on a flag (`requires`): it is
 * granted only while that flag is on.
 */
export type KbRightCell =
    | { kind: 'fixed'; granted: boolean; scope?: string; requires?: KbSourceFlag }
    | { kind: 'flag'; flag: KbSourceFlag }
    | { kind: 'na' };

const yes = (scope?: string): KbRightCell => ({ kind: 'fixed', granted: true, scope });
const yesIf = (requires: KbSourceFlag): KbRightCell => ({ kind: 'fixed', granted: true, requires });
const no: KbRightCell = { kind: 'fixed', granted: false };
const na: KbRightCell = { kind: 'na' };
const flag = (f: KbSourceFlag): KbRightCell => ({ kind: 'flag', flag: f });

/*
 * The table. Owner and KB admin always have every capability (API.md "Source
 * permissions": always granted, whatever the flags say); the owner can hand out
 * every assignable role, an admin every role below admin (kbaccess.Assignable —
 * the owner moves only through the transfer endpoint). Inviting is admin-only
 * until the invite-rights card lands (then a select: Nein / als Leser / bis
 * Bearbeiter); editors and viewers show today's "Nein".
 *
 * The rights form a pyramid (decided 2026-10-16): "see" (the sidebar list)
 * and citations are independent; adding, downloading and editing sources all
 * act on the list and so need "see" of the same role — editing too, although
 * it is fixed by role (see FLAG_REQUIRES and the `requires` of the editor's
 * editSources cell). Viewers can never add or edit sources: that would make
 * them editors. Selecting sources for an answer is not a permission: whoever
 * sees the list may select from it.
 */
const MATRIX: Record<KbRole, Record<KbRight, KbRightCell>> = {
    owner: {
        invite: yes('rrScopeAllRoles'),
        seeSources: yes(), addSources: yes(), downloadSources: yes(), editSources: yes(), seeCitations: yes(),
    },
    admin: {
        invite: yes('rrScopeUpToAdmin'),
        seeSources: yes(), addSources: yes(), downloadSources: yes(), editSources: yes(), seeCitations: yes(),
    },
    edit: {
        invite: no,
        seeSources: flag('editorSeeSources'), addSources: flag('editorAddSources'),
        downloadSources: flag('editorDownloadSources'), editSources: yesIf('editorSeeSources'),
        seeCitations: flag('editorSeeCitations'),
    },
    view: {
        invite: no,
        seeSources: flag('viewerSeeSources'), addSources: na,
        downloadSources: flag('viewerDownloadSources'), editSources: na,
        seeCitations: flag('viewerSeeCitations'),
    },
};

export function kbRightCell(role: KbRole, right: KbRight): KbRightCell {
    return MATRIX[role][right];
}

/**
 * Flags that only mean something while another one is on: a role can only add
 * to (editors only) or download from the sidebar list it can see. Shown
 * disabled (with a hint) while the prerequisite is off. Citations have no
 * prerequisite.
 */
export const FLAG_REQUIRES: Partial<Record<KbSourceFlag, KbSourceFlag>> = {
    viewerDownloadSources: 'viewerSeeSources',
    editorAddSources: 'editorSeeSources',
    editorDownloadSources: 'editorSeeSources',
};

/** The prerequisite flag of a cell (flag or fixed), if any. */
export function cellRequires(cell: KbRightCell): KbSourceFlag | undefined {
    if (cell.kind === 'flag') return FLAG_REQUIRES[cell.flag];
    return cell.kind === 'fixed' ? cell.requires : undefined;
}

/**
 * A cell resolved against the drafted flags: what it shows right now.
 * `blocked` = its prerequisite ("Sehen" of the same role) is off; a blocked
 * cell is shown as not granted and cannot be changed.
 */
export type KbRightState =
    | { kind: 'fixed'; granted: boolean; scope?: string; blocked: boolean }
    | { kind: 'flag'; flag: KbSourceFlag; checked: boolean; blocked: boolean }
    | { kind: 'na' };

export function resolveRightCell(role: KbRole, right: KbRight, flags: KbSourceFlags): KbRightState {
    const cell = kbRightCell(role, right);
    if (cell.kind === 'na') return cell;
    const requires = cellRequires(cell);
    const blocked = requires != null && !flags[requires];
    if (cell.kind === 'flag') return { kind: 'flag', flag: cell.flag, checked: flags[cell.flag] && !blocked, blocked };
    return { kind: 'fixed', granted: cell.granted && !blocked, scope: cell.scope, blocked };
}

/** Defaults of migration 0089, used when a KB row predates the fields. */
export const SOURCE_FLAG_DEFAULTS: KbSourceFlags = {
    viewerSeeSources: false,
    viewerDownloadSources: false,
    viewerSeeCitations: false,
    editorSeeSources: true,
    editorAddSources: true,
    editorDownloadSources: true,
    editorSeeCitations: true,
};

export const SOURCE_FLAGS = Object.keys(SOURCE_FLAG_DEFAULTS) as readonly KbSourceFlag[];

/** The KB's current flags, falling back to the migration defaults. */
export function sourceFlagsOf(kb: Partial<Pick<KnowledgeBase, KbSourceFlag>> | null | undefined): KbSourceFlags {
    const out = { ...SOURCE_FLAG_DEFAULTS };
    if (kb) for (const f of SOURCE_FLAGS) if (typeof kb[f] === 'boolean') out[f] = kb[f] as boolean;
    return out;
}

/** The PATCH body for what changed between `saved` and `draft`; null when nothing did. */
export function sourceFlagsPatch(saved: KbSourceFlags, draft: KbSourceFlags): Partial<KbSourceFlags> | null {
    const patch: Partial<KbSourceFlags> = {};
    for (const f of SOURCE_FLAGS) if (saved[f] !== draft[f]) patch[f] = draft[f];
    return Object.keys(patch).length ? patch : null;
}
