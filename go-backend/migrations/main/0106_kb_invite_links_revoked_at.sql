-- +goose Up
-- Revoking an invite link no longer deletes it. Links are placed on websites
-- as the permanent way into a KB, so a revoked link must still resolve to its
-- KB: kbinvites.Preview tells an existing member they are already in, and an
-- outsider that the invitation has ended. kbinvites.Redeem refuses a revoked
-- link, and the admin list hides it. NULL = active.
--
-- Links revoked before this migration were deleted and stay gone.
ALTER TABLE kb_invite_links ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- +goose Down
-- Code before this migration knows no revocation: a revoked row left behind
-- would work again as an invite link. Delete them, as revoking did then.
DELETE FROM kb_invite_links WHERE revoked_at IS NOT NULL;
ALTER TABLE kb_invite_links DROP COLUMN IF EXISTS revoked_at;
