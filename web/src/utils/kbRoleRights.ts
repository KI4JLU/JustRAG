import type { KbRole, KbSourceFlag, KbSourceFlags, KnowledgeBase } from '../types';

/**
 * The "Rollen & Rechte" matrix of one KB: what each KB role may do in it.
 *
 * Most of it is FIXED: the role ladder is code, not data
 * (kbaccess.EffectiveRole in go-backend/internal/kbaccess/middleware.go), and
 * each column below names the routes whose gate it mirrors. Only the cells
 * bound to a per-KB source flag (migration 0089) are editable; their value is
 * the KB's own flag. Changing a fixed cell would need a configurable permission
 * model, which does not exist (decided 2026-10-16: show it, don't fake it).
 */
export type KbRightColumn =
    | 'invite'          // invite people (/members, /invite-links — kbAdminChain today)
    | 'rights'          // change member roles, remove members (kbAdminChain, kbaccess.Assignable)
    | 'seeSources'      // the sidebar source list
    | 'selectSources'   // limit an answer to selected sources (selectedFileIds)
    | 'downloadSources' // download + in-app preview (PDF, spreadsheet tabs)
    | 'editSources'     // add, sync, delete, retry sources (kbManageSourcesChain: role ≥ edit)
    | 'seeCitations';   // citations under answers

/** Column groups as rendered: the topic, the sidebar's sources, the answers. */
export const KB_RIGHT_GROUPS: readonly { id: 'topic' | 'sidebar' | 'answers'; columns: readonly KbRightColumn[] }[] = [
    { id: 'topic', columns: ['invite', 'rights'] },
    { id: 'sidebar', columns: ['seeSources', 'selectSources', 'downloadSources', 'editSources'] },
    { id: 'answers', columns: ['seeCitations'] },
];

export const KB_RIGHT_COLUMNS: readonly KbRightColumn[] = KB_RIGHT_GROUPS.flatMap(g => g.columns);

/** Rows top to bottom, as in the mockup: strongest role first. */
export const KB_ROLE_ROWS: readonly KbRole[] = ['owner', 'admin', 'edit', 'view'];

/**
 * A cell is either fixed by the ladder, or bound to one of the KB's flags.
 * `scope` is the translation key of the small caption under a granted cell
 * (which roles the right reaches, e.g. "bis Admin").
 */
export type KbRightCell =
    | { kind: 'fixed'; granted: boolean; scope?: string }
    | { kind: 'flag'; flag: KbSourceFlag };

const yes = (scope?: string): KbRightCell => ({ kind: 'fixed', granted: true, scope });
const no: KbRightCell = { kind: 'fixed', granted: false };
const flag = (f: KbSourceFlag): KbRightCell => ({ kind: 'flag', flag: f });

/*
 * The table. Owner and KB admin always have every capability (API.md "Source
 * permissions": always granted, whatever the flags say); the owner can hand out
 * every assignable role, an admin view/edit/admin (kbaccess.Assignable — the
 * owner moves only through the transfer endpoint). Editing sources is fixed by
 * role (edit and above). What editors and viewers see, select, download and
 * cite is the KB's flags. Inviting is admin-only until the invite-rights card
 * lands; those cells are shown with today's state, not as switches.
 */
const MATRIX: Record<KbRole, Record<KbRightColumn, KbRightCell>> = {
    owner: {
        invite: yes('rrScopeAllRoles'), rights: yes('rrScopeAllRoles'),
        seeSources: yes(), selectSources: yes(), downloadSources: yes(), editSources: yes(), seeCitations: yes(),
    },
    admin: {
        invite: yes('rrScopeUpToAdmin'), rights: yes('rrScopeUpToAdmin'),
        seeSources: yes(), selectSources: yes(), downloadSources: yes(), editSources: yes(), seeCitations: yes(),
    },
    edit: {
        invite: no, rights: no,
        seeSources: flag('editorSeeSources'), selectSources: flag('editorSelectSources'),
        downloadSources: flag('editorDownloadSources'), editSources: yes(), seeCitations: flag('editorSeeCitations'),
    },
    view: {
        invite: no, rights: no,
        seeSources: flag('viewerSeeSources'), selectSources: flag('viewerSelectSources'),
        downloadSources: flag('viewerDownloadSources'), editSources: no, seeCitations: flag('viewerSeeCitations'),
    },
};

export function kbRightCell(role: KbRole, column: KbRightColumn): KbRightCell {
    return MATRIX[role][column];
}

/**
 * Flags that only mean something while another one is on: a role can only
 * select or download sources from the sidebar list it can see. Shown disabled
 * (with a hint) while the prerequisite is off.
 */
export const FLAG_REQUIRES: Partial<Record<KbSourceFlag, KbSourceFlag>> = {
    viewerSelectSources: 'viewerSeeSources',
    viewerDownloadSources: 'viewerSeeSources',
    editorSelectSources: 'editorSeeSources',
    editorDownloadSources: 'editorSeeSources',
};

/** Defaults of migration 0089, used when a KB row predates the fields. */
export const SOURCE_FLAG_DEFAULTS: KbSourceFlags = {
    viewerSeeSources: false,
    viewerSelectSources: false,
    viewerDownloadSources: false,
    viewerSeeCitations: false,
    editorSeeSources: true,
    editorSelectSources: true,
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
