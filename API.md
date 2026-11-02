# API Reference

This document reflects the current Go backend API surface in `go-backend/internal/app/routes.go`.
`TestAPIDocListsEveryRoute` (`go-backend/internal/app/api_doc_drift_test.go`) fails CI when a registered
route has no table row here, or a row names a route that no longer exists.

## API Surfaces

### Web/session API

- Base path: `/api`
- Authentication: JWT bearer token
- Used by the React frontend

### Public API

- Base path: `/api/v1`
- Authentication: API key bearer token

### OpenAI-compatible API

- Base path: `/openai/v1`
- Authentication: API key bearer token

### Open WebUI-compatible API (ILIAS)

- Base path: `/owui`
- Authentication: API key bearer token
- Gated by the global `owui_compat_enabled` flag (default off)

## Docs and Service Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/ready` | Readiness |
| GET | `/version` | Build metadata |
| GET | `/metrics` | Admin-only Prometheus endpoint |
| GET | `/api/v1/openapi.json` | Embedded OpenAPI spec |
| GET | `/api/v1/docs` | Scalar API reference |
| GET | `/uploads/logo/` | Uploaded site logo file (`/uploads/logo/<file>`), public |

## Web/Session API

All routes below are under `/api`.

Where a table has an **Access** column, its values mean:

- **public** — no authentication.
- **authenticated** — any signed-in user; ownership, if any, is checked in the handler.
- **KB view / edit / admin / owner** — the caller's effective KB role on `{id}` (`view < edit < admin < owner`, see "KB members and ownership").
- **KB advanced** — KB role `admin` **and** a system role of `api-user`, `admin` or `superadmin` (the KB settings panel's RAG settings, agents and teams, evals and workflow).
- **system admin** / **superadmin** — the user's system role (`admin` or `superadmin` / `superadmin` only).

`docs/api-contracts/` holds the full request/response contracts for the larger features (agent chat, user file library, early-open SSE, Open WebUI).

### Error codes

An error body is `{"error": "<message>"}`. The message is English text for logs and API clients; a
UI shows its own localized message instead. The web client's messages — every error case with its
German and English text — are listed in [`docs/user-error-messages.md`](docs/user-error-messages.md). Where the user can act on the cause, the body (or the
SSE `{"error"}` frame) also carries a stable `code`. Clients map the code, never the message:

| `code` | Status | Meaning |
|---|---|---|
| `file_too_large` | `413` | The file exceeds an upload size limit; `limitBytes` names the limit |
| `quota_exceeded` | `413` | The user's file library quota is full (also in `error`, see "User file library") |
| `kb_full` | `400` | The KB has reached its file count or total size limit |
| `unsupported_file_type` | `415`, `400` on upload | No parser handles the file's format (or the extension is blocked) |
| `file_unreadable` | `422` | The format is supported but the file could not be read (corrupt file, missing OCR) |
| `no_text` | `422`, `400` in library chat | The file contains no text |
| `parse_timeout` | `422` | Reading the file took longer than the server allows |
| `too_large_for_context` | `422`, `400` in library chat | The documents do not fit the answer model's budget (also in `error`) |
| `already_in_kb` | `409` | The KB already holds this file (also in `error`) |
| `empty_file` | `400` | The uploaded file has zero bytes |
| `file_name_too_long` | `400` | The file name exceeds 255 bytes |
| `invalid_upload` | `400` | The request is not a well-formed file upload |

The upload routes (`POST /kb/{id}/files`, `/library/files`, `/kb/{id}/chat/attachments`,
`/kb/{id}/chat/attachment`), the attachment checks of `POST /kb/{id}/chat` and library chat carry
these codes. An error without `code` is one the user cannot fix by changing the file (permissions,
rate limits, server errors); map it by status.

### Authentication

| Method | Path |
|---|---|
| POST | `/auth/login` |
| POST | `/auth/logout` |
| POST | `/auth/refresh` |
| GET | `/auth/providers` |
| GET | `/auth/oidc/login` |
| GET | `/auth/oidc/callback` |
| GET | `/auth/oidc/logout` |
| POST | `/auth/oidc/logout` |

- `GET /auth/providers` is public and lists the enabled login providers for the login page, without their secrets.
- `GET /auth/oidc/login` → IdP → `GET /auth/oidc/callback` is the browser redirect flow for OIDC login.
- `GET /auth/oidc/logout` is the browser's RP-initiated logout: it revokes the JWT if one is sent and redirects to the IdP's end-session endpoint.
- `POST /auth/oidc/logout` is the IdP's back-channel logout (called server-to-server with a `logout_token`, never by the frontend).

### Users, site config, API keys

| Method | Path |
|---|---|
| GET | `/users/{id}` |
| PATCH | `/users/{id}` |
| GET | `/public/configs` |
| GET | `/site-config` |
| POST | `/site-config` |
| POST | `/site-config/logo` |
| POST | `/api-keys` |
| GET | `/api-keys` |
| DELETE | `/api-keys/{id}` |

### Long-term memory ("Mein Gedächtnis")

The caller's own long-term memory entries. Available whether or not `chat_longmem_enabled` is on, so a user can always see, export and erase what was stored.

| Method | Path | Access |
|---|---|---|
| GET | `/user/memory` | authenticated |
| GET | `/user/memory/export` | authenticated |
| DELETE | `/user/memory/{id}` | authenticated |
| DELETE | `/user/memory` | authenticated (deletes all) |

### Knowledge bases

| Method | Path |
|---|---|
| GET | `/kb` |
| GET | `/kb/global` |
| POST | `/kb` |
| GET | `/kb/{id}` |
| PATCH | `/kb/{id}` |
| DELETE | `/kb/{id}` |
| GET | `/kb/{id}/files` |

`GET /kb` is paged with `?limit=` (default 50, maximum 100 — larger values are
clamped to 100, non-positive or non-numeric ones fall back to 50) and
`?offset=` (default 0). It lists the caller's private KBs; global KBs come from
`GET /kb/global`.

Card fields on the KB rows of `GET /kb`, `GET /kb/global` and `GET /kb/{id}`:

- `oldestFileAt` — the earliest effective file date
  (`MIN(COALESCE(published_at, created_at))`); omitted for a KB without files.
- `lastIngestedAt` — when content was last successfully ingested: the latest
  ingest time of a `completed` or `partial` file. This is ingest time, not the
  document's own date, and failed, pending or still-processing files do not
  count. A retry or re-embed of an existing file moves it; omitted while no
  file has been ingested.
- `category` — the catalog category the topic's title card shows,
  `{id, name, sortOrder, colorSlot, color}` (the first of its categories by the
  taxonomy's order); omitted when it has none.
- `colors` — the start page's gradient `{from, to}` for the card's cover band:
  the default colours while the KB has no start page, omitted when it chose
  none.

`PATCH /kb/{id}` returns the KB in the same caller-aware shape as
`GET /kb/{id}` (card fields, `myRole`, `capabilities`, and the per-user filter
fields below), so a client can replace its copy with the response.

#### Source permissions

Per KB, its admins decide what viewers and editors may do with the KB's
sources (migration 0089). Seven boolean fields on every KB row, writable
through `PATCH /kb/{id}` (KB admin — the same gate as `systemPrompt`; a JSON
`null` leaves a field unchanged). The `viewer*` fields apply to the `view`
role, the `editor*` fields to the `edit` role; the other role's fields never
apply. There is no `viewerAddSources`: a viewer who could add (or delete)
sources would be an editor, so viewers never do either.

The rights form a pyramid. A right on a higher level is only granted together
with the level-1 right it rests on:

| Level | Right | Needs |
|---|---|---|
| 0 | Use the KB's sources in a chat answer; restrict a chat or research turn to chosen files (`selectedFileIds`, `fileIds`) | KB access only — not a permission |
| 1 | `seeSources` — the source lists | its flag |
| 1 | `seeCitations` — an answer's citations | its flag (independent of `seeSources`) |
| 2 | `downloadSources` — download and preview a source | its flag **and** `seeSources` |
| 2 | `addSources` — add sources ("Hinzufügen") | role `edit` **and** `editorAddSources` **and** `seeSources`; never `view` |
| 2 | `manageSources` — change, sync, poll, delete, retry sources ("Bearbeiten") | role `edit` (no flag) **and** `seeSources`; never `view` |

The seven fields:

| Fields | Defaults (viewer / editor) | Off means (for that role) |
|---|---|---|
| `viewerSeeSources`, `editorSeeSources` | `false` / `true` | 403 on the source lists: `GET /kb/{id}/files`, `GET /kb/{id}/rss`, `GET /kb/{id}/confluence-sources`, `GET /kb/{id}/git-repos`, `GET /kb/{id}/crawl/status/{jobId}`; no file hits from that KB in the header search (`GET /search`). By the pyramid also no `downloadSources`, `addSources` or `manageSources`, whatever their flags say. |
| `editorAddSources` (editors only) | `true` | 403 on every route that creates a source: `POST /kb/{id}/files`, `/files/from-library`, `/text`, `/add-sources` (also where the web search's "add to KB" lands), `/fetch-url`, `/crawl`, `/rss`, `/confluence-sources`, `/git-repos`, and `POST /academic-research/{researchId}/papers/add`; the agent chat (`POST /kb/{id}/agui/chat`) does not offer or execute its KB-writing dead-end actions (`library`, `upload`, `confluence`). Refused before anything is fetched, stored or written. A viewer gets the same 403 whatever the flags say. |
| `viewerDownloadSources`, `editorDownloadSources` | `false` / `true` | 403 on `GET /files/{id}/download` (also the in-app PDF preview) and on the spreadsheet source preview, `GET /kb/{id}/files/{fileId}/tabular` and `GET /kb/{id}/files/{fileId}/tabular/rows` |
| `viewerSeeCitations`, `editorSeeCitations` | `false` / `true` | answers carry no source attribution on any chat surface — see [Citations](#citations) below; nothing is refused |

Editing sources (`manageSources`) has no flag: `PATCH`/`DELETE` and
`…/sync`/`…/poll` on RSS feeds, Confluence sources and git repositories,
`DELETE /files/{id}`, `POST /files/{id}/retry` and
`POST /kb/{id}/files/retry-failed`. The `edit` role and above have it (an
editor only while `editorSeeSources` is on), `view` never does. An editor
without `editorSeeSources` can do nothing with sources: no list, download,
add or edit.

Selecting files for a chat or research turn is not gated by any of this: the
UI offers it where the user sees the source list, and the API accepts a
selection from every caller with KB view access.

The defaults apply to existing KBs too: after the upgrade, viewers of a
published global KB lose the source list, downloads and citations until a KB
admin turns them back on; editors keep everything.

Always granted, whatever the flags say: every capability for the KB owner, a
KB admin (`kb_members` role `admin`), a superadmin, and a system admin on a
global KB. The `api-user` system role only governs use of the outgoing API and
grants no KB rights of its own: on a published global KB it is an implicit
viewer like any other user, and an explicit `kb_members` role (admin
included) counts for it as for anyone else. Tables in chat answers (AI-written
markdown tables and their xlsx download) are answer content, not sources, and
are never gated.

`GET /kb`, `GET /kb/global`, `GET /kb/{id}`, `PATCH /kb/{id}` and `POST /kb`
return the caller's resolved permissions on each KB, with the pyramid already
applied, so a client never re-derives the role ladder (an implicit viewer's
`myRole` is `null`):

```json
"capabilities": {
  "seeSources": true,
  "addSources": false,
  "downloadSources": false,
  "seeCitations": true,
  "manageSources": false
}
```

#### Citations

A caller without `seeCitations` on a KB gets that KB's answers **without
source attribution**. Nothing is refused and the answer itself is generated
exactly as for everyone else (same retrieval, same prompt); only what leaves
the server changes. The capability is resolved per request for the current
reader — for an API key, the key owner's role on the KB.

**Stored in full, stripped on the way out.** `messages.sources`,
`messages.conflicts`, `messages.verification` and the answer text with its
`[n]` markers are always written complete, whoever asked. Reads strip them
for the current reader, so when a KB admin turns `viewerSeeCitations` on,
the existing history shows its citations again, and turning it off hides
them on the next read.

**The reader's own chat attachments stay.** A source with a `userFileId` is a
file the reader attached to the chat themselves (§ Chat, chat attachments),
not a KB source: it stays in `sources`, its `[n]` markers stay (a marker citing
KB sources too keeps only the attachment numbers, `[1, 5]` → `[5]`), and its
`verification.citations` entries stay. Everything below applies to the KB
sources only.

What is withheld, per surface:

| Surface | Without `seeCitations` |
|---|---|
| `POST /kb/{id}/chat`, SSE | the opening frame keeps `chatId`/`userMessageId`/`enhancedQuery` but has `"sources": []`; no `conflicts` frame; `verification` without `citations`, without `cited_n` on flagged claims and with `self_rag.isrel` empty; `agentTrajectory` frames without `chunks` (file names); the answer-tool trace frames without `args` and `preview`; a corpus table without its `_file_id`/`_file_name`/`_source_idx` row keys and file-name-derived columns; comparison findings without `citedFileIds`/`citedQuote`; `[n]` markers removed from `content`, `reasoning`, `refined_text` and follow-up questions (a marker split across two `content` frames is held back until it is complete) |
| `POST /kb/{id}/chat`, JSON | the same keys of the response body (`answer` without markers, `"sources": []`, no `conflicts`, `verification` as above) |
| `GET /chats/{id}/messages` | per AI message: `"sources": []` (a stored `null` stays `null`), no `conflicts`, `verification` and `structured_table` as above, markers removed from `content` and `reasoning`; user messages unchanged. A library chat (no KB) is never stripped. |
| `POST /kb/{id}/agui/chat` | `justrag.sources.v1` with an empty list; `justrag.tool_chunks.v1` with `chunks: []`; every `TOOL_CALL_RESULT` with content `{}`; markers removed from `TEXT_MESSAGE_CONTENT` / `REASONING_MESSAGE_CONTENT` deltas (see [`docs/api-contracts/agent-chat.md`](docs/api-contracts/agent-chat.md)) |
| `POST /api/v1/kb/{id}/chat`, `GET /api/v1/kb/{id}/chats/{chatId}/messages` | as the web chat and `GET /chats/{id}/messages` |
| `POST /api/v1/kb/{id}/mcp` (`ask_kb`) | `structuredContent.sources` is `[]`; markers removed from the answer text |
| `POST /openai/v1/chat/completions` | no `context.citations`, no `annotations`, markers removed from the content (streaming and not) |

Always visible: KB owner, KB admin, superadmin, system admin on a public KB
(they always hold `seeCitations`). Not covered: the research endpoints
(`/kb/{id}/research`, `/api/v1/kb/{id}/research`, research reports) and the
generated-content (`generate/*`) routes, which still name their sources, and
the Open WebUI surface (`/owui`), whose collections belong to the key's own
service user. The model may still name a document in the prose of its
answer; only markers are removed, prose is not rewritten.

`GET /api/v1/kb` (API key) carries the same `capabilities` object, resolved
for the key's owner; the public API has no single-KB read route.
`capabilities` is absent on `GET /openai/v1/models`. The header search
(`GET /search`) returns file hits only from topics where the caller holds
`seeSources`. A refused request is `403 {"error": …}`.

### Catalog, subscriptions and categories

Discovery and subscription of public KBs. A subscription decides whether a public KB appears in the caller's overview; the system-admin-curated categories are the catalog's filter tabs (the caller's own chips are the per-user topic filters below).

| Method | Path | Access |
|---|---|---|
| GET | `/kb/catalog` | authenticated |
| PUT | `/kb/{id}/subscription` | KB view |
| DELETE | `/kb/{id}/subscription` | KB view |
| GET | `/kb-categories` | authenticated |
| GET | `/kb/{id}/categories` | KB view |
| PUT | `/kb/{id}/categories` | KB admin |

- `GET /kb/catalog` lists published public KBs plus staged public KBs the caller is a member of. Each entry carries what the „Entdecken" card shows: `colors` (the start page's `{from, to}`, the default ones while the KB has no start page, `null` when it chose none), `fileCount`, and `lastIngestedAt` (omitted before the first successful ingest).
- `DELETE /kb/{id}/subscription` is the "remove from Favoriten" star: it writes an opt-out and keeps memberships and chats.
- Category CRUD is under Admin (`/admin/kb-categories`). A category carries `colorSlot` (1–9, the palette slot `--color-category-N`): `POST`/`PATCH` take an optional `colorSlot` (`400` outside 1–9); without one, create picks the least-used slot and update keeps the colour. A category may also carry `color`, a freely picked `#rrggbb` (any case accepted, stored and returned lowercase; `400` otherwise): `POST`/`PATCH` take it optionally, update keeps it when absent and `""` clears it. Clients draw `color` when set, the slot otherwise.
- `PUT /kb/{id}/categories` takes at most **one** id (`400` otherwise; `[]` clears it), for private and public KBs alike. Older rows with several categories stay readable until the KB is saved again.

### KB settings and workflow

| Method | Path | Access |
|---|---|---|
| GET | `/kb/{id}/settings` | KB advanced |
| PUT | `/kb/{id}/settings` | KB advanced |
| DELETE | `/kb/{id}/settings/{key}` | KB advanced |
| POST | `/kb/{id}/reembed` | KB advanced |
| GET | `/workflow/presets` | authenticated |
| GET | `/kb/{id}/workflow` | KB advanced |
| GET | `/kb/{id}/workflow/preset` | KB advanced |
| POST | `/kb/{id}/workflow/preset` | KB advanced |

- `/settings` are the per-KB overrides of the `site_config` registry; `DELETE /settings/{key}` falls back to the global value.
- `POST /reembed` queues a full re-ingest of the KB; the panel offers it after saving a key marked `requiresReingest`.
- `GET /workflow/preset` previews which settings a preset would overwrite; `POST` applies it. `GET /workflow/presets` is the deployment-wide preset catalogue.

### Behavior: roles and rules

| Method | Path | Access |
|---|---|---|
| GET | `/kb-behavior/catalog` | authenticated |
| GET | `/kb/{id}/behavior` | KB view |
| PUT | `/kb/{id}/behavior` | KB admin |
| DELETE | `/kb/{id}/behavior` | KB admin |
| POST | `/kb/{id}/behavior/role-writer/generate` | KB admin |
| POST | `/kb/{id}/behavior/role-writer/revise` | KB admin |
| POST | `/kb/{id}/behavior/role-writer/describe` | KB admin |

A KB answers in a **role** (a prompt) with a set of **rules** (one sentence each) appended under
"Regeln:"; the fixed RAG instructions (`GET /chat/rag-system-prompt`) follow after them, as they
followed the free system prompt. Every answer surface reads this one compiled prompt.

- `GET /kb-behavior/catalog?lang=de|en` (anything else reads `de`) is the central catalog, the
  same for every KB: `{language, roles: [{id, name, description, prompt, icon, isDefault, enabled,
  cover: {from, to}}], ruleGroups: [{id, title, rules: [{id, label, description, text,
  defaultOn}]}], rulesHeading, limits: {promptMax, roleNameMax, ruleMax,
  customRolesMax, customRulesMax}}`. The rules are versioned with the release; the roles are
  curated by system admins (`/admin/role-templates`) — `enabled: false` ones are listed for the KBs
  that still use them, not to be offered for new picks; `cover` is the gradient of the role's card
  on a start page. Both are read-only for a KB, which references them
  by `id`, so a corrected template reaches every KB that uses it. Read it in the KB's `language` (below) for a
  preview that matches the compiled prompt.
- `GET /kb/{id}/behavior` → `{behavior, customized, language}`. `behavior` is `{version: 1,
  activeRoleId, customRoles: [{id, name, description, prompt, icon}], roleRules: {roleId: {rules:
  {ruleId: bool}, customRules: [{id, text, on}]}}}`; `activeRoleId` names a template or one of
  `customRoles`. Every role has its own rules. A template's are the system preset — the catalog's
  default rules — and fixed (changed only as an own copy). `roleRules` holds the set of each own role
  someone set rules for (a rule missing from its `rules` is off); an own role without a set answers
  with the catalog's default rules, the `legacy` role with none. Sets of roles the KB no longer has
  are left out. `language` (`de`|`en`, from the KB's `language`) is the language
  template texts are compiled in.
- A KB that was never customized (`customized: false`) answers exactly as before from its
  `systemPrompt`, shown as the own role `id: "legacy"` ("Bisheriger Prompt", active, no rule on, no `roleRules`; without
  a prompt it carries the KB's name and "Durchsucht die bereitgestellten Quellen.").
  That role's prompt is stored in `systemPrompt` also after customizing, so `PATCH /kb/{id}` and
  `PATCH /admin/global-kbs/{id}` with `systemPrompt` keep editing it. On a customized KB, a
  `systemPrompt` that differs from the stored one also makes `legacy` the active role (adding the
  role if the KB has none), so the prompt written is the one the KB answers with; the same prompt
  sent again leaves the active role alone. Its icon is fixed; a `name` and `description` sent for it are kept
  as the author's own, empty means the default above (a default sent back unchanged is not
  stored, so the role keeps following the KB's name and language). A new KB created
  without a `systemPrompt` starts customized: role `research` with the catalog's default rules.
- `PUT /kb/{id}/behavior` replaces the whole behavior with the body (the `behavior` shape) and
  answers like `GET`. `400` with the reason for: `version` ≠ 1, an unknown field, an
  `activeRoleId` that does not exist, a custom role id that is not `[A-Za-z0-9_-]{1,64}`, taken
  by a template or used twice, a role without a name (except `legacy`) or prompt, a name over 80,
  a description over 200 or a prompt over 8000 characters, an unknown `icon` or rule id, rules for a
  template or for a role that does not exist, more than 20 custom roles or 20 custom rules per role, an empty custom rule or one over 300 characters. Lengths count
  characters, not bytes.
- **Role writer** (the role edit screen's AI help, KB admins, `generate` rate limit, one LLM call
  on the fast-tier model, nothing stored): `POST /kb/{id}/behavior/role-writer/generate` with
  `{description, topic?, language}` → `{name, prompt}` writes a role from a description (`topic`:
  the KB's name, as context, at most 255 characters); `POST /kb/{id}/behavior/role-writer/revise` with `{prompt,
  instruction, language}` → `{prompt}` revises a role prompt by an instruction: the model returns
  edits to passages of the prompt, so text the instruction does not touch is kept verbatim. `400`
  for an empty or over-500-character description or instruction, or an empty or over-8000-character
  prompt; `502` when the model fails or an edit matches no passage. `POST
  /kb/{id}/behavior/role-writer/describe` with `{name?, prompt, language}` → `{description}` writes
  the role's one-sentence description (plain text, at most 200 characters) from its name and
  prompt; `400` for an empty prompt, `502` when the model fails.
- `DELETE /kb/{id}/behavior` is the settings' "Löschen": no role and no rule (`behavior` and
  `systemPrompt` cleared), as deleting the system prompt was. It writes a version in the
  assistant settings' history like a save, so the state before it can be restored. Answers like `GET`.
- **A chat in a role.** `POST /kb/{id}/chat` with `roleId` (a template id or an id from
  `customRoles`) starts a NEW chat in that role instead of the active one; the role is stored on
  the chat and every later turn answers in it. It is refused with `400` before any chat or usage
  row when the body also names a `chatId` (`roleId is only accepted when a chat starts`) or the KB
  has no such role (`unknown roleId`). A role chat is never re-routed by `?route=auto`. The chat
  carries `roleId` in `GET /kb/{id}/chats`, and branches keep it. When the role is deleted later,
  the chat answers in the KB's active role. Only the web chat starts role chats; the public API,
  OpenAI-compat, `/owui`, MCP and the agent chat answer in the active role.

### Start page

| Method | Path | Access |
|---|---|---|
| GET | `/kb/{id}/start-page` | KB view |
| PUT | `/kb/{id}/start-page` | KB admin |

What a KB's start page shows with its name, description and category (those are `PATCH /kb/{id}`
`name`/`description` and `PUT /kb/{id}/categories`; the settings dialog saves all of them with
`PUT /kb/{id}/assistant-settings`, below).

- `GET` → `{startPage, configured}`. `startPage` is `{version: 1, colors, startMode, questionsOn,
  questionMode, dynamicCount, fixedQuestions, uploadLabel, uploadInstruction,
  roleStarts, roleEntries}`; `configured: false` is the default (colors `#0056B3` → `#3897E8`, input field,
  questions off, dynamic 4).
  - `colors`: `{from, to}` as `#RRGGBB` (stored upper case) — the gradient of the start page's
    glow and of the „Entdecken" card's band; `null` shows no colour.
  - `startMode`: `input` (input field, with starter questions when `questionsOn`), `upload` (the
    chat starts with a file, uploaded as an ordinary chat attachment via
    `POST /kb/{id}/chat/attachments`; `uploadInstruction` — or the client's fixed default text when
    empty — is sent with it as the first message) or `roles` (only role cards). A file start takes
    whatever a chat attachment takes; there is no per-page list of file types.
  - **Starter questions:** `questionMode: "dynamic"` is `GET /kb/{id}/starter-questions` (with
    the chat's `roleId`) cut to `dynamicCount` (3|4|6); `fixed` shows `fixedQuestions`.
  - **Role starts** (`roleStarts: {roleId: start}`): how a role starts its chat — set up per
    role in „Verhalten"; every role starts with the input field until one is set. A start is `{kind: "input"|"task"|"file", text, send, instruction, suggestions}`: `input`
    opens the input field; `task` sends `text` at once (`send: true`) or only fills the input
    field; `file` shows an upload with label `text` and sends `instruction` with the file.
    `suggestions` is `{questionsOn, questionMode, dynamicCount, fixedQuestions}` — the starter
    questions under the input field of the chat an `input` card opens, with the page's own rules
    (dynamic = the KB's generated questions). At most 40.
  - **Role cards** (`startMode: "roles"`): the KB's active role's card comes first, always;
    `roleEntries: [{id, roleId}]` are up to 3 further cards, each
    starting a chat in `roleId` (`POST /kb/{id}/chat` with `roleId`, see "Behavior: roles and
    rules") as `roleStarts[roleId]` says. The roles start needs at least one further card: with the
    active role alone the input field starts the same chat, and a page whose last further card is
    gone answers with `startMode: "input"`. Every role shows once: no card of the active role, no
    second card of a role. Starts and cards whose role the KB no longer has, and repeated cards of
    a page stored before, are left out of the response.
  - The settings of every mode are kept when `startMode` changes.
- `PUT` replaces the start page and answers like `GET`. Texts are trimmed, empty fixed questions
  dropped. `400` with the reason for: `version` ≠ 1, an unknown field, a colour that is not `#RRGGBB`, mode, count, entry
  kind, more than 3 role cards or 6 fixed questions, a question or card text over 120, a label over
  80 or an instruction over 300 characters, a card id that is not `[A-Za-z0-9_-]{1,64}` or used
  twice, a role the KB does not have, a card of the active role or a second card of a role, or
  more than 40 role starts.
  With `startMode: "roles"` there must be at least one further card and a shown `task` start needs
  its text; otherwise unfinished starts are kept as drafts.

### Assistant settings and versions

| Method | Path | Access |
|---|---|---|
| GET | `/kb/{id}/assistant-settings` | KB admin |
| PUT | `/kb/{id}/assistant-settings` | KB admin |
| GET | `/kb/{id}/assistant-settings/versions` | KB admin |
| POST | `/kb/{id}/assistant-settings/versions/{n}/restore` | KB admin |

The settings dialog's „Startseite" and „Verhalten" in one save, with a version history
(`kb_settings_versions`, migration 0094; `internal/kbassistant`).

- `GET` → `{title, description, categoryId, behavior, startPage, startPageConfigured, version,
  canRename}`. `behavior` is the body of `GET /kb/{id}/behavior`, `startPage` that of
  `GET /kb/{id}/start-page`. `version` is the newest version number (0 before the first save);
  `canRename` says whether the caller may change `title` (the `PATCH /kb/{id}` rename rule).
- `PUT` takes `{title, description, categoryId, behavior, startPage, baseVersion}` — the whole
  settings — validates all parts as their own routes do, writes them in one transaction and answers
  like `GET`. The start page's role cards are checked against the `behavior` saved with them.
  `categoryId` is the KB's one catalog category (`null` = none). Every save that changes something
  writes one version; the first one also records the state before it as version 1
  (`kind: "baseline"`). A save that changes nothing writes no version. `409 {code:
  "settings_conflict"}` when `baseVersion` is not the newest version; `403` when `title` changes
  and `canRename` is false; `400` with the reason for an invalid part or unknown category.
- `GET …/versions` → `{versions: [{number, kind: "baseline"|"save"|"restore", createdAt, authorId,
  authorName, note, restoredFrom, changes}]}`, newest first; the newest 200 are kept.
  `changes: [{area: "start"|"behavior", field, ref?, from?, to?, added?, removed?}]` are the
  changes against the version before, with display values resolved at save time (role and rule
  names in the KB's language). `field` codes — start: `title`, `description`, `category`, `colors` (`"#FROM #TO"`, `""` = none),
  `startMode`, `questionsOn`, `questionMode`, `dynamicCount`, `fixedQuestion` (added/removed),
  `fixedQuestionsOrder`, `uploadLabel`, `uploadInstruction`,
  `roleEntry` (added/removed, the role name); behavior: `roleStart` (ref = role name; how it starts:
  `input`, `task: <text>`, `task (prefill): <text>` or `file: <label> <instruction>`, `""` = not set up),
  `roleSuggestions` (ref = role name; `off`, `dynamic <n>` or `fixed: <q> | <q>`), `activeRole`, `customRole` (added/removed),
  `customRoleEdited` (ref; name, prompt, description or icon), `rule` (ref = „rule label (role name)", `on`/`off`), `customRule` (ref = role name;
  added/removed), `customRuleText` (ref = role name), `customRuleToggled` (ref = „rule text (role name)").
- `POST …/versions/{n}/restore` with `{baseVersion}` writes version `n`'s state as a new version
  (`kind: "restore"`, `restoredFrom: n`) and answers like `GET`; nothing is overwritten. The title
  is restored only with `canRename`; a category deleted since is dropped. `404` for an unknown
  version, `409 {code: "settings_conflict"}` for a stale `baseVersion`, `409 {code:
  "version_not_restorable"}` when the version uses a role or rule the catalog no longer has.

### Agents and teams

User-created agents (persona prompt, model override, tool allowlist, retrieval overrides) and teams (router → specialists → synthesis), attached to KBs and picked per chat.

| Method | Path | Access |
|---|---|---|
| GET | `/agents` | authenticated |
| POST | `/agents` | authenticated |
| GET | `/agents/registry` | authenticated |
| GET | `/agents/{id}` | authenticated (owner) |
| PUT | `/agents/{id}` | authenticated (owner) |
| DELETE | `/agents/{id}` | authenticated (owner) |
| GET | `/agent-teams` | authenticated |
| POST | `/agent-teams` | authenticated |
| GET | `/agent-teams/{id}` | authenticated (owner) |
| PUT | `/agent-teams/{id}` | authenticated (owner) |
| DELETE | `/agent-teams/{id}` | authenticated (owner) |
| GET | `/kb/{id}/agents` | KB view |
| PUT | `/kb/{id}/agents/{agentId}` | KB advanced |
| DELETE | `/kb/{id}/agents/{agentId}` | KB advanced |
| PUT | `/kb/{id}/teams/{teamId}` | KB advanced |
| DELETE | `/kb/{id}/teams/{teamId}` | KB advanced |

- `GET /agents/registry` returns the tools and override keys the agent form may offer (the same list the save validates against).
- `GET /kb/{id}/agents` is the chat picker's payload: the agents and teams attached to the KB.

### Per-user topic filters

The shell's chip row: a favorite (star) on any KB the caller can see, and the
caller's own categories with their KB assignments. Both are personal display
state and grant no access. A favorite is not a subscription: subscribing
decides whether a global KB is in the caller's overview at all, while the star
pins any KB — private or global — to the "Favoriten" chip.

| Method | Path | Gate | Success |
|---|---|---|---|
| PUT | `/kb/{id}/favorite` | KB role view | 204 |
| DELETE | `/kb/{id}/favorite` | KB role view | 204 |
| GET | `/kb-user-categories` | authenticated | 200, `[{id, name, sortOrder}]` (`[]` when none) |
| POST | `/kb-user-categories` | authenticated | 201, the created category |
| PATCH | `/kb-user-categories/{catId}` | authenticated | 200, the updated category |
| DELETE | `/kb-user-categories/{catId}` | authenticated | 204 |
| PUT | `/kb/{id}/user-categories/{catId}` | KB role view | 204 |
| DELETE | `/kb/{id}/user-categories/{catId}` | KB role view | 204 |

- PUT and DELETE on the favorite and on an assignment are idempotent: they set
  a state, so repeating them, or deleting something absent, is still 204.
- The `{id}` routes answer like every other KB route: 404 when the KB does not
  exist, 403 when the caller may not view it.
- `POST`/`PATCH` body: `{"name": string, "sortOrder": integer}`. `name` is
  trimmed and must be 1–100 characters (counted in Unicode code points), must
  contain no control characters, and must contain at least one visible
  character (whitespace and invisible format characters alone are refused);
  `sortOrder` defaults to 0 and must fit a signed 32-bit integer. Violations
  are 400. `PATCH` replaces both fields.
- 409 when the caller already has a category with the same name
  (case-insensitive), or already owns 50 categories (create only).
- 404 for a `catId` that is not a UUID; and on `PATCH`/`DELETE` of a category
  and `PUT` of an assignment, also for one that does not exist or belongs to
  another user — indistinguishable on purpose. (`DELETE` of an assignment is
  idempotent and stays 204.)
- Deleting a category removes its assignments. Leaving a KB or being removed
  from it removes the user's favorite and assignments on that KB when they can
  no longer view it afterwards (a private or unpublished KB); on a published
  global KB, which they can still view, both stay. Their categories always
  stay.

The KB rows of `GET /kb`, `GET /kb/global`, `GET /kb/{id}`, `PATCH /kb/{id}`,
`POST /kb` and the entries of `GET /kb/catalog` carry the caller's own state:

- `isFavorite` (boolean) — the caller starred this KB.
- `userCategoryIds` (string array, `[]` when none) — ids of the caller's own
  categories assigned to this KB.

Both fields are per caller and never appear on the API-key surfaces
(`GET /api/v1/kb`, `GET /openai/v1/models`).

### Search

| Method | Path | Auth |
|---|---|---|
| GET | `/search?q=<text>[&kb_id=<uuid>][&limit=<n>]` | authenticated (no KB role) |

The shell header's global search: one request, one object with four arrays —
`topics`, `sources`, `chats`, `messages` — always all present. `internal/globalsearch`.

- **Rate limit: 60 requests per minute per user** (fixed one-minute window,
  category `search`; see Rate Limiting below). Over the budget the answer is:

  ```
  HTTP/1.1 429 Too Many Requests
  Retry-After: <seconds until the window resets, 1-60>
  Content-Type: application/json

  {"error":"Too many requests, please try again later."}
  ```

  A client should treat this as "too many searches, wait a moment" and retry
  after `Retry-After` seconds, not as a failed search. The budget is counted
  **per authenticated user, not per IP**, so users behind one NAT or VPN
  egress each have their own. Only authenticated requests count: a request
  without a valid token is answered `401` before it reaches the limiter. If
  Redis is unavailable the limit is not enforced (fail open); search keeps
  working.

- Status codes: `200` with the body below; `400` for an invalid `q` or
  `limit`; `401` without a valid token; `404` for a `kb_id` that is not
  visible (see below); `429` over the rate limit; `500` on a server error.
  A request the client cancels before the answer is ready is logged with
  `499` (client closed request); the client never sees it.
- `q` is trimmed; fewer than 3 characters (counted in characters, not bytes,
  so `äöü` is enough) is `400` — never a full listing. More than 200
  characters is also `400`, and so is `q` that is not valid UTF-8 or
  contains a NUL character.
- `limit` applies **per group**: default 5, maximum 20. Any larger positive
  integer is clamped to 20 (even one too large for a 64-bit integer); a
  non-integer, `0` or a negative value is `400`.
- `kb_id` restricts every group to that topic. The caller needs at least
  `view` on it. If the topic does not exist, is not visible to the caller, or
  the id is not a UUID, the answer is `404` — never `403`, so the route cannot
  confirm that a hidden topic exists. (This differs on purpose from the
  KB-scoped routes `/kb/{id}/…`, which answer `404` for a missing KB and `403`
  for one the caller cannot access: here the topic is a filter, not the
  addressed resource.)
- Matching is **fuzzy**: a hit is either a case-insensitive literal substring
  (`ILIKE`, with `%`, `_` and `\` escaped) or trigram-similar to `q`
  (`pg_trgm` word similarity ≥ 0.4, migration 0084), so a typo such as
  `Statsitik` still finds `Statistik`. Topics match on name (substring or
  fuzzy) and on description and header text (substring only: fuzzy on long
  free text is noise). Sources match on the file name (substring or fuzzy).
- Each hit reports how it matched in `match`: `prefix` (the name starts with
  `q`), `substring` (the name, or for topics the description or header text,
  contains `q`) or `fuzzy` (only trigram-similar).
- Order within each group: `prefix`, then `substring` (for topics, name hits
  before description/header hits), then `fuzzy` by similarity, most similar
  first; ties by name, then id. A fuzzy hit never widens visibility: it is
  drawn from the same visible topics as every other hit.
- **Chats** match on the title exactly like file names (substring or fuzzy,
  same `match` tiers and order); ties go to the most recently updated chat.
- **Messages** match on content with Postgres full-text search
  (`to_tsvector('simple', …)`, migration 0085): the query is split into words
  by Postgres' own parser and every word must occur as a **word prefix**
  (`Statis` finds `Statistik`), case-insensitive, without stemming or
  typo tolerance. Words shorter than 3 characters are ignored (`abc de`
  searches only `abc`; `ab cd` finds no messages). Operator characters in `q`
  (`& | ! ( ) :`) are ignored, not evaluated. At most **one hit per chat** — its best-ranked message
  (`ts_rank`, ties to the newest) — ordered by rank. Only the first 100 000
  characters of a message are searchable.

**Visibility.** Every group contains only topics the caller could open, decided
per row by one SQL predicate that mirrors `kbaccess.EffectiveRole` rule for rule
(superadmin → owner; a `kb_members` row → that role; public + system admin →
admin; public + published → view; otherwise invisible). That is a superset of
`GET /kb/catalog`: published public topics the caller has not subscribed to are
included. Superadmins and system admins therefore see many results; that is
intended, not a leak.

**Sources follow the source permissions.** `sources` additionally contains only
files from topics where the caller holds `seeSources` (see Knowledge bases →
Source permissions): a viewer of a topic whose `viewerSeeSources` is off gets
no file hits from it, while the topic itself and the caller's own chats and
messages in it are still found. Owners, KB admins, editors, superadmins and
system admins on public topics always get file hits.

**Chats are private.** `chats` and `messages` contain **only the caller's own
chats**, and only in topics the caller can still open under the rule above — a
chat in a topic the caller has lost access to is not returned. No role widens
this, superadmin included: members cannot read each other's chats anywhere in
the app, and search is no exception.

```json
{
  "query": "prüfung",
  "kbId": null,
  "topics": [
    {
      "id": "uuid",
      "name": "Prüfungsordnungen",
      "description": "First 160 characters of the description …",
      "visibility": "public",
      "role": "view",
      "match": "prefix"
    }
  ],
  "sources": [
    {
      "id": "uuid", "name": "PO-2024.pdf", "type": "pdf", "kbId": "uuid",
      "kbName": "Prüfungsordnungen", "match": "fuzzy"
    }
  ],
  "chats": [
    {
      "id": "uuid", "title": "Prüfungsfragen", "type": "chat", "kbId": "uuid",
      "kbName": "Prüfungsordnungen", "updatedAt": "RFC 3339", "match": "prefix"
    }
  ],
  "messages": [
    {
      "id": "uuid", "chatId": "uuid", "chatTitle": "Prüfungsfragen", "chatType": "chat",
      "kbId": "uuid", "kbName": "Prüfungsordnungen", "role": "ai",
      "snippet": "Laut der \ue000Prüfungsordnung\ue001 von 2024 …",
      "createdAt": "RFC 3339"
    }
  ]
}
```

- `kbId` echoes the (canonicalised) scope, or `null` for a global search.
- `topics[].description` is the description, falling back to the header text,
  whitespace-collapsed and cut at 160 characters (ending in `…` when cut);
  `null` when both are empty. `role` is the caller's effective KB role.
- `match` on topics, sources and chats is one of `prefix`, `substring`,
  `fuzzy` (see above). Message hits carry no `match`: they are always
  full-text hits.
- `chats[].type` and `messages[].chatType` are `chats.type` as stored:
  `chat`, `research` or `academic-research` (hyphen). `messages[].role` is
  `messages.role` as stored: `user` or `ai` (not `assistant`).
- `messages[].snippet` is **plain text**, never HTML: one fragment of about
  8–20 words around the best match, whitespace-collapsed. Each matched word is
  wrapped in **U+E000** (start) and **U+E001** (end), two Unicode private-use
  characters that are stripped from the content before the snippet is cut, so
  every occurrence is a highlight marker. A client splits on them and renders
  every part as a text node (the marked parts highlighted). HTML/XML tags in
  the content are dropped by `ts_headline`; any other `<` or `&` stays
  literal, so the snippet must never be inserted as HTML.
- All four arrays are always present (`[]` when nothing matched).

### KB members and ownership

Four roles, strictly ordered `view < edit < admin < owner` (migration 0064,
`kb_members`). "Min. role" is the effective KB role the caller must resolve to
via `kbaccess.EffectiveRole`; `owner` and `self` are enforced inside the
handler rather than by the route gate. Replaces the removed `/kb/{id}/shares`
and `/kb/{id}/share[/{userId}]` endpoints.

| Method | Path | Min. role |
|---|---|---|
| GET | `/kb/{id}/members` | admin |
| PUT | `/kb/{id}/members/{userId}` | admin |
| DELETE | `/kb/{id}/members/{userId}` | admin |
| POST | `/kb/{id}/members/bulk` | admin |
| DELETE | `/kb/{id}/members/pending/{username}` | admin |
| GET | `/kb/{id}/invite-links` | admin |
| POST | `/kb/{id}/invite-links` | admin |
| DELETE | `/kb/{id}/invite-links/{linkId}` | admin |
| POST | `/invites/{token}/redeem` | authenticated (no KB role) |
| POST | `/kb/{id}/transfer-owner` | owner |
| DELETE | `/kb/{id}/membership` | view (self) |
| GET | `/kb/{id}/membership/impact` | view (self) |

`PUT /members/{userId}` and `POST /members/bulk` accept `view`, `edit` and
`admin` only — ownership moves solely through `/transfer-owner`, and the target
must already be a member. `DELETE /members/{userId}` (an admin revoking someone)
leaves that user's chats intact; `DELETE /membership` (self-service leave)
deletes them, and `GET /membership/impact` returns the chat count backing the
confirmation dialog. The member list sits behind `admin`, not `view`: on a
published global KB every authenticated caller resolves to `view`, and the
roster is not theirs to read.

An invite link is a permanent, revocable credential that grants the role it
was minted with. `POST /invites/{token}/redeem` is deliberately not KB-gated —
the caller has no role on the KB yet — and is rate-limited to 10 requests per
minute. Redeeming never lowers an existing role and never touches the owner.
A link's `redemptionCount` (in `GET /kb/{id}/invite-links`) is the number of
distinct people who redeemed it, not the number of redemptions: the same person
redeeming again leaves it unchanged, while `lastUsedAt` moves on every
redemption.

### Files and source ingestion

| Method | Path |
|---|---|
| POST | `/kb/{id}/files` |
| POST | `/kb/{id}/text` |
| POST | `/kb/{id}/add-sources` |
| POST | `/kb/{id}/fetch-url` |
| POST | `/kb/{id}/crawl` |
| GET | `/kb/{id}/crawl/status/{jobId}` |
| POST | `/kb/{id}/websearch` |
| GET | `/files/{id}/download` |
| GET | `/files/{id}/text` |
| DELETE | `/files/{id}` |
| POST | `/files/{id}/retry` |
| POST | `/kb/{id}/files/retry-failed` |
| POST | `/kb/{id}/files/from-library` |
| POST | `/kb/{id}/files/adopt` |
| GET | `/kb/{id}/files/{fileId}/tabular` |
| GET | `/kb/{id}/files/{fileId}/tabular/rows` |
| POST | `/kb/{id}/tabular/rematerialize` |

- Source permissions (see Knowledge bases): every adding route here — `POST /kb/{id}/files`, `/text`, `/add-sources`, `/fetch-url`, `/crawl`, `/files/from-library` — needs KB edit and `addSources` (`editorAddSources` plus `editorSeeSources`; never a viewer). Deleting and retrying — `DELETE /files/{id}`, `POST /files/{id}/retry`, `POST /kb/{id}/files/retry-failed` — needs `manageSources` (edit role and above with `seeSources`, never a viewer). `GET /kb/{id}/crawl/status/{jobId}` needs KB view and `seeSources`; `GET /files/{id}/download`, `GET /files/{id}/text` and both `…/tabular` routes need KB view and `downloadSources`. `POST /kb/{id}/websearch` only searches (KB view); adding a hit goes through `/add-sources`. The `/files/{id}` routes check this in the handler (their path has no KB), the others in the route's middleware.
- `POST /kb/{id}/files` refusals carry a `code` (see "Error codes"): the upload checks as on `/library/files`, `400 kb_full` when the KB holds its maximum number of files (500, 1 000 for a public KB) or would exceed 500 MB, and the library's `413 quota_exceeded` / `409 already_in_kb`.
- `GET /files/{id}/text` (KB view + `downloadSources`, checked in the handler like the download) serves the source preview of a document the browser cannot render: Word (`.docx`), PowerPoint (`.pptx`), ODT, EPUB and TeX, matched by MIME type or extension. Response `{"text": "…", "markdown": false}`, the text the built-in parsers extract on demand (not cached; a Docling ingest may have read more layout than this). Refusals carry a `code`: `400` invalid id, `404` file / KB / blob missing, `403`, `415 unsupported_file_type` for any other format (PDF, spreadsheets, images, audio and plain text are previewed from `/download`), `413 file_too_large` past 100 MiB, `422 file_unreadable`, `422 parse_timeout` (30 s).
- `POST /files/{id}/retry` (`manageSources` on the file's KB, checked in the handler) re-queues one file in status `error`; `409` if it is not, or another retry won. `POST /kb/{id}/files/retry-failed` (`manageSources`) does it for every failed file: `{"retried": N}`.
- `POST /kb/{id}/files/from-library` (KB edit + `addSources`) adds files from the caller's user file library; `POST /kb/{id}/files/adopt` (KB admin; private KB: owner only, public KB: system admin) moves legacy uploads into the uploader's library. Contract: [`docs/api-contracts/user-file-library.md`](docs/api-contracts/user-file-library.md).
- `GET /kb/{id}/files/{fileId}/tabular` (KB view + `downloadSources`) serves the file's "Tabellen" panel (parse report + materialised tables; `{"report":null,"tables":[]}` for a non-spreadsheet). A column the ingest linked to a lookup table of the same file carries `lookup: {table, key, label, via?, source, compare?}`: without `via` its values are codes whose name is `label` where `key` equals the code; with `via` it holds an already looked-up value keyed by that column. `source` is `formula`, `validation` or `heuristic` (inferred; may be wrong). A `validation` link has `key == label`: the column holds the listed value itself, so there is no name to show. `compare` is present when the two columns have different types: `numeric` means match the values as numbers (a code `5` against a key `"05"` or `"5.0"`), `text` as strings. `GET /kb/{id}/files/{fileId}/tabular/rows?table=<table_name>` (KB view + `downloadSources`) returns one page of a materialised table for the source preview. Parameters: `offset` (default 0), `limit` 1–500 (default 100), `q` (search, ≤200 characters, case-insensitive substring over all columns; a decimal comma also matches), `sort` (a column of that table) with `dir=asc|desc` (NULL last), `show_empty=true` (include empty template rows, which are hidden by default: every cell after the first is NULL, empty, or 0). Response: `{"table_name","sheet_name","columns":[…],"rows":[{"id","empty","cells":[…]}],"row_count","matched","offset","limit"}`, columns by SQL name, cells as SQL text (`null` for NULL), `id` = `_rowid` (ingest order, not the Excel row). The first page (`offset=0`) also carries `empty_rows` and `empty_columns`. `table` must be one of the file's own tables (`404` otherwise). `POST /kb/{id}/tabular/rematerialize` (KB admin) re-ingests every spreadsheet of the KB after `tabular_*` setting changes.

### User file library

Every user's personal file library; a KB's indexed copy references a library file. Full contract: [`docs/api-contracts/user-file-library.md`](docs/api-contracts/user-file-library.md).

| Method | Path | Access |
|---|---|---|
| GET | `/library/files` | authenticated (own files) |
| POST | `/library/files` | authenticated |
| GET | `/library/files/{id}` | authenticated (owner) |
| PATCH | `/library/files/{id}` | authenticated (owner) |
| DELETE | `/library/files/{id}` | authenticated (owner) |
| GET | `/library/files/{id}/download` | authenticated (owner) |
| GET | `/library/files/{id}/usage` | authenticated (owner) |
| GET | `/library/quota` | authenticated |
| POST | `/library/chat` | authenticated (owner of the files) |
| GET | `/library/chats` | authenticated |
| GET | `/library/chats/{id}` | authenticated (owner) |

- `DELETE /library/files/{id}` removes the file from every KB that uses it. `GET …/usage` lists those KBs.
- `POST /library/chat[?stream=true]` answers from 1–20 of the caller's library files without a KB; it uses the `chat` rate limit. Messages and deletion reuse `GET /chats/{id}/messages` and `DELETE /chats/{id}`.

### Chat

| Method | Path |
|---|---|
| GET | `/kb/{id}/chats` |
| GET | `/kb/{id}/starter-questions` |
| POST | `/kb/{id}/description/generate` |
| GET | `/chat/rag-system-prompt` |
| GET | `/chats/{id}` |
| GET | `/chats/{id}/messages` |
| PATCH | `/chats/{id}` |
| POST | `/chats/{id}/branch` |
| DELETE | `/chats/{id}` |
| POST | `/kb/{id}/chat` |
| POST | `/kb/{id}/chats/{chatId}/messages/{messageId}/feedback` |
| POST | `/kb/{id}/agui/chat` |
| POST | `/kb/{id}/chat/attachment` |
| POST | `/kb/{id}/chat/attachments` |

- `GET /kb/{id}/chats` lists the caller's chats in the KB, newest first. A chat made by branching carries `branchedFromChatId` (the chat it was copied from, which may have been deleted since). A chat whose messages fork inside it — two messages under one parent, as edits, regenerations and forks made before branching opened a new chat left them; prompt-enhancement rows do not count — carries `hasBranches: true`. A chat started in a role (`roleId` on `POST /kb/{id}/chat`, see "Behavior: roles and rules") carries `roleId`. These keys are omitted when they do not apply.
- `GET /chats/{id}` (authenticated, owner) returns one of the caller's chats as a row of the chat list, without `hasBranches`: `id`, `kbId` (`""` for a library chat), `title`, `type`, `teamId`, `agentId`, timestamps, `branchedFromChatId` when set. It lets a link name a chat by its id alone (the web UI's `/c/<chat>` URLs). `404` when the chat is not the caller's, does not exist, or the id is malformed.
- `POST /chats/{id}/branch` (authenticated, owner) with `{"messageId"}` copies the conversation from its first message down to that message — the path only, not sibling versions — into a new chat of the caller in the same KB, and answers `201` with the new chat (`branchedFromChatId` = `{id}`) plus `copiedMessageId`, the copy of `messageId`. Without `messageId` the branch is empty (no `copiedMessageId`). The web UI branches for every way of taking a conversation elsewhere: "Verzweigen" at an answer; "Antwort neu generieren" at its question, then answers the copied question with `regenerateOfMessageId`; editing a question at the turn before it (empty for the first question), then sends the edit under `copiedMessageId`. Feedback is not copied; chat attachments are re-linked. `400` for a malformed `messageId`, `404` when the chat is not the caller's, is not an ordinary KB chat (library chats, research sessions and agent chats cannot be branched: their state is more than the message chain), or the message is not in it.
- `POST /kb/{id}/agui/chat` (KB view, `chat` rate limit) is the agent chat (AG-UI in, SSE out); `404` unless `chat_agent_chat_enabled` is on for the KB. Contract: [`docs/api-contracts/agent-chat.md`](docs/api-contracts/agent-chat.md).
- `POST /kb/{id}/chat/attachment` (KB view, `chat` rate limit) uploads a document for in-chat comparison against the KB (parsed in memory, held 24 h, never ingested); `503` unless `chat_compare_enabled`. Refusals carry a `code`: `413 file_too_large` (`limitBytes` = `chat_compare_max_file_bytes`), `415 unsupported_file_type`, `422 file_unreadable` (the parser failed) or `no_text`, `400 invalid_upload`.

**Chat attachments as context.** `POST /kb/{id}/chat/attachments` (KB view, `chat_attachments`
rate limit) uploads one file (multipart field `file`) that the user attaches in the composer. The
file is stored as one of the user's own files — hidden from the library list, owner-only, counted
against the library quota, deduplicated by content — and never indexed. It is parsed and counted
now, so a file the chat cannot use is refused before the message is sent. `{id}` decides the token
budget (the KB's answer model); nothing about the KB is stored with the file.

| Status | When |
|---|---|
| `201` | `{"id", "name", "mime", "size", "tokens"}`; `id` goes into `attachmentIds` of the send |
| `400` / `413` | Invalid upload (`invalid_upload`, `empty_file`, `file_name_too_long`, `unsupported_file_type` for a blocked extension) / `file_too_large`, file over the upload size limit |
| `413` | `{"error": "quota_exceeded", "usedBytes", "quotaBytes", "chatAttachmentBytes"}` — the library quota is full; `chatAttachmentBytes` is the part of `usedBytes` held by chat attachments, which the library list does not show |
| `415` | `unsupported_file_type`: no parser handles the format (audio is not transcribed here) |
| `422` | `file_unreadable`: the format is supported but parsing failed (corrupt file, image without OCR); `no_text`: no extractable text; `parse_timeout`: took too long to read; or `{"error": "too_large_for_context", "code": "too_large_for_context", "tokens", "limit"}`: it alone exceeds the attachment budget |
| `503` | Chat attachments are not wired on this server |

The budget is `chat_attachments_context_share` (default 0.5) of the KB answer model's context
window: `ai_models.context_window` (set per model in the admin provider panel), else the window the
provider reports (vLLM `max_model_len` in `GET /models`, a LiteLLM proxy's `GET /model/info`
`max_input_tokens`; looked up once an hour per provider), else
`chat_attachments_fallback_context_window` (default 32 768 tokens). Tokens are counted
with the model's own tokenizer where the provider has vLLM's `/tokenize`, else with the cl100k
estimate.

`POST /kb/{id}/chat` takes `attachmentIds` (strings, at most `chat_attachments_max_per_message`,
default 10): files from the upload above (or any of the caller's own files). They are checked before
a chat is created or usage is recorded:

| Status | When |
|---|---|
| `400` | More ids than allowed; combined with a comparison run (`comparisonModes`); on a regenerate (it keeps its question's attachments) |
| `404` | An id is not a UUID, does not exist, or belongs to another user |
| `415` / `422` | A file cannot be read (same codes as on upload, plus `fileName`: the attachment it is about), or `too_large_for_context`: the new files together exceed the budget |

The files are linked to the user message and stay context for every later turn of the chat. Their
text goes into the conversation's first user turn as `<document>` blocks; the current turn's numbered
source list keeps the KB sources as `[1]…[N]` and adds one entry per document after them, so the
answer can cite a document like a KB source. Each such entry in `sources` carries `userFileId`
(no `fileId`) and its `content` is capped to 600 characters on the wire. The documents come before
the KB sources: when the window is tight, the lowest-ranked KB sources are left out first
(`{"agentTrajectory": {"stage": "attachments", "decision": "attachments_kb_trimmed", …}}`), and a
document is left out only when it does not fit even without them — older documents first, with
`"decision": "attachments_dropped"`. A turn with
documents skips factcheck, the factuality verifier / Self-RAG, the refine gate and RAGAS sampling
(they would judge the answer against KB sources that do not contain the documents); the citation
validator still runs. A reader without the citation right on the KB (`seeCitations`) still sees
their own attachments among the sources, with their `[n]` markers and citation results; only the KB
attribution is removed (§ Citations). `GET /chats/{id}/messages` returns `attachments: [{userFileId,
name, mime, size}]` on user messages that have any. `DELETE /chats/{id}` also deletes the chat's own attachments
that nothing else references; attachments left by a KB or account deletion and uploads never sent
are removed by the worker's `userfiles_orphan_sweep` after 24 h. The file itself downloads through
`GET /library/files/{id}/download`.

`POST /kb/{id}/chat` takes an optional boolean `webSearch` (per-turn web search):

- absent — unchanged behaviour (the answer LLM gets the tools `chat_answer_tools_enabled` gives it);
- `true` — the answer LLM gets the `web_search` tool for this turn; requires `?stream=true`;
- `false` — `web_search` is kept out of this turn, even when `chat_answer_tools_enabled` is on.

A request with `webSearch: true` is refused with **422 Unprocessable Entity** — before a chat is created
or usage is recorded — when web search is not available on the server (admin gate
`chat_web_search_enabled`, `web_search_enabled` or the Google credentials), when the request is not
streaming, or when it also selects an agent or team (`teamId`/`agentId`). The error message is generic;
the reason is in the server log. When the admin's per-route tool allowlist removes `web_search` for the
turn's route, the turn is answered without it and the stream carries the trajectory event
`{"agentTrajectory":{"stage":"web_search","decision":"skipped","reason":"web search is not available for this turn"}}`;
the specific cause is only in the server log.

**`PATCH /chats/{id}`** renames a chat. Authenticated; only the chat's owner
may rename it. Body `{"title": "…"}` (at most 4 KiB); every whitespace run in the title,
line breaks included, collapses to one space, other control characters are
refused, and the result must be 1–200 characters (counted as Unicode
characters, not bytes). Renaming does not change
`updatedAt`, so the chat keeps its place in the history list.

| Status | When |
|---|---|
| `204` | Renamed (no body) |
| `400` | Invalid or oversize JSON, empty title, a control character, or title over 200 characters |
| `401` | Not authenticated |
| `404` | `{id}` is not a UUID, the chat does not exist, or it belongs to another user |

**`GET /chat/rag-system-prompt?lang=de|en`** returns the fixed answer
instructions that the default answer path appends after a KB's own system
prompt, so the system-prompt panel can show what a KB prompt is combined with:
`{"language": "de", "prompt": "…"}`. Authenticated, read-only, no KB scope.
`lang` selects the language; a missing or unsupported value falls back to `de`,
as for `POST /kb/{id}/chat`. It is not the complete prompt of a turn: per turn
the default path adds the current-date line, low-confidence/abstain notices,
enumeration/recency/conflict addenda and the retrieved context; memory blocks
and tabular guidance are added to the KB prompt when those features are on;
and the corpus-table path and the document-comparison summary without a team
use their own instructions instead. Answers `200`, or `401` when not
authenticated.

**`POST /kb/{id}/description/generate`** (`{"language": "de"|"en", "title": "…"}`)
writes a description draft for the topic's title block: `{"description": "…"}`.
One or two sentences (the prompt asks for at most 180 characters; the second begins
„Beantwortet Fragen zu …"), generated by the fast-tier model from the title —
`title` as the editor shows it, saved or not (whitespace folded, at most 200
characters, else `400`); empty or missing = the KB's saved name — and one
excerpt each of its 12 newest `completed`/`partial` documents
(injection-flagged files excluded); a single line without links; a
text over 260 characters is cut after its last whole sentence that fits. Nothing is stored:
the start page editor puts the text into the description field, and saving the
assistant settings keeps it as the KB's own description. Every call generates
anew. Requires `admin` on the KB and counts against the `generate` rate limit.
`409` when the KB has no eligible documents, `503` without a configured model,
`502` when the generation failed or produced nothing usable.

**`GET /kb/{id}/starter-questions?lang=de|en&roleId=`** suggests up to 6 questions to
open an empty chat with: `{"questions": ["…"]}`. Requires `view` on the KB and
counts against its own `starter_questions` rate limit (30 / min per client IP,
not shared with `generate`). The questions are generated afresh on every call
by the fast-tier model (`model_tier_fast`, else the KB's chat model) at a
sampling temperature, so every empty chat gets other ones. Input: the KB name,
the role the chat starts in (`roleId`; omitted, unknown or removed = the KB's
active role: its name, description and role prompt) and one excerpt per
document — the document's top-level RAPTOR summary where one exists, else its
first chunk — for 12 documents picked at random from the 40 newest with status
`completed` or `partial`; files flagged by the ingest-time injection screen are
never used. Each served question is a single line of at most 120 characters,
without links, and the list carries no duplicates. Nothing is cached but a
failed generation (per KB, language, model, role and document set, for a
minute, per server process). `lang` falls back to `de` like the other chat
routes.

| Status | When |
|---|---|
| `200` | Questions, or `[]` when the KB has no eligible documents, no model is configured, or generation failed or produced no valid question |
| `401` / `403` / `404` | Not authenticated / no `view` role / KB not found |
| `429` | `starter_questions` rate limit exceeded |
| `500` | The KB's documents could not be read |

### Generated content

| Method | Path | Status |
|---|---|---|
| GET | `/kb/{id}/generated-content` | available |
| POST | `/kb/{id}/generate/cards` | available |
| POST | `/kb/{id}/generate/presentation` | available |
| POST | `/kb/{id}/generate/podcast` | available |
| GET | `/kb/{id}/generate/podcast/status/{jobId}` | available |
| POST | `/kb/{id}/generate/chart` | available |
| POST | `/kb/{id}/generate/analysis` | available |
| POST | `/kb/{id}/generate/abstract` | available |
| POST | `/kb/{id}/generate/quiz` | available |
| POST | `/kb/{id}/generate/briefing_doc` | available |
| POST | `/kb/{id}/generate/faq` | available |
| POST | `/kb/{id}/generate/study_guide` | available |
| POST | `/kb/{id}/generate/timeline` | available |
| GET | `/kb/{id}/workspace/presets` | available |
| PATCH | `/generated-content/{id}` | available |
| DELETE | `/generated-content/{id}` | available |
| GET | `/generated-content/{id}/download` | available |
| GET | `/generated-content/{id}/stream` | available |
| POST | `/describe-image` | `503` unless `describe_image_enabled` and `describe_image_model` are set |

All `generate/*` routes need KB view and use the `generate` rate limit. `briefing_doc`, `faq`, `study_guide` and `timeline` are the Markdown study artifacts (one generic handler, `contentgen.TextArtifacts`). `GET /kb/{id}/workspace/presets` returns the workspace tiles available for the KB (generator presets, plus whether document comparison is enabled).

### Research and export

| Method | Path |
|---|---|
| POST | `/enhance` |
| POST | `/kb/{id}/research` |
| POST | `/kb/{id}/web-research` |
| GET | `/research/{researchId}/status` |
| GET | `/research/{researchId}/report` |
| GET | `/research/deep/{deepChatId}` |
| POST | `/research/{researchId}/abort` |
| POST | `/kb/{id}/export/docx` |
| POST | `/kb/{id}/export/bibtex` |
| POST | `/research/{sessionId}/bibtex` |

### Academic research

| Method | Path |
|---|---|
| POST | `/kb/{id}/academic-search` |
| POST | `/kb/{id}/academic-research` |
| POST | `/academic-research/{researchId}/papers/add` |
| POST | `/kb/{id}/export/academic-bibtex` |
| POST | `/academic-research/{sessionId}/bibtex` |

`POST /academic-research/{researchId}/papers/add` names its target KB in the body (`kbId`) and needs `addSources` on it (see Source permissions), checked in the handler before any PDF is fetched; `403` otherwise.

### RSS

| Method | Path |
|---|---|
| POST | `/kb/{id}/rss` |
| GET | `/kb/{id}/rss` |
| PATCH | `/kb/{id}/rss/{feedId}` |
| DELETE | `/kb/{id}/rss/{feedId}` |
| POST | `/kb/{id}/rss/{feedId}/poll` |

`GET` needs KB view and `seeSources`; `POST` (create a feed) needs KB edit and `addSources`; `PATCH`, `DELETE` and `…/poll` need `manageSources` (see Source permissions).

### Confluence

| Method | Path |
|---|---|
| GET | `/confluence/connections` |
| POST | `/confluence/connections` |
| PUT | `/confluence/connections/{id}` |
| DELETE | `/confluence/connections/{id}` |
| POST | `/confluence/connections/{id}/verify` |
| GET | `/confluence/spaces` |
| GET | `/confluence/spaces/{spaceKey}/pages` |
| GET | `/confluence/spaces/{spaceKey}/pages/all` |
| GET | `/confluence/pages/{pageId}/children` |
| POST | `/kb/{id}/confluence-sources` |
| GET | `/kb/{id}/confluence-sources` |
| PATCH | `/kb/{id}/confluence-sources/{sourceId}` |
| DELETE | `/kb/{id}/confluence-sources/{sourceId}` |
| POST | `/kb/{id}/confluence-sources/{sourceId}/sync` |

`GET /confluence/spaces/{spaceKey}/pages/all` returns every page of a space with its ancestor titles, for the import dialog's client-side search.

`GET /kb/{id}/confluence-sources` needs KB view and `seeSources`; `POST /kb/{id}/confluence-sources` (create) needs KB edit and `addSources`; `PATCH`, `DELETE` and `…/sync` need `manageSources` (see Source permissions).

### Git repositories

Requires `git_repo_enabled`; HTTPS only, optional access token stored encrypted.

| Method | Path | Access |
|---|---|---|
| GET | `/kb/{id}/git-repos` | KB view + `seeSources` |
| POST | `/kb/{id}/git-repos` | KB edit + `addSources` |
| PATCH | `/kb/{id}/git-repos/{sourceId}` | KB edit + `manageSources` |
| DELETE | `/kb/{id}/git-repos/{sourceId}` | KB edit + `manageSources` |
| POST | `/kb/{id}/git-repos/{sourceId}/sync` | KB edit + `manageSources` |

### Knowledge graph

| Method | Path | Access |
|---|---|---|
| GET | `/kb/{id}/graph` | KB view |
| GET | `/kb/{id}/graph/stream` | KB view |
| GET | `/kb/{id}/graph/entity/{entityId}` | KB view |
| POST | `/kb/{id}/canonicalize` | KB admin |
| POST | `/kb/{id}/communities/build` | KB admin |

- `GET /graph/stream` is an SSE stream of live mind-map updates while files are ingested.
- `GET /graph/entity/{entityId}` is one entity's card (type, aliases, degree, sources, neighbours).
- `POST /canonicalize` queues entity deduplication (needs `kg_canonicalization_enabled`); `POST /communities/build` queues community detection and summaries (needs `kg_communities_enabled`).

### Analytics and system health

| Method | Path |
|---|---|
| GET | `/kb/{id}/analytics` |
| GET | `/kb/{id}/analytics/files` |
| GET | `/kb/{id}/analytics/activity` |
| GET | `/kb/{id}/analytics/chats` |
| GET | `/kb/{id}/analytics/generated` |
| GET | `/kb/{id}/analytics/retrieval-quality` |
| GET | `/system-health/live` |
| GET | `/system-health/history` |
| GET | `/system-health/subsystems` |
| POST | `/system-health/ai-check` |

### Admin

| Method | Path |
|---|---|
| GET | `/admin/configs` |
| POST | `/admin/configs` |
| PATCH | `/admin/configs/{id}` |
| DELETE | `/admin/configs/{id}` |
| POST | `/admin/configs/{id}/activate` |
| POST | `/admin/configs/{id}/test` |
| GET | `/admin/configs/{id}/model-info` |
| GET | `/admin/auth-providers` |
| POST | `/admin/auth-providers` |
| PATCH | `/admin/auth-providers/{id}` |
| DELETE | `/admin/auth-providers/{id}` |
| GET | `/admin/users` |
| PATCH | `/admin/users/{id}/role` |
| DELETE | `/admin/users/{id}` |
| GET | `/admin/global-kbs` |
| POST | `/admin/global-kbs` |
| PATCH | `/admin/global-kbs/{id}` |
| DELETE | `/admin/global-kbs/{id}` |
| GET | `/admin/global-kbs/{id}/editors` |
| POST | `/admin/global-kbs/{id}/editors` |
| DELETE | `/admin/global-kbs/{id}/editors/{userId}` |
| GET | `/admin/audit-logs` |
| POST | `/admin/reembed-all` |
| POST | `/admin/agent/template` |
| POST | `/admin/reembed-user-memory` |
| GET | `/admin/kb-overview` |
| DELETE | `/admin/kbs/{id}` |
| PATCH | `/admin/kbs/{id}/owner` |
| POST | `/admin/kb/{id}/publish` |
| POST | `/admin/kb/{id}/unpublish` |
| GET | `/admin/kb/{id}/unpublish-impact` |
| GET | `/admin/kb-categories` |
| POST | `/admin/kb-categories` |
| PATCH | `/admin/kb-categories/{catId}` |
| DELETE | `/admin/kb-categories/{catId}` |
| GET | `/admin/role-templates` |
| POST | `/admin/role-templates` |
| PUT | `/admin/role-templates/order` |
| PUT | `/admin/role-templates/{roleId}` |
| DELETE | `/admin/role-templates/{roleId}` |
| GET | `/admin/agent-metrics` |
| GET | `/admin/feedback/chunks` |
| GET | `/admin/mcp/status` |
| POST | `/admin/mcp/reload` |

All admin routes need a system role of `admin` or `superadmin`; these are **superadmin only**: `/admin/reembed-all`, `/admin/reembed-user-memory`, `/admin/agent/template`, `DELETE /admin/kbs/{id}` and `PATCH /admin/kbs/{id}/owner`.

- `GET /admin/configs/{id}/model-info` lists the provider's models (`GET /models`) as `{"models": [{"id", "contextWindow"}]}`, with the context window where the server reports one (vLLM: `max_model_len`); `502` when the provider cannot be reached. The admin saves a window per chat model as `contextWindow` in the `chat_models` entries of `POST`/`PATCH /admin/configs` (0 or absent = unknown, at most 10 000 000).
- `GET /admin/global-kbs` lists the public KBs, each with `fileCount` and `lastIngestedAt` (omitted before the first successful ingest) — the two „Entdecken" card fields the admin list checks for completeness.
- `/admin/role-templates` is „Vorlagen" › Rollen, the template roles of the catalog (`role_templates`, seeded once from the roles the code shipped before). `GET` lists them in display order as `[{id, icon, isDefault, enabled, name: {de, en}, description: {de, en}, prompt: {de, en}, cover: {from, to}, usedBy}]` — `usedBy` counts the KBs that use the role as their active role or on a start page card. `POST` (create; the server picks the `id`, `t-` + 8 hex) and `PUT /{roleId}` take the same shape without `id`/`usedBy` and answer with the list. `400` for an unknown `icon`, a missing German name or prompt, a name over 80, a description over 200 or a prompt over 8000 characters, a `cover` colour that is not `#RRGGBB`, a disabled default, or `isDefault: false` on the default (another role takes it instead — setting `isDefault` on one clears it on the previous). An empty English text falls back to the German one. `enabled: false` stops offering the role for new picks; KBs and chats that use it keep it, and the catalog still lists it with `enabled: false`. `DELETE /{roleId}`: `400` for the default, `409` while `usedBy > 0`. `PUT /order` takes `{ids}` naming every role once. A change reaches the other server and worker instances within 30 seconds.
- `GET /admin/kb-overview` is the KB-Übersicht (activity, freshness, sync status, RAGAS, injection flags per KB).
- `POST /admin/kb/{id}/publish` makes a KB public but staged (`is_published = false`); `unpublish` needs a new owner, and `unpublish-impact` returns the numbers and owner candidates for its confirmation dialog.
- `GET /admin/feedback/chunks?kb_id=&limit=` lists the most net-negatively rated chunks; `GET /admin/agent-metrics` the orchestrator outcome distributions.
- `POST /admin/mcp/reload` re-reads `mcp_servers` and returns the fresh per-server status.

### Admin evaluation runner

These routes drive the in-app evaluation runner. They are admin-only and are skipped at boot when `eval_ui_enabled` in `site_configs` is set to a falsy value (`false`, `0`, `off`, `no`).

| Method | Path |
|---|---|
| POST | `/admin/eval/runs` |
| GET | `/admin/eval/runs` |
| GET | `/admin/eval/runs/{id}` |
| GET | `/admin/eval/runs/{id}/export` |
| DELETE | `/admin/eval/runs/{id}` |
| POST | `/admin/eval/golden-sets` |
| GET | `/admin/eval/golden-sets` |
| DELETE | `/admin/eval/golden-sets/{id}` |
| GET | `/admin/eval/golden-sets/{id}` |
| PATCH | `/admin/eval/golden-sets/{id}` |
| POST | `/admin/eval/golden-sets/generate` |
| GET | `/admin/eval/golden-sets/jobs` |

`POST /admin/eval/golden-sets/generate` starts an asynchronous draft golden set generated from a KB's corpus; `GET /admin/eval/golden-sets/jobs` reports the jobs.

### Per-KB evaluation

The KB settings panel's Evals tab. **KB advanced**; skipped at boot together with the routes above when `eval_ui_enabled` is falsy.

| Method | Path |
|---|---|
| GET | `/kb/{id}/eval/golden-sets` |
| POST | `/kb/{id}/eval/golden-sets` |
| POST | `/kb/{id}/eval/golden-sets/generate` |
| GET | `/kb/{id}/eval/golden-sets/jobs` |
| GET | `/kb/{id}/eval/golden-sets/{gsId}` |
| PATCH | `/kb/{id}/eval/golden-sets/{gsId}` |
| DELETE | `/kb/{id}/eval/golden-sets/{gsId}` |
| POST | `/kb/{id}/eval/runs` |
| GET | `/kb/{id}/eval/runs` |
| GET | `/kb/{id}/eval/runs/{runId}` |
| GET | `/kb/{id}/eval/runs/{runId}/export` |
| DELETE | `/kb/{id}/eval/runs/{runId}` |

### Data Explorer

These routes are registered in the Go server for compatibility but currently return `501 Not Implemented`.

| Method | Path |
|---|---|
| GET | `/kb/{id}/data-explorer/schema` |
| POST | `/kb/{id}/data-explorer/query` |
| POST | `/kb/{id}/data-explorer/export` |

## Public API

All routes below are under `/api/v1` and require `Authorization: Bearer <api-key>`.

| Method | Path |
|---|---|
| GET | `/kb` |
| GET | `/kb/{id}/chats` |
| GET | `/kb/{id}/chats/{chatId}/messages` |
| POST | `/kb/{id}/chat` |
| POST | `/kb/{id}/research` |
| POST | `/kb/{id}/mcp` |

Notes:

- `GET /api/v1/kb` rows carry the `capabilities` object (`seeSources`, `addSources`, `downloadSources`, `seeCitations`, `manageSources`) resolved for the API key's owner, the same shape as the web API's KB list. The `api-user` system role adds no KB rights of its own; only the owner's KB roles count.
- KB permissions are still enforced. A file selection (`selectedFileIds` on `POST /kb/{id}/chat`, `fileIds` on `POST /kb/{id}/research`) is not gated by the per-KB source permissions: any caller with KB view access may restrict a turn to chosen files.
- `POST /api/v1/kb/{id}/research` supports streaming and non-streaming behavior.
- `POST /api/v1/kb/{id}/mcp` exposes the KB as an MCP server with the single tool `ask_kb` (KB view); `404` unless `mcp_server_enabled` is on.
- Citations follow the key owner's `seeCitations` on the KB: without it, `POST /kb/{id}/chat`, `GET /kb/{id}/chats/{chatId}/messages` and `ask_kb` return no sources and no `[n]` markers (see the web API's [Citations](#citations)).

## OpenAI-Compatible API

All routes below are under `/openai/v1` and require an API key.

| Method | Path |
|---|---|
| GET | `/models` |
| POST | `/chat/completions` |

Model IDs are exposed as `kb-{uuid}` and map directly to knowledge bases.

### Source attribution

`POST /chat/completions` returns the retrieved chunks that produced the answer,
in two complementary forms. Both are additive to the standard OpenAI envelope —
clients that ignore them are unaffected.

**`message.annotations[]`** — inline citations, following OpenAI's annotation
shape. One entry per `[n]` marker occurrence in the answer; a multi-cite marker
(`[1, 2]`) yields one entry per referenced source, all sharing the marker's
offset.

```json
{
  "type": "file_citation",
  "file_citation": { "file_id": "…", "filename": "handbuch.pdf", "index": 16 }
}
```

`index` is a **character** offset into `message.content` (not bytes), matching
OpenAI's definition — relevant because answers are frequently German.

**`message.context.citations[]`** — the retrieved chunk bodies, following the
Azure OpenAI "On Your Data" shape so OpenWebUI-family clients recognise them
without bespoke handling:

```json
{
  "content": "…chunk text…",
  "title": "handbuch.pdf",
  "filepath": "handbuch.pdf",
  "file_id": "…",
  "chunk_id": "…",
  "score": 0.91,
  "pages": [3]
}
```

Both keys are **omitted entirely** when retrieval returned nothing or the
answer cites nothing — they are never emitted as empty arrays, so clients can
branch on presence.

**Streaming.** Retrieval completes before the first token, so the sources ride
the opening chunk and the annotations ride the closing one:

| Chunk | Carries |
|---|---|
| first (`delta.role = "assistant"`) | `delta.context.citations[]` |
| last (`finish_reason = "stop"`) | `delta.annotations[]` |

This lets a client render source cards while the answer is still streaming;
annotation offsets only exist once the full text is assembled.

**Caveat.** This endpoint does not run the citation validator (that is a
post-response task on the in-app chat path), so annotations reflect what the
model claimed, not what was verified. Markers referencing a source that was
never retrieved are dropped rather than emitted as dangling annotations.

**Citation visibility.** When the key owner lacks `seeCitations` on the KB
(the per-KB source permissions, see [Citations](#citations)), both keys are
omitted and the `[n]` markers are removed from the content, in both modes.

## Open WebUI-Compatible API (ILIAS LfAssistant)

All routes below are under `/owui` and require an API key. They exist only for
the ILIAS LfAssistant plugin's "Open WebUI RAG" mode and mirror the subset of
Open WebUI's API that plugin calls. While `owui_compat_enabled` is off, every
route answers `404 {"detail"}` for an authenticated key (a missing or invalid
key still gets the API-key middleware's `401 {"error"}`).

| Method | Path | Notes |
|---|---|---|
| POST | `/api/chat/completions` | RAG answer over the collection(s) in `files`; streams Open WebUI's `sources` frame first |
| GET | `/api/models` | The one advertised model, `justrag`; the request's `model` is ignored |
| POST | `/api/v1/files/` | Stores the upload in the key's service-user file library — **no indexing** |
| GET | `/api/v1/files/` | Lists the key's uploads |
| GET | `/api/v1/files/{id}` | Status; `completed` once stored (unknown id → 200 `failed`) |
| DELETE | `/api/v1/files/{id}` | Drops the upload id and the KB copies only it reaches; the library file goes with the last upload id sharing its bytes |
| GET | `/api/v1/files/{id}/data/content` | Always `{"id", "content": ""}` (only the plugin's debug modal calls it) |
| POST | `/api/v1/knowledge/create` | Creates a collection = a private KB owned by the service user |
| POST | `/api/v1/knowledge/{id}/file/add` | Starts **indexing** the upload in that KB (parse, chunk, embed, KG — or an index copy), in the background |
| POST | `/api/v1/knowledge/{id}/file/remove` | Removes the file and its index from that KB |
| DELETE | `/api/v1/knowledge/{id}/delete` | Deletes the collection's KB |

Indexing happens only on `file/add`, per KB: an upload that is never added to a
collection costs storage but no model calls, and each collection's knowledge
graph contains only its own documents. A file added to a second collection
reuses the first collection's index through the library's copy mode.

Because the plugin throws on any status ≥ 400, several error cases answer 2xx
by design. Full request/response shapes, every deviation from Open WebUI and the
cut-over procedure: [`docs/api-contracts/owui-compat.md`](docs/api-contracts/owui-compat.md)
and the "ILIAS LfAssistant (Open WebUI RAG mode)" recipe in
[`docs/feature-recipes.md`](docs/feature-recipes.md).

## Rate Limiting

The Go server applies per-category Redis-backed rate limits:

| Category | Limit | Endpoints |
|---|---|---|
| login | 5 / 15 min | `POST /api/auth/login` |
| chat | 20 / min | `POST /api/kb/{id}/chat` |
| research | 5 / min | `POST /api/kb/{id}/research`, `POST /api/kb/{id}/web-research` |
| generate | 10 / min | `POST /api/kb/{id}/generate/*`, `POST /api/kb/{id}/behavior/role-writer/*`, `POST /api/kb/{id}/description/generate` |
| starter_questions | 30 / min | `GET /api/kb/{id}/starter-questions` |
| api | 100 / min | `/api/v1/*`, `/openai/v1/*` |
| search | 60 / min **per user** | `GET /api/search` |
| chat_attachments | 60 / min **per user** | `POST /api/kb/{id}/chat/attachments` |
| owui_chat | 600 / min **per API key** | `POST /owui/api/chat/completions` |
| owui_data | 300 / min **per API key** | every other `/owui/*` route |

Limits are counted per client IP, except `search` and `chat_attachments`, which run after
authentication and are counted per user, and the two `owui_*` categories, which
are counted per API key because one ILIAS server carries every student.
