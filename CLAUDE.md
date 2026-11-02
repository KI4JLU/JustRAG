# JustRAG

Go-first RAG application with a React frontend, PostgreSQL + pgvector, Redis, and Asynq workers.

This file is the always-loaded index. Long-form detail lives in the docs below — **read the relevant
one before changing a feature**:

| Doc | Holds |
|---|---|
| `docs/feature-reference.md` | Full entry per `site_config` namespace (defaults, ranges, eval history, metrics, gotchas), runtime-only knobs, env security detail, always-on behaviour (OpenAI-compat citations, usage ledger), document parsing / Docling / describe-image |
| `docs/kb-access.md` | KB roles + resolution ladder, per-KB source capabilities, visibility/publish/subscriptions, invite links, per-user topic filters, overview UI |
| `docs/eval-cli.md` | Every `cmd/eval` / `cmd/eval-gen` flag and mode (judge, pairwise, production-context overlays, trajectory, multi-turn, policy) |
| `go-backend/migrations/README.md` | Migration conventions + index of what each migration adds (latest: **0096**) |
| `docs/feature-recipes.md` | Enablement toggle blocks per gated feature (flag order, SQL grants, ops sequences) |
| `docs/retrieval.md` / `docs/agent-orchestration.md` | Mechanism + rationale for the retrieval pipeline / orchestrators and chat features |
| `docs/api-contracts/` | Frontend contracts (agent chat, SSE early open, user file library, owui compat, …) |
| `docs/user-error-messages.md` | Backend error `code` → translation key; mapper `web/src/utils/userErrors.ts` |
| `docs/presentation/tuning-knobs.md` | Admin-UI knob reference (ops-oriented) |
| `docs/observability/docling.md` | Docling sidecar (layout-aware PDF parsing, captioning) |
| `docs/runbooks/` | `release.md`, `migration-rollback.md`, `hnsw-reindex.md`, `spreadsheet-ingest-ops.md`, `stuck-quick-jobs.md` |

## Feature index (`site_config` namespaces)

Set in the admin Agent panel; most chat features default **off**. One line each — details in
`docs/feature-reference.md`.

**Chat**
- `chat_agent_chat_enabled` (off, per-KB) — AG-UI agent chat `POST /api/kb/{id}/agui/chat` on ADK (`internal/chat/agentchat_*.go`, `internal/adkbridge`, `internal/agui`; the last two must not import `chat`). Contract `docs/api-contracts/agent-chat.md`. Mig 0082/0083.
- `chat_sse_early_open_enabled` (off, per-KB) — opens SSE before retrieval, pings, late errors become an error frame. `internal/chat/sse_turn.go`.
- `chat_answer_history_*`, `chat_transform_followup_enabled` (both **on**, kill switches) — answer-time history; retrieval-free reformat follow-ups.
- `chat_date_awareness_enabled` (**on**), `chat_date_tools_enabled`, `chat_recency_listing_enabled` (**on**) — date injection, `recent_documents` tool, recency listing. Effective date = `COALESCE(published_at, created_at)`, defined once in `internal/vector/recency_boost.go` and mirrored byte-identically in `internal/mcp/builtin/recent_documents.go` (drift tests pin both).
- `chat_longmem_*` — per-user long-term memory.
- `chat_longcontext_*` (off) — `OrchLongContext` for global-synthesis; `_mode` default `map_reduce` (unknown value → `flat`).
- `chat_context_compression_*` (ECoRAG), `chat_sufficient_context_*` (abstention gate), `chat_citation_spans_*` (off; span-verified citations, needs `citation_validation_enabled`).
- `chat_conflict_*` (off, per-KB) — conflict/supersession surfacing; `conflicts` bare array, omitted when empty. Mig 0072.
- `chat_orchestrator_policy` (global-only, `[]`) — ordered routing rules evaluated before the flag ladder; validated at save time (`internal/chatpolicy`). Mig 0073.
- `chat_answer_tools_by_route` (global-only, `{}`) — per-route answer-tool allowlists, enforced at catalog AND dispatch; an unclassified turn gets no tools once any route is configured.
- `chat_web_search_enabled` (global-only, off) — per-turn `webSearch` opt-in.
- `chat_sql_query_enabled` (global-only, off) — `sql_query` tool; **not a security boundary** (see Local dev setup).
- `chat_answer_degenerate_run_limit` (global-only, 400 runes, `0` = off) — guard against degenerate repeated output on every answer surface. `internal/chat/degenerate_guard.go`.
- `chat_compare_*` (off) — in-chat single-file comparison (`internal/chatattach`).
- `chat_condense_keep_raw_enabled` (off — stays off, measured no gain).
- `chat_tabular_*`, `tabular_*` — spreadsheet Q&A: typed SQL tables + hybrid text, tabular router (`chat_tabular_router_enabled` **on**), AST SQL validator. Needs `JUSTRAG_DB_URL_READONLY` grants. Runbook `docs/runbooks/spreadsheet-ingest-ops.md`.
- Roles and rules (no gate) — a KB's answer prompt is compiled from `knowledge_bases.behavior`: role prompt, then "Regeln:" with the active rules, then the fixed RAG instructions; `behavior IS NULL` = the old `system_prompt` byte for byte. `roleId` on `POST /api/kb/{id}/chat` starts a chat in another role (`chats.role_id`). Every surface reads the prompt through `kbbehavior.SystemPrompt`. The template roles live in `role_templates`, seeded from the code's roles. Mig 0092, 0095. `internal/kbbehavior`.
- Start page (no gate) — `GET`/`PUT /api/kb/{id}/start-page`: role entries (start a chat in a role), fixed or dynamic starter questions, input or upload-only start. One catalog category per KB with a fixed `color_slot`. Mig 0093. `internal/kbstartpage`.
- Assistant settings (no gate) — `PUT /api/kb/{id}/assistant-settings` saves title, description, category, behavior and start page in one transaction and writes a version (`kb_settings_versions`, baseline + save + restore, nothing overwritten); restore via `…/versions/{n}/restore`. Mig 0094. `internal/kbassistant`.
- `chat_attachments_*` (no gate, global-only) — composer attachments as context (`user_files.scope='chat'`). Mig 0090. `internal/chat/attachments*.go`.
- `owui_compat_enabled` (global-only, off) — Open WebUI surface `/owui` for the ILIAS plugin. Mig 0088. Contract `docs/api-contracts/owui-compat.md`.
- `mcp_server_enabled` (off) — KB as MCP server (`ask_kb`). `internal/mcpserver`.

**Retrieval**
- `crag_*`, `adaptive_routing_*`, `query_decompose_*`, `step_back_*`, `mmr_*`, `rerank_blend_alpha*`, `top_n_*`, `rerank_candidate_depth*`, `query_cache_*`, `hybrid_dynamic_alpha_*`, `recency_*`.
- `bm25_simple_arm_enabled`, `bm25_scoring_mode` (`ts_rank` default | `bm25`, per-KB) + `bm25_k1`/`bm25_b`. Flipping the mode in prod needs a `queryCacheSchemaVersion` bump or query-cache clear.
- `kg_*`, `chat_graph_routing_*`, `kg_canonicalization_*`, `kg_communities_*`, `chat_community_search_*`, `chat_drift_*` — knowledge graph, communities, DRIFT.

**Ingestion & sources**
- `contextual_enrichment*`, `parent_child_*`, `late_chunking_*`, `raptor_*`, `hype_*`, `docling_*`, `embedding_batch_size`, `ingest_enrich_concurrency`, `kg_extraction_concurrency`.
- `ingest_screening_*` (**on**) — prompt-injection screening; a flag, never a filter. Rule names are a persisted contract.
- `sync_window_*` + per-source `sync_schedule` — nightly sync sweeper (`internal/syncsched`); also fires scheduled evals.
- `rss_wid_enrichment_enabled` (**on**), `git_repo_enabled` (off).
- **User file library** (no gate) — `user_files`, `/api/library/...`, index copy reuse, library chat, adoption, orphan sweep. **Only `cascade.DeleteUserFile` may delete a blob of a row with `user_file_id`.** Bump `parseCacheVersion` on parser output changes, `fingerprintVersion` on index-shaping changes, `prompts.KGPromptVersion` on KG prompt changes. Contract `docs/api-contracts/user-file-library.md`.

**Agents, validation, ops**
- **User-created agents & teams** (no gate) — `agents_allow_privileged_tools` (off) gates `code_exec`/`sql_query`/`web_search`. `internal/agentteams`.
- `ragas_*`, `factcheck_*`, `citation_validation_*`, `langfuse_*` — validation + observability (RAGAS samples persisted, mig 0072).
- `kb_stale_days` (global-only, 180) — freshness surface on the admin KB overview.
- `model_tier_fast` — see Model tier resolution.

**Runtime-only knobs:** `hnsw.iterative_scan = relaxed_order` (set per pool connection), env `AI_MAX_CONCURRENT_REQUESTS` (caps unary model-provider requests per endpoint).

**When adding a global-only `site_config` key:** add a save-time validator if it has a range, and check `ignoredKeys` in `internal/pipeline/coverage_test.go`.

**When adding a setting to a settings window (admin, user, KB):** put its label key in `web/src/components/admin/adminSearchKeywords.ts` (Agent rows: `agentSections.ts`) so the admin dialog search finds it; `src/components/settingsSearchKeywords.test.ts` fails otherwise. Same for the user settings (`userSettingsSearchKeywords.ts`) and KB settings (`kbSettings/kbSettingsSearchKeywords.ts`); a new section file goes into that test's `DIALOGS`.

## KB access (summary — full model in `docs/kb-access.md`)

- Four roles `view < edit < admin < owner`. `kb_members` is the **sole authority**; `knowledge_bases.user_id` is a trigger-maintained mirror — never write it.
- Resolution: `kbaccess.EffectiveRole` (only ladder), `kbaccess.RequireKBRole(min)` (only route gate). SQL mirrors `kbaccess.VisibleKBsCTE` and `kbaccess.SeeSourcesSQL` must change in the same commit as the Go logic (parity test `TestVisibilityAgreesWithEffectiveRole`).
- Per-KB source permissions: `kbaccess.CapabilitiesFor` → `seeSources`, `addSources`, `downloadSources`, `seeCitations`, `manageSources` (mig 0089). `seeCitations` is enforced on output only.
- `visibility` (`private`|`public`) is the truth; `is_global` is a generated column no Go code reads. Public KBs have no owner; publishing is staged (`is_published=false`).

## Commands

### Go backend

```bash
cd go-backend
go build ./cmd/server ./cmd/worker ./cmd/migrate ./cmd/eval ./cmd/eval-gen
go run ./cmd/migrate                # apply pending migrations (idempotent, up-only)
go run ./cmd/migrate --status       # applied version per DB (main + vector)
go run ./cmd/server                 # HTTP server on :3000
go run ./cmd/worker                 # Asynq worker
go test ./...                       # add -race for the race detector
go test ./internal/chat -run TestNeedsGraphTraversal -v
./cmd/eval/eval --golden ../eval/golden/<set>.jsonl [--production-context] [--judge]
./cmd/eval-gen --kb-id <uuid>       # draft golden set from a KB's chunks
```

All eval flags: `docs/eval-cli.md`. PGO-ready: drop a prod CPU profile at `go-backend/cmd/server/default.pgo` (none committed).

### Frontend (`web/`)

- `npm run web` (from root), `cd web && npm run build | test | lint`
- Type-check with `tsc -b` (`tsc --noEmit` is a no-op here).
- Design-system dev loop: `cd web && npm run dev:ds` (sibling `../../JLU-Design-System`) or `DS_LOCAL=<path> npm run dev` — resolves the DS source in the dev server only; builds still use the pinned tag, so bump the pin before merging DS-dependent work.

### Root workspace / Docker

- `npm install`, `npm run build`, `npm test`
- `docker compose up -d` (applies migrations via the one-shot `migrate` service; runs the prebuilt image)
- `docker compose -f docker-compose.local.yml up --build` — build the Go image from source
- `-f docker-compose.production.yml`, `docker-compose.k8s.yml` (no worker), `-f docker-compose.docling.yml` (Docling sidecar)

## Releases

Full procedure: `docs/runbooks/release.md`; team workflow: `CONTRIBUTING.md`.

- `development` takes direct pushes; `main` is protected — PRs only, CI green, **merge commits only**. Never push to `main`.
- CalVer `vYY.M.N` (month without leading zero) via annotated tags; `scripts/next-version.sh` prints the next one. Risk lives only in the `⚠ Upgrade notes` block of `CHANGELOG.md` (git-cliff + hand-written notes).
- Images: `development` → `:development`, `main` → `:edge`, RC → `:vYY.M.N-rc.K`; prod runs `:stable` (promote = deploy). `:latest` is deliberately not published.
- A migration is final once it reached staging. k8s does **not** migrate on deploy — run `/app/migrate` first.

## Local dev setup

Env (via `.env`):

- **Postgres:** `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`; `VECTOR_DB_*` (defaults to `DB_*`).
- **Read-only pool:** `JUSTRAG_DB_URL_READONLY` — SELECT-only role for `sql_query` / `table_query`; required when `chat_tabular_query_enabled`. ⚠ `sql_query`'s validator is bypassable (`query_to_xml`), so with `chat_sql_query_enabled` on, any chat user can read everything this role can SELECT, cross-user and cross-KB.
- **Redis:** `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`. Non-compose deployments need `--maxmemory <size> --maxmemory-policy volatile-lru` (not `allkeys-lru`, not `noeviction`).
- **Auth:** `JWT_SECRET` (≥32 chars), `ALLOWED_ORIGINS` (required in production; set it on staging too), `AUTH_PROVIDER_SECRET_KEY` (encrypts OIDC/LDAP secrets). Login providers are superadmin-only.
- **Storage:** `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION` (else local disk).
- **Worker:** `WORKER_QUEUES`, `WORKER_MAINTENANCE` (maintenance loops, metrics ticks and sweeps need it).
- **Tracing:** `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_HEADERS`.

Details: `docs/feature-reference.md` § Environment variables.

## Architecture

- `go-backend/` (Go-only runtime; entrypoints `cmd/server`, `cmd/worker`, `cmd/migrate`; wiring `internal/app/`; config `internal/config/`; migrations `migrations/main/` + `migrations/vector/`), `web/` (React 19 + Vite 7, built into `web/dist`; TanStack Router — every view and chat is a URL (`/kb/<id>`, `/c/<chat>`, ids as 22-char base64url via `routing/shortId.ts`), table in `web/src/routing/routes.ts`; dialogs live in URL parameters `?admin=`, `?settings=`, `?topic=` via `web/src/routing/urlDialog.ts`).
- Storage: main Postgres, vector Postgres (dim-keyed tables `document_chunks_<dim>`; switching the embedder needs a re-ingest), Redis, filesystem or S3.

### Internal package map (`go-backend/internal/`)

| Cluster | Packages |
|---|---|
| Wire / HTTP | `app`, `httputil`, `middleware`, `auth`, `authhandler`, `apikeyauth`, `sserelay`, `requestid` |
| Chat orchestration | `chat` (orchestrators, trajectory, gates, post-response), `chatpolicy`, `kbbehavior` (roles, rules, the compiled KB prompt), `kbstartpage`, `kbassistant` (combined settings save + versions), `agents`, `agentteams`, `prompts`, `longmem`, `chatattach`, `recencylister` (adapter to avoid a `chat`↔`mcp/builtin` cycle), `adkbridge`, `agui` |
| Retrieval / ingest | `vector`, `ai`, `splitter`, `processor` (incl. KG write path), `parser` (+ `parser/docling`), `pptx`, `sheetsource`, `tabular` (+ `profile`, `render`, `ingest`, `sqlcheck`, `sqlexec`), `promptsafety` |
| Tools (MCP) | `mcp`, `mcp/builtin`, `sessionmem`, `aibudget` |
| Knowledge graph | `kg` (read path), `kggraph`, `kgevents`, `canonicalize`, `community` |
| Storage / data | `database`, `store`, `storage`, `pgxutil`, `files`, `userfiles`, `uploadcheck`, `libpaths`, `kbaccess`, `kbvisibility`, `kbsubs`, `kbcategories`, `kbfilters`, `kbmembers`, `kbinvites`, `kbconfig`, `memory`, `cascade` |
| Search | `globalsearch` |
| Admin | `adminagentmetrics`, `adminconfigs`, `adminfeedback`, `admineval`, `adminglobalkbs`, `adminkboverview`, `adminmaintenance`, `adminmcp`, `adminproviders`, `adminusers`, `kb`, `users`, `apikeys`, `auditlogs` |
| Eval / observability | `eval`, `observability`, `logctx`, `analytics`, `health`, `systemhealth`, `apidocs`, `usage`, `ragassamples`, `feedback`, `pipeline` |
| Background workers | `worker`, `jobs`, `syncsched`, `syncwindow`, `fetcher`, `crawler`, `rss`, `widcert`, `research`, `confluence`, `gitrepo`, `academic`, `gencontent`, `contentgen` |
| External surfaces | `publicapi`, `openaicompat`, `owuicompat`, `mcpserver` |
| Misc | `config`, `migrate`, `siteconfig`, `publicconfigs`, `proxy`, `httpclient`, `redisclient`, `safego`, `misc`, `websearch`, `redact` |

## Agentic chat orchestration

Streaming `complex_reasoning` turns dispatch through the first orchestrator whose flag is on; the default runs the legacy 2-step `RunDeepChat`. Explicit agent/team selection and in-chat comparison come first; `chat_orchestrator_policy` rules come before the ladder.

| # | Orchestrator | Flag |
|---|---|---|
| 0 | DRIFT (global-synthesis) | `chat_drift_enabled` |
| 1 | Long-context (global-synthesis) | `chat_longcontext_enabled` |
| 2 | Supervisor | `chat_supervisor_enabled` |
| 3 | Plan-and-Execute | `chat_plan_execute_enabled` (+ `_dag`, `_dag_iterative`, `_tool_aware`) |
| 4 | Agentic | `chat_agentic_enabled` |
| 5 | Standard `PrepareChatContext` | always-on fallback |

`internal/eval.SelectOrchestrator` mirrors this ladder — keep them in sync, and every orchestrator must set `FinalChunks`.

## Model tier resolution

Fast-tier tasks (graders, extractors, classifiers, condense, follow-ups, verifiers, …) resolve their model as: per-task `*_model` key → `model_tier_fast` → KB chat model, via `chat.ResolveFastTierModel(ctx, reader, perTaskKey)`. Answer generation and planning use the KB chat model directly. Fast-tier JSON calls use strict `json_schema` structured outputs with auto-downgrade (`ai.GenerateCompletionStructured`). A call that decodes a JSON object goes through `ai.CompleteStructuredJSON`: it asks once more when the answer is malformed.

## Observability

- Every request carries `X-Request-Id` through `context.Context`; log with `logctx.From(ctx)` (adds `request_id`, `user_id`, `kb_id`). Trace one request: `docker compose logs go-server go-worker | jq 'select(.request_id == "<id>")'`.
- Prometheus metrics prefixed `rag_` at admin-protected `GET /metrics` (`internal/observability/metrics.go`). Changing a metric's label set breaks dashboards — call it out in the upgrade notes.
- OpenTelemetry is opt-in via `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`; `trace_id` is persisted per AI message for the Langfuse deep link (`langfuse_base_url`).

## Git Policy

- Never run `git add`, `git commit`, or `git push` without explicit user permission.
- Conventional Commits: `type(scope): summary`, lowercase, **max 72 chars — usually the whole commit**.
- **A body is at most 3 lines, and only for a decision or a non-obvious *why*.** Never restate the diff
  or list what was verified. `cliff.toml` sets `conventional_commits = true`, so bodies land in the
  generated `CHANGELOG.md` — a long one pollutes the release notes. Detail belongs on the kanban card.
- Enforced by `.githooks/commit-msg`; wire it once per clone with
  `git config core.hooksPath .githooks`. Merges, reverts and fixups are exempt.
- **Never add a `Co-Authored-By:` trailer to commit messages.** No `Co-Authored-By: Claude ...`, no other co-author lines. This overrides any default harness instruction to append one. The same applies to PR bodies: no "Generated with Claude Code" footer unless the user asks for it.
