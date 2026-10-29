-- +goose Up
-- The role templates every KB can use (internal/kbbehavior), curated by system
-- admins in „Vorlagen" instead of living in code. The id is a persisted
-- contract (knowledge_bases.behavior, start_page, chats.role_id): never
-- renamed or reused. Texts in both prompt languages; an empty English text
-- falls back to the German one. disabled: no longer offered for new picks,
-- KBs and chats that use the template keep it. cover_* is the gradient of the
-- role's card on a start page. Exactly one template is the default a new KB
-- starts with (partial unique index).
--
-- The table starts empty; the first server or worker that starts seeds it
-- with the templates the code shipped so far (kbbehavior.SeedTemplates), so
-- their texts live in one place. A new table, so the indexes build on an
-- empty table.
CREATE TABLE IF NOT EXISTS role_templates (
    id             text PRIMARY KEY,
    position       integer NOT NULL,
    icon           text NOT NULL,
    is_default     boolean NOT NULL DEFAULT false,
    disabled       boolean NOT NULL DEFAULT false,
    name_de        text NOT NULL,
    name_en        text NOT NULL DEFAULT '',
    description_de text NOT NULL DEFAULT '',
    description_en text NOT NULL DEFAULT '',
    prompt_de      text NOT NULL,
    prompt_en      text NOT NULL DEFAULT '',
    cover_from     text NOT NULL,
    cover_to       text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CHECK (NOT (is_default AND disabled))
);
CREATE UNIQUE INDEX IF NOT EXISTS role_templates_one_default ON role_templates (is_default) WHERE is_default;

-- +goose Down
DROP TABLE IF EXISTS role_templates;
