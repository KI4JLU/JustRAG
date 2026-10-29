-- +goose Up
-- Version history of a KB's assistant settings (internal/kbassistant): every
-- save of „Startseite" + „Verhalten" (PUT /api/kb/{id}/assistant-settings)
-- writes one row with the full state after the save (snapshot) and the field
-- changes against the version before it. A restore writes a new row too, so
-- no version is ever overwritten. The first save of a KB also records the
-- state before it as version 1 (kind 'baseline'), so the original setup can
-- be restored. At most kbassistant.MaxVersions rows are kept per KB; the
-- oldest are pruned on save.
--
-- author_name is the author's display name at the time of the save: the row
-- keeps reading right after the user is renamed or deleted (author_id then
-- becomes NULL). A new table, so the UNIQUE index builds on an empty table.
CREATE TABLE IF NOT EXISTS kb_settings_versions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kb_id         uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    number        integer NOT NULL,
    kind          text NOT NULL DEFAULT 'save' CHECK (kind IN ('baseline', 'save', 'restore')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    author_id     uuid REFERENCES users(id) ON DELETE SET NULL,
    author_name   text NOT NULL DEFAULT '',
    note          text,
    restored_from integer,
    snapshot      jsonb NOT NULL,
    changes       jsonb NOT NULL DEFAULT '[]'::jsonb,
    UNIQUE (kb_id, number)
);

-- +goose Down
DROP TABLE IF EXISTS kb_settings_versions;
