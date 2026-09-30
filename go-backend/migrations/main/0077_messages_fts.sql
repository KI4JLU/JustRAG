-- +goose NO TRANSACTION
-- +goose Up
-- Full-text index on message content for GET /api/search's messages group
-- (board card KI-836, internal/search/fulltext.go). messages had no text
-- index at all, only chat_id / created_at / parent_message_id btrees.
--
-- An expression index, not a GENERATED ... STORED tsvector column: adding a
-- stored column would rewrite and lock the whole messages table. The query
-- in internal/search repeats this expression exactly (messageTSVector);
-- change one and the planner silently stops using the index.
--
--   - 'simple' config: content is mixed German/English, 'simple' only
--     lowercases. TODO: 'simple' vs 'german' not yet confirmed by the
--     developer; switching needs a new index and the matching query change.
--   - left(content, 100000): a tsvector is capped at 1 MB and to_tsvector
--     raises an error beyond it. In an index expression that error would
--     abort the INSERT of an oversize message (breaking the chat write path)
--     and fail this build on any existing oversize row. 100 000 characters
--     stay well below the cap even for pathological input; see
--     maxIndexedChars in internal/search/fulltext.go for the measurement.
--
-- NO TRANSACTION + CONCURRENTLY because messages is a large table
-- (migrations/README.md): a plain CREATE INDEX would block chat writes for
-- the whole build. If the build fails it leaves an INVALID index that
-- IF NOT EXISTS then skips — drop it (DROP INDEX CONCURRENTLY
-- messages_content_fts_idx) and re-run. statement_timeout is lifted for this
-- session only (goose runs the file on one connection), as in 0076.

-- +goose StatementBegin
SET statement_timeout = 0;
-- +goose StatementEnd

CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_content_fts_idx
    ON messages USING gin (to_tsvector('simple', left(content, 100000)));

-- +goose StatementBegin
RESET statement_timeout;
-- +goose StatementEnd

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS messages_content_fts_idx;
