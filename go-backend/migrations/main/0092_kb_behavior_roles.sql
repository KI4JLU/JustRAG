-- +goose Up
-- Assistant behavior as roles and rules (internal/kbbehavior). The column
-- holds the active role, the KB's own roles, which catalog rules are on and
-- the KB's own rules; the answer prompt is compiled from it on every turn.
--
-- NULL means "not customized yet": the KB answers exactly as before, from
-- system_prompt alone, which the settings show as the KB's own role
-- "Bisheriger Prompt". system_prompt stays the storage of that role's prompt
-- after customizing too, so the global-KB admin editor and the public API
-- keep writing the same field. No backfill: an existing KB keeps a byte-
-- identical prompt until a KB admin saves the new settings.
ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS behavior jsonb;

-- The role a chat was started in (a starter question with a role), NULL for
-- a chat in the KB's active role. Text, not a foreign key: catalog roles are
-- ids in code ("tutor"), a KB's own roles live inside knowledge_bases.behavior.
-- A role deleted later leaves the id dangling and the chat falls back to the
-- active role. A nullable ADD COLUMN without a default is catalog-only.
ALTER TABLE chats ADD COLUMN IF NOT EXISTS role_id text;

-- +goose Down
ALTER TABLE chats DROP COLUMN IF EXISTS role_id;
ALTER TABLE knowledge_bases DROP COLUMN IF EXISTS behavior;
