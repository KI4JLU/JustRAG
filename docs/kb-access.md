# KB access, visibility and topic filters

Code: `internal/kbaccess`, `internal/kbvisibility`, `internal/kbsubs`, `internal/kbcategories`,
`internal/kbfilters`, `internal/kbmembers`, `internal/kbinvites`.

## Roles

Four roles, strictly ordered: `view < edit < admin < owner`.

| Role | May |
|---|---|
| `view` | Chat with the KB. Never adds sources. |
| `edit` | Fill the corpus: upload and delete files, RSS / Confluence / git sources, crawl. Adding also needs the `editor_add_sources` flag. |
| `admin` | Everything that can force a re-ingest or change answer quality: description, prompt, models, canonicalize, knowledge-graph communities, member management. Tuning knobs, evals, workflow and agents and teams are the advanced surface, open to system admins only (see Role resolution). |
| `owner` | Everything, plus rename. At most one per KB (partial unique index); a public KB has none. Moves only through the transfer endpoint, never through `/members`. |

**Rename** (`name`) is the one field of `PATCH /api/kb/{id}` that is stricter than the route's
`admin` gate (`kbaccess.CanRename`). UI mirror `canRenameKb`: the pencil on the topic card; public
KBs also have the name field in `GlobalKbSettings`.

- Private KB: `owner` only (superadmin resolves to owner).
- Public KB: system `admin` / `superadmin` only.
- A `kb_members` `admin` row alone gets 403.

**Storage**

- `kb_members(kb_id, user_id, role)` is the sole authority.
- `knowledge_bases.user_id` is a mirror maintained by the trigger `kb_members_sync_owner_trg`
  (fires on `INSERT OR UPDATE ... WHERE role='owner'`). Owner-display queries still join through
  it. Never write it directly.
- `knowledge_base_shares` and `global_kb_editors` are legacy tables (backfilled into `kb_members`
  by migration 0064). No access decision reads them; `internal/cascade` still deletes from them.
  There are no `/share*` routes.
- The admin global-KB editor endpoints (`/api/admin/global-kbs/{id}/editors*`) read and write
  `kb_members` with `role='admin'`.

## Role resolution

`kbaccess.EffectiveRole(kb, sysRole, memberRole)` is the only ladder
(`internal/kbaccess/middleware.go`). First match wins; the order is load-bearing:

1. System role `superadmin` → `owner`
2. A `kb_members` row → that role
3. `IsGlobal` + system role `admin` → `admin`
4. `IsGlobal` + `IsPublished` → `view`
5. Otherwise → 403

Consequences:

- An explicit `kb_members` row beats the implicit public-KB roles (rule 2 before 3 and 4).
- An unpublished public KB is readable only through rules 1 to 3 (superadmin, a `kb_members` row
  of any role, system admin), not through rule 4. That holds on every `view`-gated route: the whole
  `kbViewChain` (chat, graph, generated content, files, research, export), plus `/api/v1/*` and
  the KB-as-MCP endpoint, which wrap `RequireKBRole(kbaccess.RoleView)` directly.

**Route gates**

- `kbaccess.RequireKBRole(min)` is the only route gate. It answers 404 for a missing KB and 403
  for a hidden one.
- `RequireOperableKB` / `RequireKBRoleOrOperable` admit system admins on `kbAdvancedChain` and
  `kbAgentListChain` only.
- `internal/files`, `internal/openaicompat` and `internal/academic` call `EffectiveRole` directly
  for their handler-internal second check.

**SQL mirror**

- `kbaccess.VisibleKBsCTE` (`internal/kbaccess/visible_sql.go`) is the only SQL copy of the
  ladder, used where a query filters many KBs per row (`internal/globalsearch`).
- Change it in the same commit as `EffectiveRole`.
- Parity test: `TestVisibilityAgreesWithEffectiveRole` (`internal/globalsearch`, integration).
- No feature package writes its own SQL copy.

**Advanced surface** (`kbAdvancedChain`: RAG settings, agents and teams (deprecated, API only), evals,
workflow, per-KB re-embed)

- The system role `admin` / `superadmin` is the whole permission; no KB role is needed and no KB
  role opens it to anyone else (an api-user included).
- Applies to global KBs, shared KBs and the admin's own KBs (`kbaccess.SystemAdminMayOperate`).
  - Shared = a `kb_members` row besides the owner's (`kbaccess.SharedSQL`, the one expression
    both the access lookup and the admin KB overview select).
  - Own = the raw `kb_members` row is `owner`, not the effective role.
- Somebody else's private, unshared KB stays closed to everyone, superadmin included.
- Entry point: „RAG-Settings" in the admin console's KB-Übersicht.
- `GET /api/kb/{id}/agents` (`kbAgentListChain`, deprecated with agents and teams, no web caller)
  opens to system admins on the same KBs.
- Basic settings of one's own KB sit on `kbAdminChain` and are open to a plain user.

## Source permissions

Migration 0089. On top of the ladder, never inside it.

`kbaccess.CapabilitiesFor(kb, role)` turns the resolved role and the KB's seven flags into
`Capabilities{seeSources, addSources, downloadSources, seeCitations, manageSources}`.

**Flags:** `viewer_` and `editor_` × `see_sources`, `download_sources`, `see_citations`, plus
`editor_add_sources` (default true). There is no viewer add flag. Written via `PATCH /api/kb/{id}`
(`kbAdminChain`).

**Rules**

| Capability | Granted when |
|---|---|
| Chat with the sources, restrict a turn to chosen files (`selectedFileIds` / `fileIds`) | KB access; not a permission |
| `seeSources` | The role's `see_sources` flag |
| `seeCitations` | The role's `see_citations` flag; independent of `seeSources` |
| `downloadSources` | The role's `download_sources` flag AND `seeSources` |
| `addSources` | `edit` AND `editor_add_sources` AND `seeSources`; never `view` |
| `manageSources` (change, sync, poll, delete, retry) | `edit` AND `seeSources`; no flag; never `view` |

- `admin` and `owner` get everything (incl. superadmin, and a system admin on a public KB).
- An editor without `editor_see_sources` can do nothing with sources.
- The `api-user` system role has no rung of its own: it governs only use of the outgoing API
  (API-key management). An explicit `kb_members` row counts as for anyone.

**Where it is applied** (`CapabilitiesFor` is the only reader of the flags)

- `kbaccess.RequireKBCapability` on the route chains `kbSourceListChain`,
  `kbSourceDownloadChain`, `kbAddSourcesChain`, `kbManageSourcesChain` (the last two gated at
  `edit`) in `routes.go`.
- Handler-internal checks in `internal/files` (download, delete, retry by file id) and
  `internal/academic` (`papers/add`, KB in the body).
- The agent chat's KB-writing actions: `adkbridge.Scope.Capabilities`, policy
  `RequiresCapability: addSources` on `library_add_to_kb` / `confluence_import`.
- The `capabilities` object on the KB list and detail rows (`internal/kb`) and on
  `GET /api/v1/kb` (`internal/publicapi`, resolved for the key's owner).
- The header search's file hits.

**SQL mirror:** `kbaccess.SeeSourcesSQL` (`visible_sql.go`, over a `VisibleKBsCTE` row) is the
only SQL copy of the `seeSources` rule; the CTE passes `viewer_see_sources` and
`editor_see_sources` through. Change it in the same commit as `CapabilitiesFor`.
`TestVisibilityAgreesWithEffectiveRole` checks it against `CapabilitiesFor` + `EffectiveRole` over
a matrix in which the two columns always disagree, so reading the wrong role's column fails.

**`seeCitations`** is enforced on output only (`internal/chat/citation_visibility.go`). Sources,
conflicts, verification and `[n]` markers are always stored in full and stripped per response:

| Surface | Mechanism |
|---|---|
| Web SSE / JSON | `CitationFilter` on the request context, applied by `writeSSE` to every frame |
| `GET /api/chats/{id}/messages` | `RedactMessagesForReader` (capability via `kbaccess.ResolveCapabilities`; the route is not KB-scoped) |
| Agent chat | `agui.Config.NewEventFilter` |
| `internal/publicapi`, `internal/mcpserver`, `internal/openaicompat` | Resolved for the API key's owner |
| Research, generated content, `/owui` | Not covered (API.md § Citations) |

## Invite links

`kb_invite_links` (migration 0067), `internal/kbinvites`.

- A KB admin mints permanent, revocable links that grant `view`, `edit` or `admin`.
- Resolve: `GET /api/invites/{token}` (no writes) → `status` `invite` | `member` | `revoked`.
  `kbinvites.decide` is the one place that derives it, through `kbaccess.EffectiveRole`.
- Redeem: `POST /api/invites/{token}/redeem`. Both token routes are authentication-only and
  rate-limited (the caller has no KB role yet). The web app redeems only after the person
  accepts in the join modal.
- A link never changes an existing membership, up or down; role changes go through the members
  panel. Someone with a `kb_members` row, or with implicit access at least as strong as the
  link's role (a system admin on a public KB), is `member`: redeeming writes nothing.
- It deletes an `opted_out` `kb_subscriptions` row in the same transaction, so the KB shows in
  the joiner's overview.
- Revoking sets `revoked_at` (migration 0106) and stops future joins; existing members stay.
  The row is kept so a link placed on a website keeps resolving to its KB; revoked links leave
  the admin list. Links revoked before 0106 were deleted.
- Tracking: `redemption_count` = distinct people who joined through the link (one
  `kb_invite_link_redemptions` row per link and person, since migration 0087; earlier counts
  were kept). `last_used_at` is the last join.
- Frontend: the invite-links tab of the Mitglieder section in Thema-Einstellungen
  (`KbMembersPanel`); entry route `/join/<token>`, parked in `sessionStorage` across the SSO round
  trip (`web/src/hooks/useJoinLink.ts`), then the join modal reads the resolve endpoint.

## Visibility and publishing

`internal/kbvisibility`, `internal/kbsubs`, `internal/kbcategories`.

- `knowledge_bases.visibility` (`private` | `public`) is the truth.
- `is_global` is a stored generated column (`visibility = 'public'`). No Go code reads it.
- A public KB has no owner.

**Publish** (`POST /api/admin/kb/{id}/publish`, system admin; offered per row in the admin
KB-Übersicht)

- Demotes the owner's `kb_members` row to `admin` and NULLs `knowledge_bases.user_id` by hand
  (the owner trigger does not fire on a demotion).
- Forces `is_published = false`: the KB is public but staged.
- A staged KB is visible to its `kb_members` and to system admins only, until an operator flips
  the catalog toggle in the global-KB admin tab.
- `is_published` defaults to true (migration 0012), hence the explicit write.

**Unpublish**

- Requires an explicit new owner.
- Deletes every `kb_subscriptions` row for the KB. Chats are kept.

**Overview visibility of a public KB**

Visible when there is no `opted_out` row AND one of:

- a `kb_members` row (regardless of `is_published`), or
- `is_published = true` AND (`kb_subscriptions.state = 'subscribed'` OR `auto_subscribe`).

Details:

- This is a list rule, not a route-access rule (`ListGlobalKnowledgeBases`).
- The opt-out beats every arm, membership included.
- `auto_subscribe` defaults to false. The 0065 backfill set it only for KBs that were global and
  published before.
- The overview is subscription-filtered for system admins too:
  `kb.Handler.ListGlobalKnowledgeBases` always passes `isAdmin=false`. The store's `isAdmin` arm
  (every public KB, staged or not, regardless of subscription) stays in use by
  `internal/openaicompat` for system admins.
- `adminglobalkbs.CreateGlobalKB` enrols the creating admin as a `kb_members` `admin` row in the
  same transaction (`GlobalKBCreate.CreatedBy`).

**Removing a public KB from the overview**

- The star on a card is a favorites toggle (`/favorite`). Removing is a separate action:
  `useKbRemoval` routes every public KB to `DELETE /api/kb/{id}/subscription`, which drops no
  membership and no chats.
- `PUT` / `DELETE …/subscription` sit on `kbViewChain` and accept a staged public KB; a member
  or a system admin reaches the route for one.
- `kbmembers.LeaveKB` (a member removes the KB) drops the membership and the caller's chats and
  writes an `opted_out` subscription row, in one transaction. Without the `opted_out` row,
  `auto_subscribe` would bring the tile back.

**Catalog** (`GET /api/kb/catalog`)

- Lists published public KBs plus staged ones the caller is a member of.
- Filter tabs: `kb_categories` / `kb_category_links`, single-select with a leftmost "Alle", read
  through the authentication-only `GET /api/kb-categories` (the `/api/admin/` twin is
  admin-only).
- System admins curate the category list; any KB admin assigns their own KB.
- Search spans `name`, `description` and `header_text`; the card shows `description`, or
  `header_text` when the description is NULL or empty.

## Per-user topic filters

Migration 0086, `internal/kbfilters`: favorites and per-user categories. Personal state, never an
access grant. The web app's chip row filters by favorite and by the topic's platform category
(`web/src/hooks/useTopicFilters.ts`).

**Tables**

| Table | Holds |
|---|---|
| `kb_favorites` | A row is the star. There is no `is_favorite = false`. |
| `kb_user_categories` | Unique on `(user_id, LOWER(name))`. At most `kbfilters.MaxCategoriesPerUser` = 50 per user, checked in the INSERT → 409. |
| `kb_user_category_links` | Composite FK `(category_id, user_id) REFERENCES kb_user_categories (id, user_id)`; a violation (23503) maps to 404. |
| `kb_user_order` (migration 0103) | Drag order of the views `my` and `shared`, one `uuid[]` per user and view, rewritten whole on every save. |

- A favorite is not a subscription: subscribing decides whether a public topic is in the overview
  at all; the star pins any visible topic to "Favoriten".
- Separate from `kb_categories` / `kb_category_links`, which are the admin-curated taxonomy over
  public KBs.

**Routes**

| Route | Gate |
|---|---|
| `PUT` / `DELETE /api/kb/{id}/favorite` | `kbViewChain` |
| `PUT` / `DELETE /api/kb/{id}/user-categories/{catId}` | `kbViewChain` |
| CRUD `/api/kb-user-categories[/{catId}]` | Authentication only |
| `GET /api/kb-user-order`, `PUT /api/kb-user-order/{view}` | Authentication only |

**Payload**

- `isFavorite` and `userCategoryIds` (`kb.KBRow.UserFilters`, both keys absent when nil) ride
  along on the session-facing reads: `GET /api/kb`, `/api/kb/global`, `/api/kb/{id}`,
  `PATCH /api/kb/{id}` (re-read through `GetKnowledgeBase`), `/api/kb/catalog`. The chip row
  filters that one payload client-side.
- The API-key listings (`GET /api/v1/kb`, `/openai/v1/models`, the KB router) call the plain
  `ListKnowledgeBases` / `ListGlobalKnowledgeBases`, which skip the per-user subqueries and leave
  both keys out.

**Cleanup**

- Leaving a KB or being removed (`kbmembers.LeaveKB` / `RemoveMember`) drops that user's star and
  category links in the same transaction (`kbfilters.ForgetKB`), but only if they can no longer
  see the KB (`kbaccess.EffectiveRole(kb, sysRole, "")` after the membership row is gone). A
  published public KB keeps its star. The user's categories stay.
- `kb_user_order` ids carry no FK and are not checked against access; the views only sort the
  topics they list. `ForgetKB` and a KB delete
  leave them; the user's next save drops them. A user delete removes the rows
  (`internal/cascade`).

## Overview UI

| View | URL | Shows |
|---|---|---|
| `MyTopicsView` | `/` | Topics the user owns |
| `SharedTopicsView` | `/shared` | Private shares plus the public topics `GET /api/kb/global` returns for the user |
| `DiscoverView` | `/discover` | The catalog (`KbCatalogPanel`) of public topics |

- `AuthenticatedApp` refetches the topic lists whenever one of the three views opens.
- The catalog folds after 8 cards with a "show more" button (client-side).
- `GET /api/kb/{id}` (`kbViewChain`) serves the catalog: a public KB that is not in the user's
  overview is absent from `GET /api/kb/global`, so opening one fetches the full row. Access is
  decided by `RequireKBRole(view)` alone.
