-- +goose Up
-- Chat attachments: files a user attaches in the chat composer and that the
-- answer model reads as full-text context next to the KB retrieval. They are
-- never indexed.
--
-- An attachment is a user_files row (the user file library's one file
-- identity), so a later iteration that lets the model choose between full
-- text and vectors finds the parse cache, index fingerprint and KG cache
-- already keyed by user_file_id. scope separates them from the library:
--
-- library  a library file: listed in GET /api/library/files, usable in KBs
--          and in library chats. Every row from before this migration.
-- chat     a chat attachment: owner-only, not listed in the library, deleted
--          with the chats that reference it (chat.Handler.DeleteChat, plus the
--          userfiles pending sweep for chats removed in bulk). A library
--          upload or adopt of the same bytes promotes it to library.
--
-- A constant DEFAULT on ADD COLUMN is catalog-only since Postgres 11, so the
-- existing rows read 'library' without a rewrite.
ALTER TABLE user_files
    ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'library'
        CHECK (scope IN ('library', 'chat'));

-- message_attachments binds attachments to the user message they were sent
-- with, so a reloaded chat shows them and later turns send them to the model
-- again. position keeps the order the user attached them in. Both FKs
-- cascade: deleting the message (with its chat) or the file removes the link.
-- New table, so the in-transaction index build is fine.
CREATE TABLE IF NOT EXISTS message_attachments (
    message_id   uuid     NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_file_id uuid     NOT NULL REFERENCES user_files(id) ON DELETE CASCADE,
    position     smallint NOT NULL CHECK (position >= 0),
    PRIMARY KEY (message_id, user_file_id)
);
CREATE INDEX IF NOT EXISTS message_attachments_user_file_idx ON message_attachments (user_file_id);

-- context_window is the model's context window in tokens (prompt plus
-- completion), set per model in the admin provider panel or detected from
-- the provider's GET /models (vLLM reports max_model_len). NULL = unknown;
-- the chat then uses chat_attachments_fallback_context_window. Read by
-- ai.ConfigResolver into ResolvedConfig.ChatContextWindow; the chat sizes the
-- attachment budget of a turn from it.
ALTER TABLE ai_models
    ADD COLUMN IF NOT EXISTS context_window integer
        CHECK (context_window IS NULL OR context_window > 0);

-- +goose Down
ALTER TABLE ai_models DROP COLUMN IF EXISTS context_window;
DROP TABLE IF EXISTS message_attachments;
DELETE FROM user_files WHERE scope = 'chat';
ALTER TABLE user_files DROP COLUMN IF EXISTS scope;
