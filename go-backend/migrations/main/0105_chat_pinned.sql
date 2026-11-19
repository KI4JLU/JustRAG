-- +goose Up
-- Chats their owner keeps at hand in the history (internal/chat): pinned, or
-- filed in a section of their own.
--
-- chat_sections: a user's own sections of the history („Angepinnt" is built
-- in and has no row). position is the section's place among them in the
-- owner's own order (PUT /api/chat-sections/order rewrites it for all of
-- them, 1 = first); NULL for a section added since the last save: those come
-- last, oldest first, so a new one lands below the others.
--
-- chats.pinned_at: when the chat was pinned or filed (PUT / DELETE
-- /api/chats/{id}/pin), NULL for a chat that is neither.
-- chats.section_id: the section a kept chat is filed in, NULL for the
-- built-in „Angepinnt". ON DELETE SET NULL is the backstop only: deleting a
-- section lets its chats go first (pinned_at NULL), in the same transaction.
-- chats.pin_position: the chat's place in its section, in the owner's own
-- order, set by dragging (PUT /api/chats/pin-order rewrites it for one
-- section, 1 = first). NULL for a chat added since the last save: those come
-- first, newest first, so a new one lands on top of its section.
--
-- The chat lists (GET /api/chats, GET /api/kb/{id}/chats) return the three
-- as pinnedAt, sectionId and pinPosition.
--
-- Display state of the chat's owner, never consulted by an access decision.
-- A list reads one user's chats through chats_user_id_idx and sorts those
-- rows; the one index added is chats_section_id_idx, for the foreign key:
-- deleting a section (or a user, whose sections go with them) otherwise
-- scans all of chats for rows to set NULL. Partial, as almost no chat is in a
-- section. Built in the migration's transaction, not CONCURRENTLY: the
-- column is new and NULL in every row, so the build is one pass over chats
-- that indexes nothing. No backfill: every existing chat starts unpinned.
CREATE TABLE IF NOT EXISTS chat_sections (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       text        NOT NULL,
    position   integer,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_sections_user_id_idx ON chat_sections (user_id);

ALTER TABLE chats ADD COLUMN IF NOT EXISTS pinned_at timestamptz;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS pin_position integer;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES chat_sections(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS chats_section_id_idx ON chats (section_id) WHERE section_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS chats_section_id_idx;
ALTER TABLE chats DROP COLUMN IF EXISTS section_id;
ALTER TABLE chats DROP COLUMN IF EXISTS pin_position;
ALTER TABLE chats DROP COLUMN IF EXISTS pinned_at;
DROP TABLE IF EXISTS chat_sections;
