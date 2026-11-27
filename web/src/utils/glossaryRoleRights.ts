import type { GlossaryRole } from '../components/translator/types';

/**
 * What each glossary role may do in a glossary: the reference table of the admin console's
 * „Rollen & Rechte". Read-only, and the single source of truth for that table in the web code.
 *
 * The ladder is code, not data (`glossaryaccess.EffectiveRole` in
 * go-backend/internal/glossaryaccess, docs/glossary-access.md): `viewer < editor < admin < owner`,
 * and every right below belongs to the lowest role that has it — each role has all of the ones
 * beneath it. There is no rung for a system role: a system admin is a stranger to somebody
 * else's private glossary. The glossary dialog itself reads the flags the list returns
 * (`canEdit`, `canManage`, `canDelete`); this table is for the reference only.
 *
 * A CSV import is no row of it: it makes a new glossary of the caller's own and needs only the
 * translation permission, not a role in a glossary that exists.
 */
export type GlossaryRight =
    | 'use'            // pick the glossary for a translation
    | 'read'           // read its entries
    | 'editEntries'    // PUT /api/glossaries/{id}: entries
    | 'editDetails'    // name, description, category
    | 'visibility'     // PATCH /api/glossaries/{id}
    | 'manageMembers'  // /members, /invite-links
    | 'delete'         // DELETE /api/glossaries/{id}
    | 'transferOwner'; // POST /api/glossaries/{id}/transfer-owner

export type GlossaryRightGroupId = 'content' | 'sharing' | 'glossary';

/** Row groups as rendered. */
export const GLOSSARY_RIGHT_GROUPS: readonly { id: GlossaryRightGroupId; rights: readonly GlossaryRight[] }[] = [
    { id: 'content', rights: ['use', 'read', 'editEntries', 'editDetails'] },
    { id: 'sharing', rights: ['visibility', 'manageMembers'] },
    { id: 'glossary', rights: ['delete', 'transferOwner'] },
];

export const GLOSSARY_RIGHTS: readonly GlossaryRight[] = GLOSSARY_RIGHT_GROUPS.flatMap(g => g.rights);

/** Columns left to right: strongest role first. */
export const GLOSSARY_ROLE_COLUMNS: readonly GlossaryRole[] = ['owner', 'admin', 'editor', 'viewer'];

const RANK: Record<GlossaryRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

/** The lowest role that has a right. */
const MIN_ROLE: Record<GlossaryRight, GlossaryRole> = {
    use: 'viewer', read: 'viewer',
    editEntries: 'editor', editDetails: 'editor',
    visibility: 'admin', manageMembers: 'admin',
    delete: 'owner', transferOwner: 'owner',
};

/** Whether a role has a right. */
export function glossaryRoleHas(role: GlossaryRole, right: GlossaryRight): boolean {
    return RANK[role] >= RANK[MIN_ROLE[right]];
}

/** Each right's row label (a translation key); also the admin search's keywords for the table. */
export const GLOSSARY_RIGHT_LABEL_KEY: Record<GlossaryRight, string> = {
    use: 'arGlossaryRightUse', read: 'arGlossaryRightRead', editEntries: 'arGlossaryRightEditEntries',
    editDetails: 'arGlossaryRightDetails',
    visibility: 'arGlossaryRightVisibility', manageMembers: 'arGlossaryRightMembers',
    delete: 'arGlossaryRightDelete', transferOwner: 'arGlossaryRightTransfer',
};

export const GLOSSARY_RIGHT_HINT_KEY: Record<GlossaryRight, string> = {
    use: 'arGlossaryRightUseHint', read: 'arGlossaryRightReadHint', editEntries: 'arGlossaryRightEditEntriesHint',
    editDetails: 'arGlossaryRightDetailsHint',
    visibility: 'arGlossaryRightVisibilityHint', manageMembers: 'arGlossaryRightMembersHint',
    delete: 'arGlossaryRightDeleteHint', transferOwner: 'arGlossaryRightTransferHint',
};

export const GLOSSARY_GROUP_LABEL_KEY: Record<GlossaryRightGroupId, string> = {
    content: 'arGlossaryGroupContent', sharing: 'arGlossaryGroupSharing', glossary: 'arGlossaryGroupGlossary',
};
