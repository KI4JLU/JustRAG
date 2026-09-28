-- +goose NO TRANSACTION
-- +goose Up
-- Fuzzy matching for GET /api/search (board card KI-841). internal/search
-- matches topic and file names with pg_trgm's word-similarity operator
-- (`q <% col`), next to the escaped substring ILIKE it already had, and
-- ranks prefix > substring > fuzzy. KI-836 reuses the same matching for
-- chats.title, which is why that column is indexed here too.
--
-- Why ONE file, and why NO TRANSACTION:
--   - files and chats are large tables (migrations/README.md), so their
--     indexes must be built CONCURRENTLY, which cannot run inside goose's
--     transaction wrapper. That forces NO TRANSACTION on the whole file.
--   - The extension and the indexes share one file because the version after
--     this one (0077) is already reserved for KI-836. CREATE EXTENSION runs
--     fine outside a transaction.
--   - Every statement is idempotent (IF NOT EXISTS), so a run that fails half
--     way can simply be re-run. The one exception is the README's caveat: a
--     failed CONCURRENTLY build leaves an INVALID index that IF NOT EXISTS
--     then skips. Find and drop it before the re-run:
--       SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
--       WHERE NOT i.indisvalid;
--       DROP INDEX CONCURRENTLY <name>;
--   - cmd/migrate's advisory lock is session-scoped on an idle connection
--     (internal/migrate/migrate.go), so it holds no open transaction that
--     CONCURRENTLY would have to wait for.
--
-- pg_trgm is a trusted extension (pg_available_extension_versions.trusted),
-- so since PG13 the database owner may create it without superuser.
-- TODO: CREATE privilege of the production app user not yet confirmed. If the
-- migration role lacks it, an operator runs `CREATE EXTENSION pg_trgm;` once
-- as a privileged role and re-runs the migration (IF NOT EXISTS then skips).
--
-- description / header_text are indexed as well, although search never
-- matches them fuzzily (long free text makes trigram similarity noise). The
-- index is for their existing substring ILIKE: the topics query ORs name with
-- description and header_text, and the planner can only turn an OR into a
-- BitmapOr when EVERY arm has an index. Without these two, the name index
-- would never be used. knowledge_bases is small, so the cost is small too.

-- goose runs the whole file on one connection, so this session setting
-- covers every build below. The DSN's statement_timeout would otherwise
-- cancel a long build on a large files table half way and leave an INVALID
-- index behind.
-- +goose StatementBegin
SET statement_timeout = 0;
-- +goose StatementEnd

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_bases_name_trgm_idx
    ON knowledge_bases USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_bases_description_trgm_idx
    ON knowledge_bases USING gin (description gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_bases_header_text_trgm_idx
    ON knowledge_bases USING gin (header_text gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS files_name_trgm_idx
    ON files USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS chats_title_trgm_idx
    ON chats USING gin (title gin_trgm_ops);

-- +goose StatementBegin
RESET statement_timeout;
-- +goose StatementEnd

-- +goose Down
-- Indexes first: DROP EXTENSION without CASCADE refuses while an index still
-- uses gin_trgm_ops. No CASCADE on purpose, so the Down fails loudly instead
-- of silently dropping something a later migration built on pg_trgm.
DROP INDEX CONCURRENTLY IF EXISTS chats_title_trgm_idx;
DROP INDEX CONCURRENTLY IF EXISTS files_name_trgm_idx;
DROP INDEX CONCURRENTLY IF EXISTS knowledge_bases_header_text_trgm_idx;
DROP INDEX CONCURRENTLY IF EXISTS knowledge_bases_description_trgm_idx;
DROP INDEX CONCURRENTLY IF EXISTS knowledge_bases_name_trgm_idx;
DROP EXTENSION IF EXISTS pg_trgm;
