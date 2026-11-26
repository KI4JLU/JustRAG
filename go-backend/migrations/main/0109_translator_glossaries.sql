-- +goose Up
-- Translator glossaries and their sharing. A glossary has four roles
-- (viewer < editor < admin < owner) held in glossary_members, the sole
-- authority for roles, exactly as kb_members is for knowledge bases. Read by
-- internal/glossaryaccess (resolution), internal/glossarymembers (members,
-- invites, invite links) and internal/translator (content).
--
-- visibility is 'private' (members only) or 'global' (every user who may use
-- the translation reads it as viewer). There is no organization level: JLU RAG
-- has no groups, a glossary's members are its group.
CREATE TABLE IF NOT EXISTS glossaries (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    category    text NOT NULL DEFAULT 'general',
    visibility  text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'global')),
    entries     jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS glossary_members (
    glossary_id uuid NOT NULL REFERENCES glossaries(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        varchar(10) NOT NULL CHECK (role IN ('viewer', 'editor', 'admin', 'owner')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (glossary_id, user_id)
);

-- Exactly one owner per glossary. Partial, so any number of viewers, editors
-- and admins sit next to it.
CREATE UNIQUE INDEX IF NOT EXISTS glossary_members_owner_uniq
    ON glossary_members (glossary_id) WHERE role = 'owner';

-- "Which glossaries does user X belong to" scans by user_id.
CREATE INDEX IF NOT EXISTS glossary_members_user_idx ON glossary_members (user_id);

-- Invites for usernames without an account yet. Applied on the person's first
-- login (authhandler.ApplyPendingInvites), like pending_kb_invites.
-- username is stored lower-cased.
CREATE TABLE IF NOT EXISTS glossary_pending_invites (
    glossary_id uuid NOT NULL REFERENCES glossaries(id) ON DELETE CASCADE,
    username    text NOT NULL,
    role        varchar(10) NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
    invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (glossary_id, username)
);

CREATE INDEX IF NOT EXISTS glossary_pending_invites_username_idx
    ON glossary_pending_invites (username);

-- Permanent, revocable links that grant the role they were created with.
-- 'owner' is not representable, not even by a direct write.
CREATE TABLE IF NOT EXISTS glossary_invite_links (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    glossary_id uuid NOT NULL REFERENCES glossaries(id) ON DELETE CASCADE,
    token       text NOT NULL,
    role        varchar(10) NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
    label       text,
    created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    revoked_at  timestamptz,
    last_used_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS glossary_invite_links_token_idx
    ON glossary_invite_links (token);
CREATE INDEX IF NOT EXISTS glossary_invite_links_glossary_idx
    ON glossary_invite_links (glossary_id);

-- One row per link and person, so the link's count is the number of distinct
-- people who joined through it.
CREATE TABLE IF NOT EXISTS glossary_invite_redemptions (
    link_id     uuid NOT NULL REFERENCES glossary_invite_links(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redeemed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (link_id, user_id)
);

-- +goose Down
DROP TABLE IF EXISTS glossary_invite_redemptions;
DROP TABLE IF EXISTS glossary_invite_links;
DROP TABLE IF EXISTS glossary_pending_invites;
DROP TABLE IF EXISTS glossary_members;
DROP TABLE IF EXISTS glossaries;
