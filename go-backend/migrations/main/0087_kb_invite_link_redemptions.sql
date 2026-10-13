-- +goose Up
-- Who has redeemed which invite link, one row per (link, person). Written by
-- kbinvites.Redeem, which counts a link's redemption_count up only when this
-- row is new: the count is the number of distinct people who used the link,
-- not the number of visits — a person opening the same link again does not
-- add to it.
--
-- No backfill: until now only the counter existed, so there is no history to
-- derive from. Existing redemption_count values are kept as they are and grow
-- by the new rule from here on.
--
-- Row existence IS the record, so no surrogate id. first_redeemed_at is when
-- the person first came in through this link.
CREATE TABLE IF NOT EXISTS kb_invite_link_redemptions (
    link_id           uuid NOT NULL REFERENCES kb_invite_links(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_redeemed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (link_id, user_id)
);

-- The PK leads on link_id and serves Redeem's insert and the link cascade.
-- Deleting a user scans by user_id, which the PK cannot serve. A brand-new,
-- empty table, so a plain (non-CONCURRENTLY) build takes no meaningful lock.
CREATE INDEX IF NOT EXISTS kb_invite_link_redemptions_user_idx
    ON kb_invite_link_redemptions (user_id);

-- +goose Down
DROP TABLE IF EXISTS kb_invite_link_redemptions;
