-- +goose Up
-- Per-KB preview permission: a KB admin can let viewers and editors open a
-- source file in the in-app preview (PDF, media, document text, spreadsheet
-- tables) without offering them the download. Read by
-- kbaccess.PGStore.GetKBByID and kb.PGStore into kbaccess.SourcePermissions,
-- resolved by kbaccess.CapabilitiesFor into the previewSources capability,
-- and written through PATCH /api/kb/{id}.
--
-- previewSources = *_see_sources AND (*_preview_sources OR
-- *_download_sources): the download flag (migration 0089) includes the
-- preview, so every role that could open the preview before keeps it and no
-- row needs a backfill.
--
-- This is no protection for confidential material: the preview still hands
-- the file to the browser, where developer tools can save it. It only keeps
-- the download out of the UI.
--
-- viewer_preview_sources defaults to false on every row, existing KBs
-- included, so nothing changes for viewers until a KB admin turns it on.
-- editor_preview_sources defaults to true like the other editor flags; while
-- editor_download_sources is on it changes nothing.
--
-- A constant DEFAULT on ADD COLUMN is a catalog-only change (no table
-- rewrite) since Postgres 11, as in 0089.
ALTER TABLE knowledge_bases
    ADD COLUMN IF NOT EXISTS viewer_preview_sources boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS editor_preview_sources boolean NOT NULL DEFAULT true;

-- +goose Down
ALTER TABLE knowledge_bases
    DROP COLUMN IF EXISTS viewer_preview_sources,
    DROP COLUMN IF EXISTS editor_preview_sources;
