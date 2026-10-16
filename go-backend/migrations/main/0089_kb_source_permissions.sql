-- +goose Up
-- Per-KB source permissions: what the KB's admins let viewers (and editors)
-- do with its sources. Read by kbaccess.PGStore.GetKBByID (and the files
-- store, which delegates to it) into kbaccess.KnowledgeBase, resolved into
-- capabilities by kbaccess.CapabilitiesFor, and written through
-- PATCH /api/kb/{id} (kb.PGStore.UpdateKnowledgeBase). Admins, owners,
-- superadmins and a system admin on a public KB hold every capability
-- regardless of these columns; viewers can never add, remove or retry a
-- source, whatever they say.
--
-- viewer_see_sources       viewers may read the source lists (files, RSS,
--                          Confluence, git, crawl status).
-- viewer_select_sources    viewers may restrict a chat/research turn to
--                          chosen files (selectedFileIds / fileIds).
-- viewer_download_sources  viewers may download a source file and open the
--                          spreadsheet source preview.
-- viewer_see_citations     viewers may see the citations of an answer.
-- editor_manage_sources    edit-role members may add, change, sync, delete
--                          and retry sources.
--
-- The viewer flags default to false on every row, existing KBs included:
-- after this migration the viewers of a published public KB lose the source
-- list, downloads, file selection and citations until a KB admin turns them
-- back on. That is the decided product default, not an oversight, and it is
-- in the release upgrade notes. editor_manage_sources defaults to true, so
-- editors keep exactly what they could do before.
--
-- A constant DEFAULT on ADD COLUMN is a catalog-only change (no table
-- rewrite) since Postgres 11 (the stack ships 18), so this needs no batching
-- and holds its lock only for the catalog update.
ALTER TABLE knowledge_bases
    ADD COLUMN IF NOT EXISTS viewer_see_sources      boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS viewer_select_sources   boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS viewer_download_sources boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS viewer_see_citations    boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS editor_manage_sources   boolean NOT NULL DEFAULT true;

-- +goose Down
ALTER TABLE knowledge_bases
    DROP COLUMN IF EXISTS viewer_see_sources,
    DROP COLUMN IF EXISTS viewer_select_sources,
    DROP COLUMN IF EXISTS viewer_download_sources,
    DROP COLUMN IF EXISTS viewer_see_citations,
    DROP COLUMN IF EXISTS editor_manage_sources;
