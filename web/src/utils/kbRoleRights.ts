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
    | 'read'      // KB view: open the topic and chat in it (kbViewChain)
    | 'edit'      // add, change, sync, delete, retry sources (kbEditChain + manageSources)
    | 'members'   // members and invite links (kbAdminChain: /members, /invite-links)
    | 'rights'    // these switches and member roles (kbAdminChain: PATCH /kb/{id}, PUT /members/{userId})
    | 'seeSources'
    | 'selectSources'
    | 'downloadSources'
    | 'seeCitations';

/** Column groups as rendered: the topic itself, then its sources. */
export const KB_RIGHT_GROUPS: readonly { id: 'topic' | 'sources'; columns: readonly KbRightColumn[] }[] = [
    { id: 'topic', columns: ['read', 'members', 'rights'] },
    { id: 'sources', columns: ['seeSources', 'selectSources', 'downloadSources', 'seeCitations', 'edit'] },
];

export const KB_RIGHT_COLUMNS: readonly KbRightColumn[] = KB_RIGHT_GROUPS.flatMap(g => g.columns);

/** Rows top to bottom, as in the mockup: strongest role first. */
export const KB_ROLE_ROWS: readonly KbRole[] = ['owner', 'admin', 'edit', 'view'];

/** A cell is either fixed by the ladder, or bound to one of the KB's flags. */
export type KbRightCell =
    | { kind: 'fixed'; granted: boolean }
    | { kind: 'flag'; flag: KbSourceFlag };

const fixed = (granted: boolean): KbRightCell => ({ kind: 'fixed', granted });
const flag = (f: KbSourceFlag): KbRightCell => ({ kind: 'flag', flag: f });

/*
 * The table. Owner and KB admin always have every capability (API.md "Source
 * permissions": always granted, whatever the flags say). Editors always see,
 * select and download sources and see citations: the viewer* flags apply to the
 * view role only. An editor's "edit" is editorManageSources. Viewers can never
 * edit, manage members or hand out rights.
 */
const MATRIX: Record<KbRole, Record<KbRightColumn, KbRightCell>> = {
    owner: {
        read: fixed(true), edit: fixed(true), members: fixed(true), rights: fixed(true),
        seeSources: fixed(true), selectSources: fixed(true), downloadSources: fixed(true), seeCitations: fixed(true),
    },
    admin: {
        read: fixed(true), edit: fixed(true), members: fixed(true), rights: fixed(true),
        seeSources: fixed(true), selectSources: fixed(true), downloadSources: fixed(true), seeCitations: fixed(true),
    },
    edit: {
        read: fixed(true), edit: flag('editorManageSources'), members: fixed(false), rights: fixed(false),
        seeSources: fixed(true), selectSources: fixed(true), downloadSources: fixed(true), seeCitations: fixed(true),
    },
    view: {
        read: fixed(true), edit: fixed(false), members: fixed(false), rights: fixed(false),
        seeSources: flag('viewerSeeSources'), selectSources: flag('viewerSelectSources'),
        downloadSources: flag('viewerDownloadSources'), seeCitations: flag('viewerSeeCitations'),
    },
};

export function kbRightCell(role: KbRole, column: KbRightColumn): KbRightCell {
    return MATRIX[role][column];
}

/**
 * Flags that only mean something while another one is on: a viewer can only
 * select or download sources from the sidebar list it can see. Shown disabled
 * (with a hint) while the prerequisite is off.
 */
export const FLAG_REQUIRES: Partial<Record<KbSourceFlag, KbSourceFlag>> = {
    viewerSelectSources: 'viewerSeeSources',
    viewerDownloadSources: 'viewerSeeSources',
};

/** Defaults of migration 0089, used when a KB row predates the fields. */
export const SOURCE_FLAG_DEFAULTS: KbSourceFlags = {
    viewerSeeSources: false,
    viewerSelectSources: false,
    viewerDownloadSources: false,
    viewerSeeCitations: false,
    editorManageSources: true,
};

export const SOURCE_FLAGS: readonly KbSourceFlag[] = [
    'viewerSeeSources', 'viewerSelectSources', 'viewerDownloadSources', 'viewerSeeCitations', 'editorManageSources',
];

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
