import type { FileEntry, KbCapabilities, KnowledgeBase } from '../types';

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
 * Whether the caller may open „Thema-Einstellungen" (Verhalten, Rollen &
 * Rechte, Mitglieder) — and with it every entry point into it: the gear in the
 * workspace header and „Teilen" on the topic cards, which opens the Mitglieder
 * section. All three sections write through admin-gated routes (PATCH
 * /api/kb/{id} and /members on kbAdminChain), so this is hasKbAdminRole plus
 * the legacy owner column for a row that arrives without myRole.
 */
export function canOpenKbTopicSettings(
  kb: Pick<KnowledgeBase, 'userId' | 'myRole' | 'isGlobal' | 'visibility'>,
  systemRole?: string,
  userId?: string,
): boolean {
  return (!!userId && kb.userId === userId) || hasKbAdminRole(kb, systemRole);
}

/**
 * hasKbEditRole: whether the caller's EFFECTIVE role on `kb` is edit or better
 * — the threshold of the backend's edit chain (RequireKBRole("edit") in
 * internal/app/routes.go). It is only the FALLBACK of kbSourceRights' add and
 * manage rights, for a backend that sends no `capabilities` yet; there the
 * edit chain still gates adding and changing sources alike.
 *
 * Same ladder as hasKbAdminRole, truncated at edit instead of admin:
 *
 *   1. system role superadmin        -> owner
 *   2. a kb_members row              -> that role (view fails, the rest pass)
 *   3. public KB + system role admin -> admin
 *   4. anything else (implicit viewer of a published KB, no row) -> false
 *
 * `userId` covers the legacy owner-mirror column (`kb.userId`), the same
 * owner check ChatView makes next to hasKbAdminRole.
 */
function hasKbEditRole(
  kb: Pick<KnowledgeBase, 'myRole' | 'isGlobal' | 'visibility' | 'userId'>,
  systemRole?: string,
  userId?: string,
): boolean {
  if (systemRole === 'superadmin') return true;
  if (userId != null && kb.userId === userId) return true;
  if (kb.myRole) return kb.myRole !== 'view';
  if (kb.isGlobal || kb.visibility === 'public') return systemRole === 'admin';
  return false;
}

/**
 * kbSourceRights: what the caller may do with `kb`'s sources — the single
 * answer every source control in the UI reads (sidebar, rail, chat answers,
 * search). The UI rule (2026-10-16): a control the caller cannot use is not
 * rendered at all, never shown disabled.
 *
 * The answer is the backend's `capabilities` — its own resolution of role +
 * the KB's viewer/editor flags (kbaccess.CapabilitiesFor), so the two cannot
 * drift. It is a pyramid the backend already resolves; the UI only reads it:
 *
 *   level 1, independent:  seeSources (the source list, and with it the
 *                          selection), seeCitations (an answer's citations)
 *   level 2, need the list: downloadSources (download + preview),
 *                          addSources (create a source of any kind),
 *                          manageSources (change, sync, pause, delete, retry)
 *
 * Against a backend that predates capabilities, today's behaviour: list,
 * downloads and citations for everyone, adding and managing on the edit-role
 * ladder. Without a KB (a library chat has none) the same fallback, minus
 * add/manage. Like the other helpers here this only decides whether to offer
 * a control; the server enforces it.
 */
export function kbSourceRights(
  kb: Pick<KnowledgeBase, 'myRole' | 'isGlobal' | 'visibility' | 'userId' | 'capabilities'> | null | undefined,
  systemRole?: string,
  userId?: string,
): KbCapabilities {
  if (kb?.capabilities) return kb.capabilities;
  const edit = kb != null && hasKbEditRole(kb, systemRole, userId);
  return { seeSources: true, addSources: edit, downloadSources: true, seeCitations: true, manageSources: edit };
}

/**
 * unlistableKbId: the id of `kb` when the caller may not see its source lists
 * (capabilities.seeSources off), else null. The list fetchers (files, RSS,
 * Confluence, git) and every poll built on them skip the request for that id
 * and hold an empty list instead — the backend would answer 403 and the UI
 * shows no list there anyway. Without capabilities (an older backend) nothing
 * is skipped. A primitive on purpose, so it can sit in a hook's deps.
 */
export function unlistableKbId(kb: Pick<KnowledgeBase, 'id' | 'capabilities'> | null | undefined): string | null {
  return kb?.capabilities && !kb.capabilities.seeSources ? kb.id : null;
}

/**
 * chatSourceSelection decides what a chat turn sends about the source
 * selection, and whether it can be sent at all.
 *
 * Selecting sources is not a permission of its own: whoever sees the source
 * list may narrow the turn to a selection, whoever does not see it cannot
 * (backend contract 2026-10-16 — `capabilities.selectSources` is gone). So a
 * caller without `capabilities.seeSources` sends no `selectedFileIds` and the
 * turn always goes out, answered from the whole KB — it cannot depend on the
 * sidebar list, which such a caller cannot load (an empty list is not "nothing
 * selected").
 *
 * With the list (or from a backend that predates capabilities) the old rule
 * holds: at least one selected source, and their ids are sent.
 */
export function chatSourceSelection(
  kb: Pick<KnowledgeBase, 'capabilities'> | null | undefined,
  files: readonly Pick<FileEntry, 'id' | 'selected'>[],
): { canSend: boolean; selectedFileIds?: string[] } {
  if (kb?.capabilities && !kb.capabilities.seeSources) return { canSend: true };
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
