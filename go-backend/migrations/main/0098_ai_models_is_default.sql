-- +goose Up
-- The default model per provider and kind (chat incl. reasoning, embedding,
-- rerank, tts, stt): the one a KB without its own model override uses
-- (internal/ai ConfigResolver, step 5). Until now that was whatever row an
-- unordered SELECT returned first, which an UPDATE, VACUUM or restore could
-- change silently (KI-939). The admin provider form now names it explicitly
-- (internal/adminconfigs).
--
-- ai_models is a handful of rows per provider, so the constant default adds
-- the column without a rewrite and the plain index builds below take no
-- noticeable lock.
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- Freeze today's effective default: the row the resolver's unordered query
-- returns first, which on a table this size is heap order (ctid). Nothing
-- changes on deploy. A kind that already has a default is left alone, so a
-- re-run is a no-op. The CASE mirrors the resolver's classification order.
WITH kinds AS (
    SELECT id, provider_id, ctid,
           CASE WHEN is_embedding THEN 'embedding'
                WHEN is_rerank    THEN 'rerank'
                WHEN is_tts       THEN 'tts'
                WHEN is_stt       THEN 'stt'
                ELSE 'chat' END AS kind,
           bool_or(is_default) OVER (PARTITION BY provider_id,
               CASE WHEN is_embedding THEN 'embedding'
                    WHEN is_rerank    THEN 'rerank'
                    WHEN is_tts       THEN 'tts'
                    WHEN is_stt       THEN 'stt'
                    ELSE 'chat' END) AS has_default
    FROM ai_models
), firsts AS (
    SELECT id, row_number() OVER (PARTITION BY provider_id, kind ORDER BY ctid) AS rn
    FROM kinds
    WHERE NOT has_default
)
UPDATE ai_models m SET is_default = true
FROM firsts f
WHERE m.id = f.id AND f.rn = 1;

-- At most one default per provider and kind. The predicates match the
-- category WHERE clauses in internal/adminconfigs.
CREATE UNIQUE INDEX IF NOT EXISTS ai_models_one_default_chat ON ai_models (provider_id)
    WHERE is_default AND is_embedding = false AND is_rerank = false AND is_tts = false AND is_stt = false;
CREATE UNIQUE INDEX IF NOT EXISTS ai_models_one_default_embedding ON ai_models (provider_id)
    WHERE is_default AND is_embedding = true;
CREATE UNIQUE INDEX IF NOT EXISTS ai_models_one_default_rerank ON ai_models (provider_id)
    WHERE is_default AND is_rerank = true;
CREATE UNIQUE INDEX IF NOT EXISTS ai_models_one_default_tts ON ai_models (provider_id)
    WHERE is_default AND is_tts = true;
CREATE UNIQUE INDEX IF NOT EXISTS ai_models_one_default_stt ON ai_models (provider_id)
    WHERE is_default AND is_stt = true;

-- +goose Down
DROP INDEX IF EXISTS ai_models_one_default_stt;
DROP INDEX IF EXISTS ai_models_one_default_tts;
DROP INDEX IF EXISTS ai_models_one_default_rerank;
DROP INDEX IF EXISTS ai_models_one_default_embedding;
DROP INDEX IF EXISTS ai_models_one_default_chat;
ALTER TABLE ai_models DROP COLUMN IF EXISTS is_default;
