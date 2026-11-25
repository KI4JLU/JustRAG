import { useMemo } from 'react';
import { Edit3, Eye, Shield } from 'lucide-react';
import type { KnowledgeBase, KbAssignableRole } from '../../types';
import { SharingPanel } from '../people/SharingPanel';
import type { SharingConfig, SharingRole } from '../people/sharing';

interface KbMembersPanelProps {
    kb: KnowledgeBase;
    /** Caller's own role on this KB — gates the ownership-transfer action. */
    myRole: string;
    /**
     * Role changes not saved yet, by user id. A role change is a draft like
     * every other edit in the settings window: the dialog saves it with
     * „Speichern" and asks before discarding it.
     */
    roleDrafts: Record<string, KbAssignableRole>;
    /** Sets (or, with null, drops) a member's role draft. */
    onRoleDraftChange: (userId: string, role: KbAssignableRole | null) => void;
    /** Bumped by the dialog after it saved roles: the list is read again. */
    revision: number;
    /**
     * The member list or „Mitglieder hinzufügen". Held by the dialog, because
     * the add view takes over the dialog's footer (see footerSlot).
     */
    view: 'members' | 'add';
    onViewChange: (view: 'members' | 'add') => void;
    /**
     * The dialog's footer, handed over while the add view is open: one row of
     * actions per screen, never the add view's own buttons stacked above the
     * window's Abbrechen/Speichern. Without a slot the actions render inline.
     */
    footerSlot?: HTMLElement | null;
}

// Assignable roles for the per-member <select> and the invite pickers. Never
// includes 'owner' — ownership moves only via the explicit transfer action,
// mirroring the backend's kbaccess.Assignable check on PUT /members/{userId}
// and POST /members/bulk. Badge tone on the invite links: read neutral, edit
// primary, admin secondary.
const KB_ROLES: readonly SharingRole[] = [
    { value: 'view', labelKey: 'viewPermission', icon: Eye, tone: 'neutral' },
    { value: 'edit', labelKey: 'editPermission', icon: Edit3, tone: 'primary' },
    { value: 'admin', labelKey: 'adminPermission', icon: Shield, tone: 'secondary' },
];

/**
 * The members of a KB and adding new ones (by username or invite link): the
 * „Mitglieder" section of the Thema-Einstellungen window (KbSettingsDialog),
 * which „Teilen" on a topic card opens directly. The panel itself is the
 * shared `SharingPanel`; this describes a KB to it.
 */
export function KbMembersPanel({ kb, myRole, roleDrafts, onRoleDraftChange, revision, view, onViewChange, footerSlot }: KbMembersPanelProps) {
    const config = useMemo<SharingConfig>(() => ({
        basePath: `/api/kb/${kb.id}`,
        roles: KB_ROLES,
        ownerRole: 'owner',
        // Only an admin is offered the ownership: the one step below the owner.
        canTransferTo: (role) => role === 'admin',
        joinPath: '/join/',
        labels: {
            intro: 'membersIntro',
            removeShare: 'removeShare',
            removeMessage: 'removeMemberMessage',
            makeOwnerMessage: 'makeOwnerMessage',
        },
    }), [kb.id]);

    return (
        <SharingPanel
            config={config}
            myRole={myRole}
            roleDrafts={roleDrafts}
            onRoleDraftChange={(userId, role) => onRoleDraftChange(userId, role as KbAssignableRole | null)}
            revision={revision}
            view={view}
            onViewChange={onViewChange}
            footerSlot={footerSlot}
        />
    );
}
