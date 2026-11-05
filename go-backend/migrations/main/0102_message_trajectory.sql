-- +goose Up
-- The agent steps of an AI answer (plan, research rounds, hops, decisions,
-- refine, the degenerate-output guard), as the TrajectoryEvent list the turn
-- streamed in its `agentTrajectory` frames. Until now the steps only existed in
-- the live SSE stream, so they vanished on reload. Written with the AI message
-- (AddMessage) and once more after the post-response tasks when those added
-- steps (refine); read by the messages endpoints, redacted per reader there
-- like sources (internal/chat).
--
-- A nullable column without a default: metadata-only, no table rewrite on
-- `messages`. No backfill: the steps of older answers were never kept, and
-- NULL reads as "no steps".
ALTER TABLE messages ADD COLUMN IF NOT EXISTS trajectory JSONB;

-- +goose Down
ALTER TABLE messages DROP COLUMN IF EXISTS trajectory;
