-- +goose Up
-- A branched chat: "Verzweigen" on an answer copies the conversation up to
-- that answer into a new chat (POST /api/chats/{id}/branch). The new chat
-- records the chat it was branched from, and the chat list reports it as
-- branchedFromChatId so the history marks it with the branch icon.
--
-- Deliberately no foreign key: the history only asks whether the column is
-- set, so a deleted origin may leave the id dangling, and without an FK a
-- chat delete needs no index on this column to find referencing rows (chats
-- grows with every conversation). A nullable ADD COLUMN without a default is
-- catalog-only.
ALTER TABLE chats ADD COLUMN IF NOT EXISTS branched_from_chat_id uuid;

-- +goose Down
ALTER TABLE chats DROP COLUMN IF EXISTS branched_from_chat_id;
