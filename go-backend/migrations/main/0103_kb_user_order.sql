-- +goose Up
-- The user's own order of the two topic views, set by dragging the topics
-- (`internal/kbfilters`): 'my' („Mein Wissen") and 'shared' („Geteiltes
-- Wissen"). One row per user and view. kb_ids is the whole order, front to
-- back, and every save rewrites it, so a save is one upsert and the last one
-- wins.
--
-- Display state like kb_favorites, never consulted by an access decision.
-- kb_ids has no foreign key: the id of a deleted topic, or of one the user can
-- no longer see, stays until the user's next save. The views only sort the
-- topics they already list, so such an id shows nothing.
--
-- A new table only, no backfill. Until a user's first save the views keep
-- the server's order (the web app uploads an order it kept in the browser).
CREATE TABLE IF NOT EXISTS kb_user_order (
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    view_name  text        NOT NULL CHECK (view_name IN ('my', 'shared')),
    kb_ids     uuid[]      NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, view_name)
);

-- +goose Down
DROP TABLE IF EXISTS kb_user_order;
