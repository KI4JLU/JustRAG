# API Reference

This document reflects the current Go backend API surface in `go-backend/internal/app/routes.go`.

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

## Docs and Service Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/ready` | Readiness |
| GET | `/version` | Build metadata |
| GET | `/metrics` | Admin-only Prometheus endpoint |
| GET | `/api/v1/openapi.json` | Embedded OpenAPI spec |
| GET | `/api/v1/docs` | Scalar API reference |

## Web/Session API

All routes below are under `/api`.

### Authentication

| Method | Path |
|---|---|
| POST | `/auth/login` |
| POST | `/auth/logout` |
| POST | `/auth/refresh` |

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

### Knowledge bases

| Method | Path |
|---|---|
| GET | `/kb` |
| GET | `/kb/global` |
| POST | `/kb` |
| PATCH | `/kb/{id}` |
| DELETE | `/kb/{id}` |
| GET | `/kb/{id}/files` |

### Search

| Method | Path | Auth |
|---|---|---|
| GET | `/search?q=<text>[&kb_id=<uuid>][&limit=<n>]` | authenticated (no KB role) |

The shell header's global search: one request, one object with four arrays —
`topics`, `sources`, `chats`, `messages` — always all present. `internal/search`.

- **Rate limit: 60 requests per minute** (fixed one-minute window, category
  `search`; see Rate Limiting below). Over the budget the answer is:

  ```
  HTTP/1.1 429 Too Many Requests
  Retry-After: <seconds until the window resets, 1-60>
  Content-Type: application/json

  {"error":"Too many requests from this IP, please try again later."}
  ```

  A client should treat this as "too many searches, wait a moment" and retry
  after `Retry-After` seconds, not as a failed search. The budget is counted
  **per client IP, not per user**, so users behind one NAT or VPN egress share
  it. Only authenticated requests count: a request without a valid token is
  answered `401` before it reaches the limiter. If Redis is unavailable the
  limit is not enforced (fail open); search keeps working.

- `q` is trimmed; fewer than 2 characters (counted in characters, not bytes)
  is `400` — never a full listing. More than 200 characters is also `400`.
- `limit` applies **per group**: default 5, maximum 20. A larger value is
  clamped to 20; a non-integer or a value below 1 is `400`.
- `kb_id` restricts every group to that topic. The caller needs at least
  `view` on it. If the topic does not exist, is not visible to the caller, or
  the id is not a UUID, the answer is `404` — never `403`, so the route cannot
  confirm that a hidden topic exists.
- Matching is **fuzzy**: a hit is either a case-insensitive literal substring
  (`ILIKE`, with `%`, `_` and `\` escaped) or trigram-similar to `q`
  (`pg_trgm` word similarity ≥ 0.4, migration 0076), so a typo such as
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
  (`to_tsvector('simple', …)`, migration 0077): the query is split into words
  by Postgres' own parser and every word must occur as a **word prefix**
  (`Statis` finds `Statistik`), case-insensitive, without stemming or
  typo tolerance. Words shorter than 2 characters are ignored (`ab c`
  searches only `ab`; `a b` finds no messages). Operator characters in `q`
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
      "kbId": "uuid", "kbName": "Prüfungsordnungen", "role": "assistant",
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
- `chats[].type` and `messages[].chatType` are `chats.type`: `chat`,
  `research` or `academic_research`. `messages[].role` is `user` or
  `assistant`.
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
| DELETE | `/files/{id}` |

### Chat

| Method | Path |
|---|---|
| GET | `/kb/{id}/chats` |
| GET | `/chats/{id}/messages` |
| DELETE | `/chats/{id}` |
| POST | `/kb/{id}/chat` |
| POST | `/kb/{id}/chats/{chatId}/messages/{messageId}/feedback` |

### Generated content

| Method | Path | Status |
|---|---|---|
| GET | `/kb/{id}/generated-content` | available |
| POST | `/kb/{id}/generate/cards` | available |
| POST | `/kb/{id}/generate/presentation` | available |
| POST | `/kb/{id}/generate/podcast` | available |
| GET | `/kb/{id}/generate/podcast/status/{jobId}` | available |
| POST | `/kb/{id}/generate/chart` | returns `501` in Go runtime |
| POST | `/kb/{id}/generate/analysis` | available |
| POST | `/kb/{id}/generate/abstract` | available |
| PATCH | `/generated-content/{id}` | available |
| DELETE | `/generated-content/{id}` | available |
| GET | `/generated-content/{id}/download` | available |
| GET | `/generated-content/{id}/stream` | available |
| POST | `/describe-image` | returns `501` in Go runtime |

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

### RSS

| Method | Path |
|---|---|
| POST | `/kb/{id}/rss` |
| GET | `/kb/{id}/rss` |
| PATCH | `/kb/{id}/rss/{feedId}` |
| DELETE | `/kb/{id}/rss/{feedId}` |
| POST | `/kb/{id}/rss/{feedId}/poll` |

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
| GET | `/confluence/pages/{pageId}/children` |
| POST | `/kb/{id}/confluence-sources` |
| GET | `/kb/{id}/confluence-sources` |
| PATCH | `/kb/{id}/confluence-sources/{sourceId}` |
| DELETE | `/kb/{id}/confluence-sources/{sourceId}` |
| POST | `/kb/{id}/confluence-sources/{sourceId}/sync` |

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

Notes:

- KB permissions are still enforced.
- `POST /api/v1/kb/{id}/research` supports streaming and non-streaming behavior.

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

## Rate Limiting

The Go server applies per-category Redis-backed rate limits:

| Category | Limit | Endpoints |
|---|---|---|
| login | 5 / 15 min | `POST /api/auth/login` |
| chat | 20 / min | `POST /api/kb/{id}/chat` |
| research | 5 / min | `POST /api/kb/{id}/research`, `POST /api/kb/{id}/web-research` |
| generate | 10 / min | `POST /api/kb/{id}/generate/*` |
| api | 100 / min | `/api/v1/*`, `/openai/v1/*` |
| search | 60 / min | `GET /api/search` |
