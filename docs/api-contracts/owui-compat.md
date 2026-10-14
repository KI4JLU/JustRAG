# Open WebUI compatibility surface contract (`/owui`)

Backend: `go-backend/internal/owuicompat`, wired in `registerOWUICompatRoutes` (`internal/app/routes.go`). Serves the ILIAS LfAssistant plugin's "Open WebUI RAG" mode; the plugin is the only client. Everything here matches the merged code.

## Conventions

- Plugin config: endpoint base `https://<host>/owui`, chat path `api/chat/completions`, model `justrag` (the request's `model` is ignored).
- Gated by the global `site_config` flag `owui_compat_enabled` (default **off**, absent = off): every route answers `404 {"detail":"Not Found"}` while it is off, for an authenticated key. The API-key middleware runs first, so a missing or invalid key still gets its flat `{"error":…}` `401`.
- Auth: `Authorization: Bearer jrag_…` (the standard API key chain). A missing or bad key is rejected by the key middleware with its own flat body, `401 {"error":"…"}`; a request that reaches the handlers without a user gets `401 {"detail":"Not authenticated"}`.
- Handler errors use Open WebUI's shape `{"detail": "<German message>"}` with the HTTP status; messages are safe to show students and carry no internals.
- Rate limits per **API key** (not IP), fixed constants: chat route 600 requests/min, every other route 300 requests/min. Over the limit: `429` from the shared limiter (flat `{"error":…}` body).
- Scope: the surface only ever addresses KBs it created (`owui_knowledge`) and uploads it recorded (`owui_files`), owned by the key's user. Foreign and malformed ids behave as unknown ids.
- Usage: one `usage_events` row (surface `owui_compat`) per accepted chat request, with or without a collection. Chat-title requests (non-streaming, same collection) are chat requests too, so message counts include them.

## Routes

| Method + path | Purpose |
|---|---|
| `POST /owui/api/chat/completions` | chat (RAG with a collection, plain LLM without) |
| `GET /owui/api/models` | the one advertised model |
| `POST /owui/api/v1/files/` (also without trailing slash) | upload |
| `GET /owui/api/v1/files/` | list uploads |
| `GET /owui/api/v1/files/{id}` | upload status |
| `DELETE /owui/api/v1/files/{id}` | delete upload |
| `GET /owui/api/v1/files/{id}/data/content` | stub |
| `POST /owui/api/v1/knowledge/create` | create collection |
| `POST /owui/api/v1/knowledge/{id}/file/add` | index an upload in a collection |
| `POST /owui/api/v1/knowledge/{id}/file/remove` | remove an upload from a collection |
| `DELETE /owui/api/v1/knowledge/{id}/delete` | delete collection |

### `POST /owui/api/chat/completions`

Reads: `messages` (system messages are merged into the system prompt; the last user message is the question; history is capped), `stream`, `temperature` (streaming only, used when > 0), `reasoning_effort` (`low|medium|high`), `think` / `options.think` (`false` wins; `true` = `medium`), `files` (first entry with `type:"collection"` and an `id` selects the KB). Ignored: `model`, `max_tokens`, `top_p`, the penalties. Body cap 4 MiB.

- Collection set: RAG over that KB (the standard retrieval pipeline, answer language `de`). Without a collection: plain LLM call, no retrieval, no sources frame.
- Non-streaming: `200` `chat.completion` object, `choices[0].message.content` non-empty.
- Streaming: `text/event-stream`. In order: `data: {"sources":[…]}` (only when there are sources), a `chat.completion.chunk` with `delta.role`, content chunks (`delta.content`) and reasoning chunks (`delta.reasoning_content`), a final chunk with `finish_reason:"stop"`, `data: [DONE]`.
- Sources frame: one entry `{source:{type:"collection",id:<kbId>}, document:[chunk text…], metadata:[…], distances:[score…]}` holding every chunk in JustRAG's source order, so the plugin's numbering 1..n equals the answer's `[n]` markers. `metadata[i]` = `{file_id, name, source, page?, page_label?}` plus the upload's `ilias_author`, `ilias_publication_date`, `ilias_publication_year` when present. `file_id` is the upload id the plugin received; `""` for a file added in the JustRAG UI.
- Degenerate-answer guard (`chat_answer_degenerate_run_limit`) applies on both modes.
- Statuses: `400` bad JSON or no user message; `404` collection unknown or not owned; `500` preparation or generation failed (non-streaming, or before the stream opened). Once the stream has opened, an error is a **raw line** `{"detail":"…"}` followed by `data: [DONE]` (HTTP 200), not a `data: {"error":…}` frame.

### `GET /owui/api/models`

`200 {"data":[{"id":"justrag","name":"JustRAG","object":"model","created":<unix>,"owned_by":"justrag"}]}`.

### `POST /owui/api/v1/files/`

Multipart: `file` (the standard upload validation), optional `metadata` (JSON object string, at most 16 KiB; malformed metadata is dropped). The file goes into the key user's library and is reported done at once; indexing starts on `file/add`.

- `200` file object (below). `413` upload too large or library quota exhausted; other upload-validation errors keep their status; `500` storage failure.
- A file JustRAG cannot ingest (rejected by the upload check) is **recorded, not refused**: `200` with a file object, never indexed.

File object: `{id, user_id, filename, meta:{name, data:<metadata>}, data:{status:"completed"}, created_at:<unix>}`. `id` is a fresh uuid per upload (not the library file id; identical bytes uploaded twice give two ids).

### `GET /owui/api/v1/files/`

`200` array of file objects (possibly empty). Also hit by the plugin's status poll for never-uploaded items.

### `GET /owui/api/v1/files/{id}`

`200` file object. Unknown id: `200 {"id":"<id>","data":{"status":"failed"}}`. `500` on a store error.

### `DELETE /owui/api/v1/files/{id}`

`200 {"id","deleted":true}`. Unknown id: `200 {"id","deleted":false}`. The library file (and with it every KB copy) goes with the **last** upload id sharing its bytes; otherwise only KB copies reachable solely through this id go. The cascade runs **before** the upload id is dropped: if it fails, the answer is `500 {"detail"}` and the id is kept, so the plugin's next run retries (an already-removed library file counts as success). `500` also on a store error.

### `GET /owui/api/v1/files/{id}/data/content`

Always `200 {"id":"<id>","content":""}` (no flat text is kept per library file).

### `POST /owui/api/v1/knowledge/create`

Reads `name` (default `ILIAS`, at most 255 runes), `description` (at most 2000 runes). Creates a private KB owned by the key's user. `200 {"id":<kbId>,"name","description","files":[]}`; `400` bad JSON; `500`.

### `POST /owui/api/v1/knowledge/{id}/file/add`

Reads `file_id` (the upload id). Starts indexing (or an index copy) of the upload's library file in the collection. `200 {"id":<kbId>,"description":"","files":[{"id":<file_id>}]}`; an unsupported upload is linked but not indexed and answers the same. `404` collection unknown or not owned; `400` bad JSON; `500` on a handle-lookup error. A **soft failure** (unknown upload, KB full, file gone, internal error) is `200 {"detail":"Datei konnte nicht hinzugefügt werden (<reason>)."}` **without `id`**: the plugin throws on >= 400 and retries soft failures in its next run.

### `POST /owui/api/v1/knowledge/{id}/file/remove`

Reads `file_id`. Unlinks the upload; the library file stays, the KB copy goes unless another upload id in the collection still maps to it. `200 {"id":<kbId>,"description":"","files":[]}`; `404` collection; `400` bad JSON; `500`. The KB copy is deleted **before** the link is dropped: if that fails, the answer is `500 {"detail"}` and the link is kept, so the plugin retries in its next run.

### `DELETE /owui/api/v1/knowledge/{id}/delete`

`200 {"id","deleted":true}`; `404` collection; `500`. The plugin does not call it today.

## Deliberate deviations from Open WebUI

- Unknown file id: `GET` answers `200` with `data.status:"failed"`, `DELETE` answers `200` with `deleted:false` (a 404 would wedge the plugin's per-item state machine; it runs the GET before every DELETE).
- Upload status is always `"completed"` at upload time, and for an unsupported upload too: it is recorded and reported done but never indexed, so the nightly cron does not retry it forever. A file whose ingest later fails is also still reported `completed`; the operator signal is the gauge `rag_owui_kb_files_error`.
- Soft add failure: `200` without `id` (see above).
- Mid-stream errors: a raw `{"detail":…}` line, because the plugin ignores `data: {"error":…}`.
- `model`, `max_tokens`, `top_p` and the penalties are ignored; `data/content` returns an empty string.

## Observability

Counter `rag_owui_requests_total{route,outcome}` (`outcome` is one of `ok|unsupported|not_found|error`); gauge `rag_owui_kb_files_error` (KB files linked through this surface whose ingest ended in `error`; refreshed on the worker metrics tick, needs `WORKER_MAINTENANCE`).
