-- +goose Up
-- A chat a KB admin or owner started while previewing the KB as a lower role
-- (kbaccess.PreviewRoleHeader). Every turn of the chat, and every later read
-- of its messages, is served as that role — capped by kbaccess.PreviewedRole,
-- so it never grants more than the reader has — and the chat list marks it.
-- Written once at creation by internal/chat, kept on a branch; NULL for an
-- ordinary chat.
--
-- Only the previewable roles are allowed; kbaccess.ParsePreviewRole is the Go
-- side of this CHECK. ADD COLUMN without a default is a catalog-only change.
ALTER TABLE chats
    ADD COLUMN IF NOT EXISTS preview_role varchar(10)
        CHECK (preview_role IN ('view', 'edit'));

-- +goose Down
ALTER TABLE chats DROP COLUMN IF EXISTS preview_role;
