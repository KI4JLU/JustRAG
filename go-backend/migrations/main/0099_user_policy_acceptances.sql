-- +goose Up
-- One row per user and accepted usage-policy version (AI-use notice, terms,
-- privacy). The version a user must accept is the global site_config key
-- policy_acceptance_version; bumping it asks everyone again. Old rows stay as
-- the record of what a user accepted and when; the first acceptance of a
-- version is kept, a repeat is a no-op (`internal/policyaccept`). A new table
-- only, no backfill: until an admin sets a version nobody is asked.
CREATE TABLE IF NOT EXISTS user_policy_acceptances (
    user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    policy_version text        NOT NULL CHECK (policy_version <> ''),
    accepted_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, policy_version)
);

-- +goose Down
DROP TABLE IF EXISTS user_policy_acceptances;
