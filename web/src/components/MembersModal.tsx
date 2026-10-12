import React, { useState, useEffect, useCallback, useId } from 'react';
import { User, Eye, Edit3, Loader2, Trash2, Clock, Users, Crown, Shield, Link2, Copy, Search } from 'lucide-react';
import {
    ActionMenu, Avatar, Badge, Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input, Kbd, Label,
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsContent, TabsList, TabsTrigger, Textarea,
    type ActionMenuItem,
} from '@ki4jlu/design-system';
import type { KnowledgeBase, KbMember, KbRole, KbAssignableRole, KbInviteLink } from '../types';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useModalContext } from '../contexts/ModalContext';
import { useToast } from '../contexts/ToastContext';
import { useFormValidation } from '../hooks/useFormValidation';
import { splitUsernames } from '../utils/splitUsernames';
import { copyToClipboard } from '../utils/clipboard';

// PendingInvite mirrors GET /api/kb/{id}/members' `pending` array
// (kbmembers.PendingInvite: username/role/createdAt).
interface PendingMemberInvite {
    username: string;
    role: string;
    createdAt: string;
}

interface MembersModalProps {
    show: boolean;
    onClose: () => void;
    sharingKb: KnowledgeBase | null;
    shareUserId: string;
    setShareUserId: (id: string) => void;
    shareTargetUser: { id: string; username: string; firstName?: string; lastName?: string } | null;
    shareLoading: boolean;
    sharePermission: KbAssignableRole;
    setSharePermission: (perm: KbAssignableRole) => void;
    onLookupUser: () => void;
    onConfirmShare: () => void;
    /** Username the lookup could not resolve — offer a pending invite for it. */
    notFoundUsername: string | null;
    /** Called after a pending invite is created, so the parent can reset its lookup state. */
    onPendingInvited: () => void;
    /** Caller's own role on this KB — gates the ownership-transfer action. */
    myRole: string;
}

// Assignable roles for the per-member <select> and the invite pickers. Never
// includes 'owner' — ownership moves only via the explicit transfer action,
// mirroring the backend's kbaccess.Assignable check on PUT /members/{userId}
// and POST /members/bulk.
const ASSIGNABLE_ROLES: KbAssignableRole[] = ['view', 'edit', 'admin'];

// ROLE_LABEL_KEY maps a role onto its translation key. Kept as
// lookup tables so the label of a role is defined once, rather than as a
// ternary chain repeated at each of the four places a role is rendered.
const ROLE_LABEL_KEY: Record<KbAssignableRole, string> = {
    view: 'viewPermission',
    edit: 'editPermission',
    admin: 'adminPermission',
};

const ROLE_ICON: Record<KbAssignableRole, typeof Eye> = {
    view: Eye,
    edit: Edit3,
    admin: Shield,
};

interface RoleSelectProps {
    value: KbAssignableRole;
    onChange: (role: KbAssignableRole) => void;
    /** Accessible name; the trigger shows only the chosen role. */
    label: string;
    t: (k: string) => string;
    disabled?: boolean;
}

/**
 * The role picker used by the invite row, the bulk invite, the invite links
 * and every member row: one DS Select over the three assignable roles. The
 * options carry no descriptions (developer, 2026-10-12).
 */
function RoleSelect({ value, onChange, label, t, disabled }: RoleSelectProps) {
    return (
        <Select value={value} onValueChange={(v) => onChange(v as KbAssignableRole)} disabled={disabled}>
            <SelectTrigger aria-label={label} className="w-36 shrink-0">
                <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
                {ASSIGNABLE_ROLES.map(role => (
                    <SelectItem key={role} value={role}>{t(ROLE_LABEL_KEY[role])}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

/** Two initials from the name, else from the username. */
function initialsOf(firstName: string | null | undefined, lastName: string | null | undefined, username: string): string {
    const fromName = `${firstName?.trim()[0] ?? ''}${lastName?.trim()[0] ?? ''}`;
    return (fromName || username.slice(0, 2)).toUpperCase();
}

function displayName(firstName: string | null | undefined, lastName: string | null | undefined, username: string): string {
    return [firstName, lastName].filter(Boolean).join(' ').trim() || username;
}

export const MembersModal: React.FC<MembersModalProps> = ({
    show, onClose, sharingKb, shareUserId, setShareUserId, shareTargetUser,
    shareLoading, sharePermission, setSharePermission, onLookupUser, onConfirmShare,
    notFoundUsername, onPendingInvited, myRole,
}) => {
    const { t, language } = useTheme();
    const { token } = useAuth();
    const { showConfirm } = useModalContext();
    const toast = useToast();
    const { errors, validate, clearError } = useFormValidation({
        username: (v) => !v.trim() && t('fieldRequired'),
    });
    const [members, setMembers] = useState<KbMember[]>([]);
    const [loadingMembers, setLoadingMembers] = useState(false);
    const [pendingInvites, setPendingInvites] = useState<PendingMemberInvite[]>([]);
    const [mode, setMode] = useState<'single' | 'bulk' | 'link'>('single');
    const [bulkText, setBulkText] = useState('');
    const [bulkPermission, setBulkPermission] = useState<KbAssignableRole>('view');
    const [bulkLoading, setBulkLoading] = useState(false);
    const [bulkSummary, setBulkSummary] = useState<{ shared: string[]; pending: string[]; alreadyHadAccess: string[] } | null>(null);

    const fetchMembers = useCallback(async () => {
        if (!sharingKb) return;
        setLoadingMembers(true);
        try {
            if (!token) return;

            const res = await axios.get(`${API_BASE_URL}/api/kb/${sharingKb.id}/members`);
            setMembers(res.data.members ?? []);
            setPendingInvites(res.data.pending ?? []);
        } catch (err: unknown) {
            console.error('Failed to fetch members:', err);
            toast.error(t('sharesFetchError'));
        } finally {
            setLoadingMembers(false);
        }
    }, [sharingKb, token, toast, t]);

    useEffect(() => {
        if (show && sharingKb) {
            fetchMembers();
        }
    }, [show, sharingKb, fetchMembers]);

    const [inviteLinks, setInviteLinks] = useState<KbInviteLink[]>([]);
    const [linkLabel, setLinkLabel] = useState('');
    const [linkPermission, setLinkPermission] = useState<KbAssignableRole>('view');
    const [linkLoading, setLinkLoading] = useState(false);

    const fetchInviteLinks = useCallback(async () => {
        if (!sharingKb || !token) return;
        try {
            const res = await axios.get(`${API_BASE_URL}/api/kb/${sharingKb.id}/invite-links`);
            setInviteLinks(res.data.links ?? []);
        } catch (err: unknown) {
            console.error('Failed to fetch invite links:', err);
            toast.error(t('inviteLinkFetchError'));
        }
    }, [sharingKb, token, toast, t]);


    // The full URL is assembled client-side, so the backend never needs to
    // know its own public origin.
    const inviteLinkUrl = (link: KbInviteLink) => `${window.location.origin}/join/${link.token}`;

    const formatInviteLinkLastUsed = (dateStr: string) =>
        new Date(dateStr).toLocaleDateString(language === 'de' ? 'de-DE' : 'en-US', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });

    const handleCreateInviteLink = async () => {
        if (!sharingKb) return;
        setLinkLoading(true);
        try {
            const res = await axios.post(`${API_BASE_URL}/api/kb/${sharingKb.id}/invite-links`, {
                role: linkPermission,
                label: linkLabel.trim(),
            });
            setInviteLinks(prev => [res.data, ...prev]);
            setLinkLabel('');
            toast.success(t('inviteLinkCreated'));
        } catch (err: unknown) {
            console.error('Failed to create invite link:', err);
            toast.error(t('inviteLinkCreateError'));
        } finally {
            setLinkLoading(false);
        }
    };

    const handleCopyInviteLink = async (link: KbInviteLink) => {
        if (await copyToClipboard(inviteLinkUrl(link))) {
            toast.success(t('inviteLinkCopied'));
        } else {
            toast.error(t('clipboardCopyFailed'));
        }
    };

    // Optimistic with rollback, like handleRemoveMember. Unlike a pending
    // invite this destroys something people already hold, so it confirms.
    const handleRevokeInviteLink = async (linkId: string) => {
        if (!sharingKb) return;
        if (!await showConfirm(t('confirmRevokeInviteLink'))) return;
        const prev = inviteLinks;
        setInviteLinks(inviteLinks.filter(l => l.id !== linkId));
        try {
            await axios.delete(`${API_BASE_URL}/api/kb/${sharingKb.id}/invite-links/${linkId}`);
        } catch {
            setInviteLinks(prev);
            toast.error(t('inviteLinkRevokeError'));
        }
    };

    // Parent closes the modal on successful share, so the member list refreshes on re-open.
    const handleConfirmShare = async () => {
        await onConfirmShare();
    };

    const handleRemoveMember = async (userId: string, username: string) => {
        if (!sharingKb) return;
        if (!await showConfirm(t('confirmRemoveShare').replace('{username}', username))) return;

        if (!token) return;

        const prev = members;
        setMembers(members.filter(m => m.userId !== userId));
        try {
            await axios.delete(`${API_BASE_URL}/api/kb/${sharingKb.id}/members/${userId}`);
        } catch {
            setMembers(prev);
            toast.error(t('removeShareError'));
        }
    };

    // Withdraws a not-yet-applied invite. Optimistic with rollback on
    // failure, mirroring handleRemoveMember above — no confirm dialog,
    // matching the old ShareModal.handleRevokePending this replaces
    // (nothing was granted yet, so there's nothing destructive to confirm).
    // url.PathEscape-equivalent encodeURIComponent on the client, since
    // usernames can contain characters that need escaping in a path segment.
    const handleRevokePending = async (username: string) => {
        if (!sharingKb) return;
        const prev = pendingInvites;
        setPendingInvites(pendingInvites.filter(p => p.username !== username));
        try {
            await axios.delete(`${API_BASE_URL}/api/kb/${sharingKb.id}/members/pending/${encodeURIComponent(username)}`);
        } catch {
            setPendingInvites(prev);
            toast.error(t('removeShareError'));
        }
    };

    // Optimistic role change with rollback on failure — mirrors
    // handleRemoveMember above.
    const handleRoleChange = async (userId: string, role: string) => {
        if (!sharingKb) return;
        const prev = members;
        setMembers(members.map(m => m.userId === userId ? { ...m, role: role as KbRole } : m));
        try {
            await axios.put(`${API_BASE_URL}/api/kb/${sharingKb.id}/members/${userId}`, { role });
        } catch {
            setMembers(prev);
            toast.error(t('roleChangeError'));
        }
    };

    const handleMakeOwner = async (userId: string, username: string) => {
        if (!sharingKb) return;
        if (!await showConfirm(t('confirmMakeOwner').replace('{username}', username))) return;
        try {
            await axios.post(`${API_BASE_URL}/api/kb/${sharingKb.id}/transfer-owner`, { userId });
            await fetchMembers();
        } catch {
            toast.error(t('roleChangeError'));
        }
    };

    const handleBulkInvite = async () => {
        if (!sharingKb) return;
        const usernames = splitUsernames(bulkText);
        if (usernames.length === 0) return;
        setBulkLoading(true);
        try {
            const res = await axios.post(`${API_BASE_URL}/api/kb/${sharingKb.id}/members/bulk`, {
                usernames,
                role: bulkPermission,
            });
            setBulkSummary(res.data);
            setBulkText('');
            await fetchMembers(); // refresh members + pending lists
        } catch (err: unknown) {
            console.error('Bulk invite failed:', err);
            toast.error(t('bulkInviteError'));
        } finally {
            setBulkLoading(false);
        }
    };

    const [pendingInviteLoading, setPendingInviteLoading] = useState(false);

    // Invite a username with no account yet. Reuses the bulk endpoint, which
    // already parks unknown usernames in pending_kb_invites; they are promoted
    // to a real membership on the user's first login.
    const handleInviteAnyway = async () => {
        if (!sharingKb || !notFoundUsername) return;
        setPendingInviteLoading(true);
        try {
            await axios.post(`${API_BASE_URL}/api/kb/${sharingKb.id}/members/bulk`, {
                usernames: [notFoundUsername],
                role: sharePermission,
            });
            await fetchMembers(); // surface the new invite in the pending list below
            toast.success(t('inviteAnywaySuccess').replace('{username}', notFoundUsername));
            onPendingInvited();
        } catch (err: unknown) {
            console.error('Pending invite failed:', err);
            toast.error(t('bulkInviteError'));
        } finally {
            setPendingInviteLoading(false);
        }
    };

    // The single invite is a two-step exact lookup (no user directory search,
    // developer 2026-10-12): Enter or "Einladen" resolves the typed username,
    // the person appears under the field, and the same key or button then
    // invites them with the role beside the field.
    const typed = shareUserId.trim().toLowerCase();
    const candidate = shareTargetUser && shareTargetUser.username.toLowerCase() === typed ? shareTargetUser : null;
    const candidateIsMember = candidate ? members.some(m => m.userId === candidate.id) : false;

    const submitSingle = () => {
        if (!validate({ username: shareUserId })) return;
        if (candidate) {
            if (!candidateIsMember) void handleConfirmShare();
            return;
        }
        onLookupUser();
    };

    const usernameId = useId();
    const usernameErrorId = useId();
    const membersHeadingId = useId();

    if (!show) return null;

    const memberActions = (m: KbMember): ActionMenuItem[] => {
        const canTransfer = myRole === 'owner' && m.role === 'admin';
        return [
            ...(canTransfer ? [{
                label: t('makeOwner'),
                icon: <Crown className="size-4" aria-hidden="true" />,
                onSelect: () => { void handleMakeOwner(m.userId, m.username); },
            }] : []),
            {
                label: t('removeShare'),
                icon: <Trash2 className="size-4" aria-hidden="true" />,
                destructive: true,
                separatorBefore: canTransfer,
                onSelect: () => { void handleRemoveMember(m.userId, m.username); },
            },
        ];
    };

    return (
        <Dialog open={show} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent closeLabel={t('close')} className="max-w-xl" aria-describedby={undefined}>
                <DialogHeader>
                    <p className="m-0 truncate text-sm text-on-surface-variant">{sharingKb?.name}</p>
                    <DialogTitle>{t('members')}</DialogTitle>
                </DialogHeader>

                <Tabs value={mode} onValueChange={(v) => {
                    setMode(v as typeof mode);
                    setBulkSummary(null);
                    // Only fetched when the tab is opened: most sessions never
                    // touch invite links, and the modal already fetches on mount.
                    if (v === 'link') void fetchInviteLinks();
                }}>
                    <TabsList aria-label={t('members')}>
                        <TabsTrigger value="single"><User className="size-4" aria-hidden="true" />{t('singleShare')}</TabsTrigger>
                        <TabsTrigger value="bulk"><Users className="size-4" aria-hidden="true" />{t('bulkInvite')}</TabsTrigger>
                        <TabsTrigger value="link"><Link2 className="size-4" aria-hidden="true" />{t('inviteLinks')}</TabsTrigger>
                    </TabsList>

                    <TabsContent value="single">
                        <form
                            className="flex flex-col gap-stack-sm"
                            onSubmit={(e) => { e.preventDefault(); submitSingle(); }}
                        >
                            <Label htmlFor={usernameId}>{t('invitePerson')}</Label>
                            <div className="flex items-center gap-stack-sm">
                                <Input
                                    id={usernameId}
                                    leadingIcon={<Search />}
                                    value={shareUserId}
                                    onChange={e => { setShareUserId(e.target.value); clearError('username'); }}
                                    placeholder={t('username')}
                                    autoComplete="off"
                                    aria-invalid={errors.username ? true : undefined}
                                    aria-describedby={errors.username ? usernameErrorId : undefined}
                                />
                                {typed && (
                                    <RoleSelect value={sharePermission} onChange={setSharePermission} label={t('selectPermission')} t={t} />
                                )}
                                <Button type="submit" disabled={!typed || shareLoading || candidateIsMember}>
                                    {shareLoading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                                    {t('inviteAction')}
                                </Button>
                            </div>
                            {errors.username && <span id={usernameErrorId} className="field-error" role="alert">{errors.username}</span>}

                            {candidate && (
                                <div
                                    data-testid="invite-candidate"
                                    className="flex items-center gap-3 rounded-lg bg-surface-container-high px-3 py-2"
                                >
                                    <Avatar initials={initialsOf(candidate.firstName, candidate.lastName, candidate.username)} size="sm" />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate font-medium text-on-surface">
                                            {displayName(candidate.firstName, candidate.lastName, candidate.username)}
                                        </div>
                                        <div className="truncate text-sm text-on-surface-variant">@{candidate.username}</div>
                                    </div>
                                    {candidateIsMember
                                        ? <span className="text-sm text-on-surface-variant">{t('alreadyMember')}</span>
                                        : <Kbd aria-hidden="true">Enter ↵</Kbd>}
                                </div>
                            )}

                            {notFoundUsername && !candidate && (
                                <div role="status" className="flex flex-col gap-stack-sm rounded-lg border border-outline-variant p-3">
                                    <div className="flex items-center gap-2 font-medium text-on-surface">
                                        <Clock className="size-4 shrink-0" aria-hidden="true" />
                                        {t('noAccountYet').replace('{username}', notFoundUsername)}
                                    </div>
                                    <p className="m-0 text-sm text-on-surface-variant">{t('pendingInviteHint')}</p>
                                    <div>
                                        <Button type="button" variant="secondary" size="sm" onClick={handleInviteAnyway} disabled={pendingInviteLoading}>
                                            {pendingInviteLoading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                                            {t('inviteAnyway')}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </form>
                    </TabsContent>

                    <TabsContent value="bulk">
                        <div className="flex flex-col gap-stack-sm">
                            <Label htmlFor="bulk-usernames">{t('bulkInvite')}</Label>
                            <Textarea
                                id="bulk-usernames"
                                value={bulkText}
                                onChange={e => setBulkText(e.target.value)}
                                placeholder={t('bulkInvitePaste')}
                                rows={5}
                            />
                            <div className="flex items-center justify-end gap-stack-sm">
                                <RoleSelect value={bulkPermission} onChange={setBulkPermission} label={t('selectPermission')} t={t} />
                                <Button onClick={handleBulkInvite} disabled={bulkLoading || splitUsernames(bulkText).length === 0}>
                                    {bulkLoading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                                    {t('bulkInviteButton')}
                                </Button>
                            </div>
                            {bulkSummary && (
                                <p className="m-0 text-sm text-on-surface-variant" role="status">
                                    {t('bulkInviteSummary')
                                        .replace('{shared}', String(bulkSummary.shared.length))
                                        .replace('{pending}', String(bulkSummary.pending.length))
                                        .replace('{already}', String(bulkSummary.alreadyHadAccess.length))}
                                </p>
                            )}
                        </div>
                    </TabsContent>

                    <TabsContent value="link">
                        <div className="flex flex-col gap-stack-sm">
                            <Label htmlFor="invite-link-label">{t('inviteLinkLabel')}</Label>
                            <div className="flex items-center gap-stack-sm">
                                <Input
                                    id="invite-link-label"
                                    value={linkLabel}
                                    onChange={e => setLinkLabel(e.target.value)}
                                    maxLength={100}
                                    placeholder={t('inviteLinkLabelPlaceholder')}
                                />
                                <RoleSelect value={linkPermission} onChange={setLinkPermission} label={t('selectPermission')} t={t} />
                                <Button onClick={handleCreateInviteLink} disabled={linkLoading}>
                                    {linkLoading
                                        ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                                        : <Link2 className="size-4" aria-hidden="true" />}
                                    {t('createInviteLink')}
                                </Button>
                            </div>

                            {inviteLinks.length === 0 ? (
                                <p className="m-0 text-sm text-on-surface-variant">{t('noInviteLinks')}</p>
                            ) : (
                                <ul className="m-0 flex list-none flex-col divide-y divide-outline-variant rounded-xl border border-outline-variant p-0">
                                    {inviteLinks.map(link => {
                                        const Icon = ROLE_ICON[link.role];
                                        return (
                                            <li key={link.id} className="flex items-center gap-stack-sm px-4 py-3">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2 text-on-surface">
                                                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                                                        <span className="truncate font-medium">{link.label || t('inviteLinkUnnamed')}</span>
                                                        <span className="shrink-0 text-sm text-on-surface-variant">{t(ROLE_LABEL_KEY[link.role])}</span>
                                                    </div>
                                                    <div className="text-sm text-on-surface-variant">
                                                        {link.redemptionCount === 0
                                                            ? t('inviteLinkNeverUsed')
                                                            : `${t('inviteLinkUses')}: ${link.redemptionCount}`}
                                                        {link.lastUsedAt && (
                                                            <> · {t('inviteLinkLastUsed')}: {formatInviteLinkLastUsed(link.lastUsedAt)}</>
                                                        )}
                                                    </div>
                                                </div>
                                                <Button variant="ghost" size="icon" onClick={() => handleCopyInviteLink(link)} aria-label={t('copyToClipboard')}>
                                                    <Copy className="size-4" aria-hidden="true" />
                                                </Button>
                                                <Button variant="ghost" size="icon" onClick={() => handleRevokeInviteLink(link.id)} aria-label={t('revokeInviteLink')}>
                                                    <Trash2 className="size-4" aria-hidden="true" />
                                                </Button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </TabsContent>
                </Tabs>

                {members.length > 0 && (
                    <section aria-labelledby={membersHeadingId} className="flex flex-col gap-stack-sm">
                        <div className="flex items-center gap-2">
                            <h3 id={membersHeadingId} className="m-0 text-base font-semibold text-on-surface">{t('members')}</h3>
                            <Badge>{members.length}</Badge>
                            {loadingMembers && <Loader2 className="size-4 animate-spin text-on-surface-variant" aria-hidden="true" />}
                        </div>
                        <ul className="m-0 flex max-h-72 list-none flex-col divide-y divide-outline-variant overflow-y-auto rounded-xl border border-outline-variant p-0">
                            {members.map(m => (
                                <li key={m.userId} data-testid={`member-row-${m.userId}`} className="flex items-center gap-3 px-4 py-3">
                                    <Avatar initials={initialsOf(m.firstName, m.lastName, m.username)} />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate font-medium text-on-surface">{displayName(m.firstName, m.lastName, m.username)}</div>
                                        <div className="truncate text-sm text-on-surface-variant">@{m.username}</div>
                                    </div>
                                    {m.role === 'owner' ? (
                                        <Badge tone="warning" title={t('ownerLabel')}>
                                            <Crown className="size-3" aria-hidden="true" />
                                            {t('kbRoleOwner')}
                                        </Badge>
                                    ) : (
                                        <>
                                            <RoleSelect
                                                value={m.role as KbAssignableRole}
                                                onChange={(role) => { void handleRoleChange(m.userId, role); }}
                                                label={`${t('selectRole')}: @${m.username}`}
                                                t={t}
                                            />
                                            <ActionMenu
                                                label={t('memberActions').replace('{username}', m.username)}
                                                actions={memberActions(m)}
                                                align="end"
                                            />
                                        </>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {pendingInvites.length > 0 && (
                    <section className="flex flex-col gap-stack-sm">
                        <h3 className="m-0 text-base font-semibold text-on-surface">{t('pendingInvites')}</h3>
                        <p className="m-0 text-sm text-on-surface-variant">{t('pendingInviteHint')}</p>
                        <ul className="m-0 flex max-h-48 list-none flex-col divide-y divide-outline-variant overflow-y-auto rounded-xl border border-outline-variant p-0">
                            {pendingInvites.map(p => (
                                <li key={p.username} data-testid={`pending-row-${p.username}`} className="flex items-center gap-3 px-4 py-2">
                                    <Clock className="size-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
                                    <span className="min-w-0 flex-1 truncate text-on-surface">@{p.username}</span>
                                    <span className="shrink-0 text-sm text-on-surface-variant">
                                        {t(ROLE_LABEL_KEY[p.role as KbAssignableRole] ?? 'viewPermission')}
                                    </span>
                                    <Button variant="ghost" size="icon" onClick={() => handleRevokePending(p.username)} aria-label={t('revokeInvite')} title={t('revokeInvite')}>
                                        <Trash2 className="size-4" aria-hidden="true" />
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
            </DialogContent>
        </Dialog>
    );
};
