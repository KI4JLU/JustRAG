-- +goose Up
-- Per-KB source permissions: what the KB's admins let viewers and editors do
-- with its sources. Read by kbaccess.PGStore.GetKBByID (and the files store,
-- which delegates to it) into kbaccess.KnowledgeBase, resolved into
-- capabilities by kbaccess.CapabilitiesFor, and written through
-- PATCH /api/kb/{id} (kb.PGStore.UpdateKnowledgeBase). Admins, owners,
-- superadmins and a system admin on a public KB hold every capability
-- regardless of these columns. Changing, syncing, deleting and retrying
-- sources is not a flag: it stays with the edit role and above, and viewers
-- never have it. Restricting a chat or research turn to chosen files is not
-- a permission at all.
--
-- The viewer_* columns govern the view role, the editor_* columns the edit
-- role:
--
-- *_see_sources        read the source lists (files, RSS, Confluence, git,
--                      crawl status) and find files in the header search.
-- editor_add_sources   add sources: upload, text, URL, crawl, add from the
--                      library, create an RSS / Confluence / git source, add
--                      academic papers, and the agent chat's KB-writing
--                      actions. There is no viewer column: a viewer who could
--                      add sources would be an editor, so viewers never add.
-- *_download_sources   download a source file and open the spreadsheet
--                      source preview.
-- *_see_citations      see the citations of an answer.
--
-- Downloading, adding and changing sources all require *_see_sources too;
-- kbaccess.CapabilitiesFor applies that.
--
-- The viewer flags default to false on every row, existing KBs included:
-- after this migration the viewers of a published public KB lose the source
-- list, downloads and citations until a KB admin turns them back on. That is
-- the decided product default, not an oversight, and it is in the release
-- upgrade notes. The editor flags default to true, so editors keep exactly
-- what they could do before.
--
-- A constant DEFAULT on ADD COLUMN is a catalog-only change (no table
-- rewrite) since Postgres 11 (the stack ships 18), so this needs no batching
-- and holds its lock only for the catalog update.
ALTER TABLE knowledge_bases
    ADD COLUMN IF NOT EXISTS viewer_see_sources      boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS viewer_download_sources boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS viewer_see_citations    boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS editor_see_sources      boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS editor_add_sources      boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS editor_download_sources boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS editor_see_citations    boolean NOT NULL DEFAULT true;

-- +goose Down
ALTER TABLE knowledge_bases
    DROP COLUMN IF EXISTS viewer_see_sources,
    DROP COLUMN IF EXISTS viewer_download_sources,
    DROP COLUMN IF EXISTS viewer_see_citations,
    DROP COLUMN IF EXISTS editor_see_sources,
    DROP COLUMN IF EXISTS editor_add_sources,
    DROP COLUMN IF EXISTS editor_download_sources,
    DROP COLUMN IF EXISTS editor_see_citations;
