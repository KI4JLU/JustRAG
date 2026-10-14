-- +goose Up
-- Open WebUI compatibility surface for the ILIAS LfAssistant plugin
-- (internal/owuicompat). Three small tables over existing machinery; no
-- backfill, no index on a pre-existing table.

-- One row per knowledge collection the plugin created. The KB itself is a
-- normal private KB owned by the service user; this row is what scopes the
-- surface to the KBs it created (it never addresses any other KB).
CREATE TABLE IF NOT EXISTS owui_knowledge (
    kb_id         uuid PRIMARY KEY REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owui_knowledge_owner_idx ON owui_knowledge (owner_user_id);

-- One row per upload: the "Open WebUI file id" the plugin stores. Not the
-- user_files id, because the library dedups identical bytes per owner and
-- the plugin needs one independent id per upload. user_file_id is NULL for
-- an unsupported upload (no blob stored).
CREATE TABLE IF NOT EXISTS owui_files (
    id            uuid PRIMARY KEY,
    owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_file_id  uuid REFERENCES user_files(id) ON DELETE SET NULL,
    filename      text NOT NULL,
    metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
    unsupported   boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owui_files_owner_idx ON owui_files (owner_user_id);
CREATE INDEX IF NOT EXISTS owui_files_user_file_idx ON owui_files (user_file_id);

-- Which upload is in which collection, and which KB files row indexes it.
-- file_id is NULL for an unsupported upload. Two handles with identical
-- bytes in one KB share one files row (UNIQUE (user_file_id, kb_id)).
CREATE TABLE IF NOT EXISTS owui_knowledge_files (
    kb_id        uuid NOT NULL REFERENCES owui_knowledge(kb_id) ON DELETE CASCADE,
    owui_file_id uuid NOT NULL REFERENCES owui_files(id) ON DELETE CASCADE,
    file_id      uuid REFERENCES files(id) ON DELETE SET NULL,
    PRIMARY KEY (kb_id, owui_file_id)
);
CREATE INDEX IF NOT EXISTS owui_knowledge_files_file_idx ON owui_knowledge_files (file_id);
CREATE INDEX IF NOT EXISTS owui_knowledge_files_handle_idx ON owui_knowledge_files (owui_file_id);

ALTER TABLE usage_events DROP CONSTRAINT IF EXISTS usage_events_surface_check;
ALTER TABLE usage_events
    ADD CONSTRAINT usage_events_surface_check
    CHECK (surface IN ('web','api_v1','openai_compat','mcp','owui_compat'));

-- +goose Down
DELETE FROM usage_events WHERE surface = 'owui_compat';
ALTER TABLE usage_events DROP CONSTRAINT IF EXISTS usage_events_surface_check;
ALTER TABLE usage_events
    ADD CONSTRAINT usage_events_surface_check
    CHECK (surface IN ('web','api_v1','openai_compat','mcp'));
DROP TABLE IF EXISTS owui_knowledge_files;
DROP TABLE IF EXISTS owui_files;
DROP TABLE IF EXISTS owui_knowledge;
