import type { FileEntry, KnowledgeBase } from '../types';

/**
 * The system roles that may operate the KB "advanced settings" surface
 * (KbSettingsPanel: RAG Settings, Agenten & Teams, Evals, Workflow — plus the
 * per-KB re-ingest its Save flow offers).
 *
 * Same triple the backend's kbAdvancedChain passes to RequireRole, and the same
 * one Profile.tsx uses to decide whether to show the API-keys section.
 */
export const KB_ADVANCED_SYSTEM_ROLES: readonly string[] = ['api-user', 'admin', 'superadmin'];

/** Whether `systemRole` is one of KB_ADVANCED_SYSTEM_ROLES. */
export function hasAdvancedSystemRole(systemRole?: string): boolean {
  return systemRole != null && KB_ADVANCED_SYSTEM_ROLES.includes(systemRole);
}

/**
 * Whether the caller's EFFECTIVE role on `kb` is admin or better.
 *
 * Mirrors kbaccess.EffectiveRole (go-backend/internal/kbaccess/middleware.go),
 * truncated at the admin threshold — rules 4 and 5 only ever yield view or
 * nothing, so they are both "false" here:
 *
 *   1. system role superadmin        -> owner
 *   2. a kb_members row              -> that role
 *   3. public KB + system role admin -> admin
 *
 * Rule 2 must stay ahead of rule 3, exactly as on the server: an explicit
 * membership row beats the implicit role a public KB grants, or an editor on a
 * public KB would be read as an admin.
 *
 * Rule 3 is not redundant. `kb.myRole` is the RAW kb_members row (see
 * kbMembershipCols in internal/kb/store_pg.go), not the resolved role, so a
 * system admin curating a public KB they never joined arrives here with no
 * myRole at all while the server grants them admin.
 */
export function hasKbAdminRole(kb: Pick<KnowledgeBase, 'myRole' | 'isGlobal' | 'visibility'>, systemRole?: string): boolean {
  if (systemRole === 'superadmin') return true;
  if (kb.myRole) return kb.myRole === 'admin' || kb.myRole === 'owner';
  if (kb.isGlobal || kb.visibility === 'public') return systemRole === 'admin';
  return false;
}

/**
 * canEditKbSources: whether the caller's EFFECTIVE role on `kb` is edit or
 * better — the threshold of the backend's edit chain (RequireKBRole("edit") in
 * internal/app/routes.go), which gates upload, add-sources, delete, retry and
 * every rss/confluence/git create/patch/delete/sync/poll route. A viewer who
 * is offered those controls only ever gets a 403, so the sidebar hides them.
 *
 * Same ladder as hasKbAdminRole, truncated at edit instead of admin:
 *
 *   1. system role superadmin        -> owner
 *   2. a kb_members row              -> that role (view fails, the rest pass)
 *   3. public KB + system role admin -> admin
 *   4. anything else (implicit viewer of a published KB, no row) -> false
 *
 * `userId` covers the legacy owner-mirror column (`kb.userId`), the same
 * owner check ChatView makes next to hasKbAdminRole. Like the other helpers
 * here this only decides whether to offer a control; the server enforces it.
 *
 * When the backend sends the resolved `capabilities` (per-KB source
 * permissions), `manageSources` is the answer: it already folds in the
 * editorManageSources switch, which the ladder alone cannot see.
 */
export function canEditKbSources(
  kb: Pick<KnowledgeBase, 'myRole' | 'isGlobal' | 'visibility' | 'userId' | 'capabilities'> | null | undefined,
  systemRole?: string,
  userId?: string,
): boolean {
  if (kb == null) return false;
  if (kb.capabilities) return kb.capabilities.manageSources;
  if (systemRole === 'superadmin') return true;
  if (userId != null && kb.userId === userId) return true;
  if (kb.myRole) return kb.myRole !== 'view';
  if (kb.isGlobal || kb.visibility === 'public') return systemRole === 'admin';
  return false;
}

/**
 * chatSourceSelection decides what a chat turn sends about the source
 * selection, and whether it can be sent at all.
 *
 * A caller without `capabilities.selectSources` (a viewer of a KB whose admin
 * keeps the per-request selection off) must not send `selectedFileIds`: the
 * backend refuses such a request with 403 before anything is written. Without
 * the right the turn goes out without a selection and the answer uses the
 * whole KB — it also cannot depend on the sidebar list, which such a viewer
 * may not be allowed to load at all (an empty list is not "nothing selected").
 *
 * With the right (or from a backend that predates capabilities) the old rule
 * holds: at least one selected source, and their ids are sent.
 */
export function chatSourceSelection(
  kb: Pick<KnowledgeBase, 'capabilities'> | null | undefined,
  files: readonly Pick<FileEntry, 'id' | 'selected'>[],
): { canSend: boolean; selectedFileIds?: string[] } {
  if (kb?.capabilities && !kb.capabilities.selectSources) return { canSend: true };
  const selectedFileIds = files.filter(f => f.selected !== false).map(f => f.id);
  return { canSend: selectedFileIds.length > 0, selectedFileIds };
}

/**
 * canOpenKbAdvancedSettings is the single predicate behind BOTH entry points to
 * KbSettingsPanel — the sliders icon on a KB card in HomeView and the one in
 * the ChatView header. They used to carry two hand-written gates that had
 * drifted apart (HomeView checked only the KB role, ChatView only the system
 * role plus the legacy owner-mirror column), so a plain user reached the panel
 * from one and not the other.
 *
 * It is the client-side twin of kbAdvancedChain: a system role in
 * {api-user, admin, superadmin} AND an effective KB role of admin or better.
 * Both terms are required, and the server enforces the same two — this only
 * decides whether to offer the door, never whether it opens.
 */
export function canOpenKbAdvancedSettings(
  kb: Pick<KnowledgeBase, 'myRole' | 'isGlobal' | 'visibility'> | null | undefined,
  systemRole?: string,
): boolean {
  if (kb == null) return false;
  return hasAdvancedSystemRole(systemRole) && hasKbAdminRole(kb, systemRole);
}

/**
 * canRenameKb is the client-side twin of kbaccess.CanRename (the gate on the
 * `name` field of PATCH /api/kb/{id}). Renaming is stricter than the KB role
 * admin that governs the rest of that endpoint:
 *
 *   - private KB: only the owner (superadmin resolves to owner)
 *   - public KB (no owner): only a system admin / superadmin
 *
 * A kb_members admin row alone — curator, demoted ex-owner — is never enough,
 * on either kind of KB. As with canOpenKbAdvancedSettings this only decides
 * whether to offer the control; the server enforces the same rule.
 */
export function canRenameKb(
  kb: Pick<KnowledgeBase, 'myRole' | 'isGlobal' | 'visibility'> | null | undefined,
  systemRole?: string,
): boolean {
  if (kb == null) return false;
  if (systemRole === 'superadmin') return true;
  if (kb.isGlobal || kb.visibility === 'public') return systemRole === 'admin';
  return kb.myRole === 'owner';
}

/**
 * The owned / shared split of `GET /api/kb`.
 *
 * `GET /api/kb` returns every PRIVATE KB the caller holds a `kb_members` row
 * for, and each row carries `myRole` (the raw membership, see `kbMembershipCols`
 * in `internal/kb/store_pg.go`). Splitting it on the client rather than adding a
 * second endpoint keeps the overview at one request: a KB I own is mine,
 * anything else reached me because somebody shared it.
 *
 * It lives here, and not inline in a view, because there are TWO call sites —
 * `MyTopicsView` and `SharedTopicsView` — and the predicate is invertible in a
 * way that reads the same either way round. One definition means the two lists
 * cannot disagree about what „shared" is; two inline copies could, silently and
 * in opposite directions.
 *
 * ===========================================================================
 * THE VISIBILITY MODEL THE THREE VIEWS IMPLEMENT (developer ruling, 18.09.2026)
 * ===========================================================================
 *
 * „Mein Wissen"      topics that belong to me — INCLUDING the ones I own and
 *                    have shared with somebody. Sharing grants another person a
 *                    `kb_members` row; it does not touch mine, so `myRole` stays
 *                    `owner` and the topic stays here. A shared-out topic does
 *                    NOT move and does NOT appear twice.
 *
 * „Geteiltes Wissen" topics OTHERS shared with me. Strictly the complement:
 *                    every row whose `myRole` is not `owner`. My own shared
 *                    topics are absent by construction, which is the half a
 *                    naive „show everything with more than one member" would
 *                    get wrong.
 *
 * „Entdecken"        global topics. Promotion TRANSFERS OWNERSHIP TO THE SYSTEM:
 *                    `kbvisibility.Publish` sets `visibility='public'`, demotes
 *                    the owner's `kb_members` row from `owner` to `admin` — the
 *                    maintainer — and NULLs `knowledge_bases.user_id`, all in
 *                    one transaction (`internal/kbvisibility/store_pg.go`).
 *
 * WHY A PROMOTED TOPIC LEAVES BOTH LISTS ABOVE, AND WHY THIS FUNCTION IS NOT
 * WHAT REMOVES IT. `GET /api/kb` filters `WHERE kb.visibility = 'private'`
 * (`internal/kb/store_pg.go`), so a published topic is not in `kbs` at all and
 * never reaches this split. That matters for the ex-owner in particular: they
 * still hold a membership row, now `admin`, so WITHOUT the server-side filter
 * they would land in `sharedKbs` and the topic would show up under „Geteiltes
 * Wissen" — a topic the system owns, listed as something a person shared. The
 * filter is the guard; this function must never grow a visibility branch that
 * duplicates it, or the two could disagree.
 *
 * Order within each list is the server's, unchanged.
 */
export function splitKbsByOwnership<K extends Pick<KnowledgeBase, 'myRole'>>(
  kbs: readonly K[],
): { ownedKbs: K[]; sharedKbs: K[] } {
  const ownedKbs: K[] = [];
  const sharedKbs: K[] = [];
  for (const kb of kbs) {
    (kb.myRole === 'owner' ? ownedKbs : sharedKbs).push(kb);
  }
  return { ownedKbs, sharedKbs };
}
