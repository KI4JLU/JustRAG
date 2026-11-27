import { useState, useEffect, useCallback, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AtSign, Crown, Link2, Loader2, Plus, Trash2 } from 'lucide-react';
import { BreadcrumbBack, Button, Tabs, TabsContent, TabsList, TabsTrigger, type ActionMenuItem } from '@ki4jlu/design-system';
import axios from 'axios';
import { API_BASE_URL } from '../../api';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useModalContext } from '../../contexts/ModalContext';
import { useToast } from '../../contexts/ToastContext';
import { useSearchMatches, useSearchReveal } from '../../hooks/useSearchReveal';
import { copyToClipboard } from '../../utils/clipboard';
import { BulkAddFields } from './BulkAddFields';
import { InviteLinksSection } from './InviteLinksSection';
import { MemberSection, PendingSection } from './MemberSections';
import type { BulkAddSummary, SharedInviteLink, SharedMember, SharedPendingInvite, SharingConfig } from './sharing';
import { bulkSummaryText, useBulkAdd } from './useBulkAdd';

/** Labels of the add sub-screen's fields (translation keys), for the settings search. */
const ADD_BY_USERNAME_KEYS = ['byUsername', 'usernamesLabel'];
const INVITE_LINK_KEYS = ['inviteLinks', 'newInviteLink', 'inviteLinkTitle', 'activeInviteLinks'];

export interface SharingPanelProps {
    config: SharingConfig;
    /** Caller's own role on the thing: gates the ownership transfer. */
    myRole: string;
    /**
     * Role changes not saved yet, by user id, for a window that saves them with its own
     * „Speichern" (and asks before discarding them). Without `onRoleDraftChange` a role change
     * is saved at once.
     */
    roleDrafts?: Record<string, string>;
    /** Sets (or, with null, drops) a member's role draft. */
    onRoleDraftChange?: (userId: string, role: string | null) => void;
    /** Bumped by the window after it saved roles: the list is read again. */
    revision?: number;
    /**
     * The member list or „Mitglieder hinzufügen". Held by the window, because the add view
     * takes over the window's footer (see footerSlot).
     */
    view: 'members' | 'add';
    onViewChange: (view: 'members' | 'add') => void;
    /**
     * The window's footer, handed over while the add view is open: one row of actions per
     * screen, never the add view's own buttons stacked above the window's own. Without a slot
     * the actions render inline.
     */
    footerSlot?: HTMLElement | null;
    /**
     * The ownership moved to another member: the caller is no longer the owner, so whoever holds
     * the thing's own record (role, visibility) has to read it again.
     */
    onOwnerChanged?: () => void;
}

/**
 * The people of a knowledge base or a glossary and adding new ones (by username or invite
 * link). Every change applies at once, except a role change where the window keeps drafts. The
 * window's h2 is the section title, so the panel's titles are h3s. What differs between the
 * things shared — paths, roles, the texts naming them — is in `config`.
 */
export function SharingPanel({
    config, myRole, roleDrafts, onRoleDraftChange, revision = 0, view, onViewChange: setView, footerSlot, onOwnerChanged,
}: SharingPanelProps) {
    const { t, language } = useTheme();
    const { token } = useAuth();
    const { showConfirm } = useModalContext();
    const toast = useToast();
    const { basePath, roles, ownerRole, labels } = config;
    const [members, setMembers] = useState<SharedMember[]>([]);
    const [loadingMembers, setLoadingMembers] = useState(false);
    const [pendingInvites, setPendingInvites] = useState<SharedPendingInvite[]>([]);
    // The add view's two tabs; which of the two views shows is the window's `view`.
    const [addTab, setAddTab] = useState<'usernames' | 'links'>('usernames');
    const [bulkRole, setBulkRole] = useState(roles[0].value);
    const [bulkLoading, setBulkLoading] = useState(false);
    const [inviteLinks, setInviteLinks] = useState<SharedInviteLink[]>([]);

    const fetchMembers = useCallback(async () => {
        setLoadingMembers(true);
        try {
            if (!token) return;
            const res = await axios.get(`${API_BASE_URL}${basePath}/members`);
            setMembers(res.data.members ?? []);
            setPendingInvites(res.data.pending ?? []);
        } catch (err: unknown) {
            console.error('Failed to fetch members:', err);
            toast.error(t('sharesFetchError'));
        } finally {
            setLoadingMembers(false);
        }
    }, [basePath, token, toast, t]);

    useEffect(() => {
        void fetchMembers();
    }, [fetchMembers, revision]);

    const fetchInviteLinks = useCallback(async () => {
        if (!token) return;
        try {
            const res = await axios.get(`${API_BASE_URL}${basePath}/invite-links`);
            setInviteLinks(res.data.links ?? []);
        } catch (err: unknown) {
            console.error('Failed to fetch invite links:', err);
            toast.error(t('inviteLinkFetchError'));
        }
    }, [basePath, token, toast, t]);

    // The full URL is assembled client-side, so the backend never needs to know its own public origin.
    const inviteLinkUrl = (link: SharedInviteLink) => `${window.location.origin}${config.joinPath}${link.token}`;

    const handleCreateInviteLink = async (role: string, label: string): Promise<boolean> => {
        try {
            const res = await axios.post(`${API_BASE_URL}${basePath}/invite-links`, { role, label });
            setInviteLinks(prev => [res.data, ...prev]);
            toast.success(t('inviteLinkCreated'));
            return true;
        } catch (err: unknown) {
            console.error('Failed to create invite link:', err);
            toast.error(t('inviteLinkCreateError'));
            return false;
        }
    };

    const handleCopyInviteLink = async (link: SharedInviteLink) => {
        if (await copyToClipboard(inviteLinkUrl(link))) {
            toast.success(t('inviteLinkCopied'));
        } else {
            toast.error(t('clipboardCopyFailed'));
        }
    };

    // Optimistic with rollback, like handleRemoveMember. Unlike a pending invite this destroys
    // something people already hold, so it confirms.
    const handleRevokeInviteLink = async (link: SharedInviteLink) => {
        if (!await showConfirm(t('revokeInviteLinkMessage'), t('revokeInviteLinkTitle'), { tone: 'destructive', confirmLabel: t('revokeInviteLink') })) return;
        const prev = inviteLinks;
        setInviteLinks(inviteLinks.filter(l => l.id !== link.id));
        try {
            await axios.delete(`${API_BASE_URL}${basePath}/invite-links/${link.id}`);
        } catch {
            setInviteLinks(prev);
            toast.error(t('inviteLinkRevokeError'));
        }
    };

    const handleRemoveMember = async (userId: string, username: string) => {
        if (!await showConfirm(
            t(labels.removeMessage).replace('{username}', username),
            t('removeMemberTitle'),
            { tone: 'destructive', confirmLabel: t('removeMemberConfirm') },
        )) return;

        if (!token) return;

        const prev = members;
        setMembers(members.filter(m => m.userId !== userId));
        try {
            await axios.delete(`${API_BASE_URL}${basePath}/members/${userId}`);
            onRoleDraftChange?.(userId, null);
        } catch {
            setMembers(prev);
            toast.error(t('removeShareError'));
        }
    };

    // Withdraws a not-yet-applied invite. Optimistic with rollback on failure, no confirm dialog
    // (nothing was granted yet, so there's nothing destructive to confirm). Usernames can
    // contain characters that need escaping in a path segment.
    const handleRevokePending = async (username: string) => {
        const prev = pendingInvites;
        setPendingInvites(pendingInvites.filter(p => p.username !== username));
        try {
            await axios.delete(`${API_BASE_URL}${basePath}/members/pending/${encodeURIComponent(username)}`);
        } catch {
            setPendingInvites(prev);
            toast.error(t('removeShareError'));
        }
    };

    // With drafts: picking the stored role again drops the draft, so Speichern goes back to
    // disabled when nothing is left to save. Without: saved at once, optimistic with rollback.
    const handleRoleChange = async (m: SharedMember, role: string) => {
        if (onRoleDraftChange) {
            onRoleDraftChange(m.userId, role === m.role ? null : role);
            return;
        }
        if (role === m.role) return;
        const prev = members;
        setMembers(members.map(x => x.userId === m.userId ? { ...x, role } : x));
        try {
            await axios.put(`${API_BASE_URL}${basePath}/members/${m.userId}`, { role });
        } catch {
            setMembers(prev);
            toast.error(t('roleChangeError'));
        }
    };

    const handleMakeOwner = async (userId: string, username: string) => {
        if (!await showConfirm(
            t(labels.makeOwnerMessage).replace('{username}', username),
            t('makeOwnerTitle'),
            { confirmLabel: t('makeOwnerConfirm') },
        )) return;
        try {
            await axios.post(`${API_BASE_URL}${basePath}/transfer-owner`, { userId });
            onRoleDraftChange?.(userId, null);
            onOwnerChanged?.();
            await fetchMembers();
        } catch {
            toast.error(t('roleChangeError'));
        }
    };

    const isMember = useCallback((userId: string) => members.some(m => m.userId === userId), [members]);
    const bulk = useBulkAdd(isMember);

    const handleBulkInvite = async () => {
        if (bulk.usernames.length === 0) return;
        setBulkLoading(true);
        try {
            const res = await axios.post(`${API_BASE_URL}${basePath}/members/bulk`, {
                usernames: bulk.usernames,
                role: bulkRole,
            });
            // Unknown usernames are parked as pending invites and granted at the person's first
            // login: the summary says how many of each.
            toast.success(bulkSummaryText(t('bulkInviteSummary'), res.data as BulkAddSummary));
            bulk.reset();
            setView('members');
            await fetchMembers(); // refresh members + pending lists
        } catch (err: unknown) {
            console.error('Bulk invite failed:', err);
            toast.error(t('bulkInviteError'));
        } finally {
            setBulkLoading(false);
        }
    };

    const bulkFormId = useId();
    const renderActions = (actions: ReactNode) => footerSlot
        ? createPortal(actions, footerSlot)
        : <div className="flex flex-col-reverse gap-2 border-t border-outline-variant pt-4 sm:flex-row sm:justify-end">{actions}</div>;

    const memberActions = (m: SharedMember): ActionMenuItem[] => {
        const canTransfer = myRole === ownerRole && config.canTransferTo(m.role);
        return [
            ...(canTransfer ? [{
                label: t('makeOwner'),
                icon: <Crown className="size-4" aria-hidden="true" />,
                onSelect: () => { void handleMakeOwner(m.userId, m.username); },
            }] : []),
            {
                label: t(labels.removeShare),
                icon: <Trash2 className="size-4" aria-hidden="true" />,
                destructive: true,
                separatorBefore: canTransfer,
                onSelect: () => { void handleRemoveMember(m.userId, m.username); },
            },
        ];
    };

    const openAdd = () => { setView('add'); if (addTab === 'links') void fetchInviteLinks(); };

    // „Mitglieder hinzufügen" is a sub-screen: a settings search opens it (on the invite-link tab
    // for a link label) when it names one of its fields, and leaves again when it moves on.
    const linkMatch = useSearchMatches(INVITE_LINK_KEYS.map(t));
    const usernameMatch = useSearchMatches(ADD_BY_USERNAME_KEYS.map(t));
    useSearchReveal(linkMatch || usernameMatch ? 'on' : null, view === 'add', openAdd, () => setView('members'));
    useSearchReveal(linkMatch ? 'on' : null, addTab === 'links', () => { setAddTab('links'); void fetchInviteLinks(); }, () => setAddTab('usernames'));

    if (view === 'members') {
        return (
            <>
                {/* Intro and action on one row: the window's footer is taken by its own actions. */}
                <div className="flex items-center justify-between gap-3">
                    <p className="m-0 text-sm text-on-surface-variant">{t(labels.intro)}</p>
                    <Button variant="outline" onClick={openAdd}>
                        <Plus className="size-4" aria-hidden="true" />
                        {t('addMembers')}
                    </Button>
                </div>
                <MemberSection
                    members={members}
                    loading={loadingMembers}
                    roles={roles}
                    ownerRole={ownerRole}
                    roleOf={(m) => roleDrafts?.[m.userId] ?? m.role}
                    onRoleChange={(m, role) => { void handleRoleChange(m, role); }}
                    actionsOf={memberActions}
                    t={t}
                />
                <PendingSection pending={pendingInvites} roles={roles} onRevoke={(u) => { void handleRevokePending(u); }} t={t} />
            </>
        );
    }

    return (
        <>
            {/* Back navigation is a breadcrumb above the title, the default for every sub-view;
                "Abbrechen" and "Fertig" also return to the list. */}
            <div className="flex min-w-0 flex-col gap-1.5">
                <BreadcrumbBack
                    trail={[t('members')]}
                    labels={{ nav: t('breadcrumbNav'), back: t('backTo') }}
                    onClick={() => setView('members')}
                />
                <h3 className="m-0 text-lg font-semibold text-on-surface">{t('addMembers')}</h3>
            </div>

            <Tabs value={addTab} onValueChange={(v) => {
                setAddTab(v as typeof addTab);
                // Only fetched when the tab is opened: most sessions never touch invite links.
                if (v === 'links') void fetchInviteLinks();
            }}>
                <TabsList variant="segmented" aria-label={t('addMembers')} className="self-start">
                    <TabsTrigger value="usernames"><AtSign className="size-4" aria-hidden="true" />{t('byUsername')}</TabsTrigger>
                    <TabsTrigger value="links"><Link2 className="size-4" aria-hidden="true" />{t('inviteLinks')}</TabsTrigger>
                </TabsList>

                <TabsContent value="usernames">
                    <BulkAddFields
                        bulk={bulk}
                        formId={bulkFormId}
                        roles={roles}
                        role={bulkRole}
                        onRoleChange={setBulkRole}
                        onSubmit={() => { void handleBulkInvite(); }}
                        t={t}
                    />
                </TabsContent>

                <TabsContent value="links">
                    <InviteLinksSection
                        links={inviteLinks}
                        roles={roles}
                        onCreate={handleCreateInviteLink}
                        onCopy={(link) => { void handleCopyInviteLink(link); }}
                        onRevoke={(link) => { void handleRevokeInviteLink(link); }}
                        language={language}
                        t={t}
                    />
                </TabsContent>
            </Tabs>
            {/* „Abbrechen" and „Fertig" return to the list. The submit sits outside its form when
                it is in the window's footer, hence `form`. */}
            {renderActions(addTab === 'usernames' ? (
                <>
                    <Button type="button" variant="outline" onClick={() => setView('members')}>{t('cancel')}</Button>
                    <Button type="submit" form={bulkFormId} disabled={bulkLoading || bulk.resolving || bulk.addableCount === 0}>
                        {bulkLoading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                        {(bulk.addableCount === 1 ? t('addOnePerson') : t('addNPeople')).replace('{count}', String(bulk.addableCount))}
                    </Button>
                </>
            ) : (
                <Button variant="outline" onClick={() => setView('members')}>{t('done')}</Button>
            ))}
        </>
    );
}
