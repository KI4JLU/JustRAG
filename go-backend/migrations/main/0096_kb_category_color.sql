-- +goose Up
-- A category's own colour, picked freely by system admins in „Vorlagen" ›
-- Kategorien (a #rrggbb hex, stored lowercase). NULL keeps the palette slot
-- of migration 0093 (color_slot), so existing categories look the same until
-- an admin picks a colour; clients draw `color` when set, the slot otherwise.
-- The UI dims either in dark mode. A nullable column without a default:
-- metadata-only, no table rewrite.
ALTER TABLE kb_categories ADD COLUMN IF NOT EXISTS color text;

-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_categories_color_check') THEN
        ALTER TABLE kb_categories
            ADD CONSTRAINT kb_categories_color_check CHECK (color ~ '^#[0-9a-f]{6}$');
    END IF;
END $$;
-- +goose StatementEnd

-- +goose Down
ALTER TABLE kb_categories DROP CONSTRAINT IF EXISTS kb_categories_color_check;
ALTER TABLE kb_categories DROP COLUMN IF EXISTS color;
