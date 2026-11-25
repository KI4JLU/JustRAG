import type { LucideIcon } from 'lucide-react';

/*
 * What the sharing pieces of `components/people/` have in common. A knowledge base and a
 * glossary are shared the same way (members with a role, pending invites for names without an
 * account, invite links, one owner who can hand over), so the panel is written once and each
 * kind of thing describes itself with a `SharingConfig`.
 */

/** One role a person can be given: never the owner, who moves only through the transfer. */
export interface SharingRole {
    /** The role as the API spells it. */
    value: string;
    /** Translation key of its label. */
    labelKey: string;
    icon: LucideIcon;
    /** Badge tone on an invite link. */
    tone: 'neutral' | 'primary' | 'secondary';
}

/** A row of the member list (`members` of GET …/members). */
export interface SharedMember {
    userId: string;
    username: string;
    firstName?: string | null;
    lastName?: string | null;
    role: string;
}

/** A name without an account yet (`pending` of GET …/members). */
export interface SharedPendingInvite {
    username: string;
    role: string;
    createdAt: string;
}

/** An invite link (`links` of GET …/invite-links). */
export interface SharedInviteLink {
    id: string;
    token: string;
    role: string;
    label: string | null;
    redemptionCount: number;
    lastUsedAt: string | null;
}

/** The three counts the bulk add answers with. */
export interface BulkAddSummary {
    shared: string[];
    pending: string[];
    alreadyHadAccess: string[];
}

/** Translation keys of the texts that name the thing being shared ("topic", "glossary"). */
export interface SharingLabels {
    /** Intro line over the member list. */
    intro: string;
    /** Member menu: remove. */
    removeShare: string;
    /** Confirm dialog of a removal; `{username}`. */
    removeMessage: string;
    /** Confirm dialog of the ownership transfer; `{username}`. */
    makeOwnerMessage: string;
}

export interface SharingConfig {
    /** API path of the thing, without a trailing slash: `/api/kb/<id>`. */
    basePath: string;
    /** The roles a person can be given, lowest first. */
    roles: readonly SharingRole[];
    /** The role that moves only through the transfer. */
    ownerRole: string;
    /** Whether the owner may hand the thing to a member holding `role`. */
    canTransferTo: (role: string) => boolean;
    /** Path an invite link opens, followed by its token: `/join/`. */
    joinPath: string;
    labels: SharingLabels;
}

/** A user as GET /api/users/{username} returns them. */
export interface LookedUpUser {
    id: string;
    username: string;
    firstName?: string | null;
    lastName?: string | null;
}
