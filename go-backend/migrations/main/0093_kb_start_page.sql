-- +goose Up
-- A KB's start page (internal/kbstartpage): starter questions with a role,
-- how a chat starts (input field or file upload only), and fixed or dynamic
-- starter questions. NULL means "never configured": the start page shows
-- what it showed before (dynamic questions, input field). Title and
-- description are not in here: they are knowledge_bases.name and
-- knowledge_bases.description. Catalog-only ADD COLUMN, no backfill.
ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS start_page jsonb;

-- A fixed colour per catalog category (palette slots --color-category-1..9),
-- so two categories never collide the way a hash of the name did. Nullable
-- for the ADD COLUMN; existing categories get a slot in display order below,
-- new ones get the next slot when created (kbcategories.PGStore.Create).
ALTER TABLE kb_categories ADD COLUMN IF NOT EXISTS color_slot smallint;

-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_categories_color_slot_check') THEN
        ALTER TABLE kb_categories
            ADD CONSTRAINT kb_categories_color_slot_check CHECK (color_slot BETWEEN 1 AND 9);
    END IF;
END $$;
-- +goose StatementEnd

-- The taxonomy is a short admin-curated list, so this backfill is a handful
-- of rows. Idempotent: only rows still without a slot are touched.
UPDATE kb_categories c
SET color_slot = s.slot
FROM (
    SELECT id, ((row_number() OVER (ORDER BY sort_order, name) - 1) % 9 + 1)::smallint AS slot
    FROM kb_categories
) s
WHERE c.id = s.id AND c.color_slot IS NULL;

-- +goose Down
ALTER TABLE kb_categories DROP CONSTRAINT IF EXISTS kb_categories_color_slot_check;
ALTER TABLE kb_categories DROP COLUMN IF EXISTS color_slot;
ALTER TABLE knowledge_bases DROP COLUMN IF EXISTS start_page;
