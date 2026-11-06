-- +goose Up
-- How a role template's chat starts on a start page, set in „Vorlagen"
-- (internal/kbbehavior TemplateStart): the kind of start — input field,
-- instruction or file upload — with its texts in both languages. A KB that
-- sets up no start of its own for the role uses it. NULL is the input field,
-- which every template had so far, so existing rows need no backfill.
-- Adding a nullable column without a default rewrites nothing.
ALTER TABLE role_templates ADD COLUMN IF NOT EXISTS start jsonb;

-- +goose Down
ALTER TABLE role_templates DROP COLUMN IF EXISTS start;
