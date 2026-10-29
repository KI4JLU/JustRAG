# Migrations

Two independent goose trees:

- `main/` — the application database (users, KBs, files, messages, chats, KG, agents, …)
- `vector/` — the dim-keyed chunk tables (`document_chunks_2560`, `document_chunks_4096`, …)

`cmd/migrate` applies both; on a single-DB deployment it deliberately skips the
vector tree. Runs are serialized across replicas by a `pg_advisory_lock`, and
migrations are **up-only by design** — see `docs/runbooks/migration-rollback.md`
for the goose-CLI escape hatch when a rollback is genuinely required.

## Conventions

- **Numbered sequentially**, never renumbered once merged.
- **Idempotent**: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`. A re-run of an applied migration must be a no-op.
- **Comment the intent**, not the syntax — say what the column is for and which
  code path reads it.

## Adding an index to an already-large table

Goose wraps each migration in a transaction, and a plain `CREATE INDEX` takes a
`SHARE` lock that **blocks every write to the table for the duration of the
build**. On a small or brand-new table that is invisible. On a table that is
already large in production it is a write stall in the middle of a deploy.

Treat these as large and always index them concurrently:

| Table | Why it grows |
|---|---|
| `document_chunks_*` (vector tree) | one row per chunk per ingested file |
| `files` | one row per ingested document; RSS/Confluence/git sources add continuously |
| `messages` | one row per chat turn |
| `kg_entities` / `kg_edges` | knowledge-graph extraction fans out per chunk |
| `message_chunks` | answer→chunk links, one row per cited chunk per answer |
| `agent_decisions` | one row per orchestrator decision |

`CREATE INDEX CONCURRENTLY` cannot run inside a transaction, so the migration
must opt out of goose's wrapper with the `NO TRANSACTION` directive on the very
first line (`vector/0009_mrl_backfill.sql` is an existing example of the
directive, used there for batched `COMMIT`s):

```sql
-- +goose NO TRANSACTION
-- +goose Up

-- Concurrent build: `files` is large in every production deployment, and a
-- plain CREATE INDEX would hold a SHARE lock — blocking ingest writes — for
-- the whole build. CONCURRENTLY trades a second table scan for no write lock.
CREATE INDEX CONCURRENTLY IF NOT EXISTS files_some_column_idx
    ON files (some_column);
```

Two consequences of `NO TRANSACTION` worth knowing before you use it:

1. **No automatic rollback.** If the migration contains several statements and
   one fails, the earlier ones stay applied. Keep such migrations to a single
   index build where possible.
2. **A failed concurrent build leaves an `INVALID` index behind.** It is not
   used by the planner but still costs write overhead. Detect and clean up:

   ```sql
   SELECT c.relname
   FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE NOT i.indisvalid;

   DROP INDEX CONCURRENTLY <name>;   -- then re-run the migration
   ```

   The `IF NOT EXISTS` in the migration makes the re-run safe.

For a new table created in the same migration, keep the plain in-transaction
`CREATE INDEX` — the table is empty and nothing else can be writing to it yet.

## Migration index (main DB)

What each notable migration adds. Keep this table current when adding one.

| # | Adds |
|---|---|
| 0007 | `content_hash` (cross-file ingest dedup until user-file-library phase 0; now within-batch only) |
| 0008 | `contextual_prefix` column (Anthropic-style enrichment) |
| 0042 | `agent_decisions` (admin metrics panel) |
| 0043 | `agent_decisions.tool_calls JSONB` (tool-mix telemetry) |
| 0044 | `kg_entities` + `kg_edges` (knowledge-graph extraction) |
| 0045 | `user_memory` (long-term per-user memory) |
| 0046 | `node_kind`, `tree_level`, `raptor_parent_id` (RAPTOR hierarchical indexing) |
| 0047 | `users.external_id` + unique partial index (OIDC `sub` linkage; legacy LDAP rows stay NULL) |
| 0048 | tabular schema + `tabular_catalog` (structured spreadsheet Q&A) |
| 0049 | `eval_golden_set_jobs` (async corpus → golden-set generation status) |
| 0052 | `message_chunks` (answer→chunk links for the online feedback loop) |
| 0054 | `files.error_stage` + `error_message` (ingestion error visibility + per-file/per-KB retry) |
| 0059 | `kg_communities` (GraphRAG community detection) |
| 0060 | `git_repo_sources` + `files.git_repo_source_id`/`git_file_path`/`git_blob_sha` (git repository ingestion) |
| 0064 | `kb_members` (four KB roles) + owner-mirror trigger; also **renames** `pending_kb_invites.permission` → `role` and widens its CHECK to allow `admin` |
| 0065 | `knowledge_bases.visibility` + `auto_subscribe`, `is_global` becomes a generated column; `kb_subscriptions`, `kb_categories`, `kb_category_links` |
| 0066 | `usage_events` (per-turn usage ledger across web / api_v1 / openai_compat / mcp) + backfill of historical web turns |
| 0067 | `kb_invite_links` (permanent, revocable KB invite links carrying a role) |
| 0068 | `sync_schedule` + `next_sync_at` on `rss_feeds` / `confluence_sources` / `git_repo_sources` (night-window sync scheduling; `poll_interval` / `sync_interval` left unread for a later cleanup release) |
| 0069 | `tabular_catalog` v2 columns (`sheet_index`, `region_index`, `sheet_kind`, `hidden`, `header_row`, `profile`, `column_stats`, `coercion_stats`) + `tabular_column_values` + `tabular_query_log` + `files.parse_report`/`stage_detail` (2026-09-04 spreadsheet-ingest rework, Phase 2) |
| 0070 | `eval_golden_sets.schedule`/`next_run_at` + `eval_runs.scheduled` (scheduled in-app eval runs) |
| 0071 | `files.published_at` (RSS + Confluence pages + git, **no backfill**) + `last_success_at` on `rss_feeds` / `confluence_sources` / `git_repo_sources` (freshness surface; four `ADD COLUMN IF NOT EXISTS`, no index) |
| 0072 | `ragas_samples` (+ a `(kb_id, sampled_at DESC)` index) + `messages.conflicts jsonb` + `files.injection_flag`/`injection_detail` (Wave-5 trust surfaces; one file, **no backfill**, no index on a pre-existing table) |
| 0073 | `agent_decisions.policy_rule` smallint (Wave 6, W6-R6 — which `chat_orchestrator_policy` rule, if any, pinned the turn's orchestrator; nullable, idempotent `ADD COLUMN IF NOT EXISTS`, **no backfill**) |
| 0075 | `files.uploaded_by` (uuid → users, `ON DELETE SET NULL`, **no backfill**, no index) — who added the file; exposed as `uploadedBy` on `GET /api/kb/{id}/files` for KB role ≥ edit |
| 0076 | `user_files` (per-user library, `UNIQUE (owner_user_id, sha256)`) + `users.file_quota_bytes` + `files.user_file_id` (both FKs `ON DELETE RESTRICT`; user-file library phase 1) |
| 0077 | `files_user_file_kb_uidx` — unique partial index `files(user_file_id, kb_id)`, `NO TRANSACTION` + `CREATE INDEX CONCURRENTLY` |
| 0078 | `files_uploaded_by_idx` — partial index `files(uploaded_by)`, `NO TRANSACTION` + `CREATE INDEX CONCURRENTLY` |
| 0079 | `files.index_fingerprint text NULL` (user-file library phase 2; no index, no backfill) |
| 0080 | `kg_extraction_cache` (per-library-file raw KG extraction output; `user_file_id` FK `ON DELETE CASCADE`; no backfill) |
| 0081 | `chats.kb_id` DROP NOT NULL + `chat_file_refs` (library chat file selection; `ON DELETE CASCADE` both FKs); Down deletes all `kb_id IS NULL` chats (user file library phase 3) |
| 0082 | `adk_sessions` / `adk_events` / `adk_app_states` / `adk_user_states` (ADK bridge session store; used by the agent chat since Phase 2) |
| 0083 | `agent_runs` (ADK/AG-UI run lifecycle, one open interrupt per thread, 24 h interrupt expiry; used by the agent chat since Phase 2) |
| 0084 | `pg_trgm` extension + GIN trigram indexes on `knowledge_bases.name`/`description`/`header_text`, `files.name`, `chats.title` (global search, fuzzy matching; `NO TRANSACTION`, `CONCURRENTLY`). **Needs the CREATE privilege on the database** for `CREATE EXTENSION pg_trgm` (trusted extension, no superuser) — else an operator creates the extension once and re-runs. Run a **single** `cmd/migrate`: a second one waiting on the advisory lock deadlocks against the concurrent build and is aborted |
| 0085 | `messages_content_fts_idx`, a GIN expression index on `to_tsvector('simple', left(content, 100000))` (global search, message full text; `NO TRANSACTION`, `CONCURRENTLY`; `internal/globalsearch` repeats the expression exactly) |
| 0086 | `kb_favorites`, `kb_user_categories`, `kb_user_category_links` (per-user topic filters; no backfill, three new tables only) |
| 0087 | `kb_invite_link_redemptions` (one row per invite link and person; `redemption_count` now counts people, not visits; no backfill) |
| 0088 | `owui_knowledge`, `owui_files`, `owui_knowledge_files` + usage surface `owui_compat` (ILIAS Open WebUI surface; no backfill) |
| 0089 | `knowledge_bases.viewer_see_sources` / `viewer_download_sources` / `viewer_see_citations` (default **false**) + `editor_see_sources` / `editor_add_sources` / `editor_download_sources` / `editor_see_citations` (default **true**) — per-KB source permissions; the defaults apply to existing KBs too (viewers of published global KBs lose source list, downloads and citations until a KB admin re-enables them — release upgrade note); catalog-only `ADD COLUMN`, no backfill, no index |
| 0090 | `user_files.scope` (`library` \| `chat`, default `library`; catalog-only) + `message_attachments(message_id, user_file_id, position)` (both FKs `ON DELETE CASCADE`) + `ai_models.context_window` (nullable) — chat attachments as context; no backfill |
| 0091 | `chats.branched_from_chat_id` (nullable uuid, no FK, catalog-only) — the chat a branch was copied from (`POST /api/chats/{id}/branch`); no backfill |
| 0092 | `knowledge_bases.behavior` (jsonb, NULL = not customized: the KB answers from `system_prompt` byte for byte) + `chats.role_id` (text, no FK — the role a chat was started in) — roles and rules (`internal/kbbehavior`); `system_prompt` stays the storage of the legacy role's prompt; catalog-only `ADD COLUMN`s, no backfill |
| 0093 | `knowledge_bases.start_page` (jsonb, NULL = default start page; `internal/kbstartpage`) + `kb_categories.color_slot` (smallint, CHECK 1–9; existing categories backfilled in display order — a handful of rows) |
| 0094 | `kb_settings_versions` (new table): version history of the assistant settings — full snapshot + field changes per save/restore, `UNIQUE (kb_id, number)`, newest 200 kept per KB (`internal/kbassistant`) |
| 0095 | `role_templates` (new table): the catalog's template roles, curated in „Vorlagen" › Rollen — texts de/en, icon, cover gradient, `disabled`, one `is_default` (partial unique index); empty until the first server/worker seeds it from the code's roles (`internal/kbbehavior`) |
