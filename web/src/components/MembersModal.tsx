import React, { useState, useEffect, useCallback, useId, useRef } from 'react';
import { AtSign, ChevronLeft, Clock, Copy, Crown, Edit3, Eye, Link2, Loader2, Plus, Shield, Trash2 } from 'lucide-react';
import {
    ActionMenu, Avatar, Badge, Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input, Label,
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

/** Badge tone per role on the invite links: read neutral, edit primary, admin secondary. */
const ROLE_TONE: Record<KbAssignableRole, 'neutral' | 'primary' | 'secondary'> = {
    view: 'neutral',
    edit: 'primary',
    admin: 'secondary',
};

interface RoleSelectProps {
    /** For a visible <Label htmlFor>. */
    id?: string;
    /** Full width of its column instead of the compact row width. */
    wide?: boolean;
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
function RoleSelect({ id, wide, value, onChange, label, t, disabled }: RoleSelectProps) {
    return (
        <Select value={value} onValueChange={(v) => onChange(v as KbAssignableRole)} disabled={disabled}>
            <SelectTrigger id={id} aria-label={label} className={wide ? 'w-full max-w-xs' : 'w-36 shrink-0'}>
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

export const MembersModal: React.FC<MembersModalProps> = ({ show, onClose, sharingKb, myRole }) => {
    const { t, language } = useTheme();
    const { token } = useAuth();
    const { showConfirm } = useModalContext();
    const toast = useToast();
    const [members, setMembers] = useState<KbMember[]>([]);
    const [loadingMembers, setLoadingMembers] = useState(false);
    const [pendingInvites, setPendingInvites] = useState<PendingMemberInvite[]>([]);
    // Two views in one dialog (mockup, 2026-10-12): the member list, and
    // "Mitglieder hinzufügen" with its two tabs.
    const [view, setView] = useState<'members' | 'add'>('members');
    const [addTab, setAddTab] = useState<'usernames' | 'links'>('usernames');
    const [bulkText, setBulkText] = useState('');
    const [bulkPermission, setBulkPermission] = useState<KbAssignableRole>('view');
    const [bulkLoading, setBulkLoading] = useState(false);

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
        if (!linkLabel.trim()) return;
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
            // Unknown usernames are parked as pending invites and granted at the
            // person's first login (kept, developer 2026-10-12): the summary says
            // how many of each.
            const summary = res.data as { shared: string[]; pending: string[]; alreadyHadAccess: string[] };
            toast.success(t('bulkInviteSummary')
                .replace('{shared}', String(summary.shared.length))
                .replace('{pending}', String(summary.pending.length))
                .replace('{already}', String(summary.alreadyHadAccess.length)));
            setBulkText('');
            setView('members');
            await fetchMembers(); // refresh members + pending lists
        } catch (err: unknown) {
            console.error('Bulk invite failed:', err);
            toast.error(t('bulkInviteError'));
        } finally {
            setBulkLoading(false);
        }
    };

    // "CSV hochladen": the file's usernames are appended to the field, so the
    // owner can still edit the list before adding. Any separator splitUsernames
    // knows (comma, whitespace, newline); a header cell "username" is dropped.
    const csvRef = useRef<HTMLInputElement>(null);
    const handleCsv = async (file: File | undefined) => {
        if (!file) return;
        const names = splitUsernames((await file.text()).replace(/;/g, ','))
            .filter(n => !/^(username|benutzername|user)$/i.test(n));
        setBulkText(prev => [...splitUsernames(prev), ...names].join('\n'));
        if (csvRef.current) csvRef.current.value = '';
    };

    const bulkCount = splitUsernames(bulkText).length;
    const usernamesId = useId();
    const usernamesHintId = useId();
    const roleId = useId();
    const linkTitleId = useId();
    const linkRoleId = useId();
    const membersHeadingId = useId();
    const linksHeadingId = useId();

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

    const openAdd = () => { setView('add'); if (addTab === 'links') void fetchInviteLinks(); };

    return (
        <Dialog open={show} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent closeLabel={t('close')} className="max-w-xl" aria-describedby={undefined}>
                {view === 'members' ? (
                    <>
                        <div className="flex items-start gap-stack-sm pr-10">
                            <DialogHeader className="min-w-0 flex-1">
                                <p className="m-0 truncate text-sm text-on-surface-variant">{sharingKb?.name}</p>
                                <DialogTitle>{t('members')}</DialogTitle>
                            </DialogHeader>
                            <Button onClick={openAdd}>
                                <Plus className="size-4" aria-hidden="true" />
                                {t('add')}
                            </Button>
                        </div>

                        <section aria-labelledby={membersHeadingId} className="flex flex-col gap-stack-sm">
                            <div className="flex items-center gap-2">
                                <h3 id={membersHeadingId} className="m-0 text-base font-semibold text-on-surface">{t('allMembers')}</h3>
                                <Badge>{members.length}</Badge>
                                {loadingMembers && <Loader2 className="size-4 animate-spin text-on-surface-variant" aria-hidden="true" />}
                            </div>
                            {members.length > 0 && (
                                <ul className="m-0 flex max-h-80 list-none flex-col divide-y divide-outline-variant overflow-y-auto rounded-xl border border-outline-variant p-0">
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
                            )}
                        </section>

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
                    </>
                ) : (
                    <>
                        <div className="flex items-start gap-2 pr-10">
                            <Button variant="ghost" size="icon" onClick={() => setView('members')} aria-label={t('back')}>
                                <ChevronLeft className="size-5" aria-hidden="true" />
                            </Button>
                            <DialogHeader className="min-w-0 flex-1">
                                <p className="m-0 truncate text-sm text-on-surface-variant">{sharingKb?.name}</p>
                                <DialogTitle>{t('addMembers')}</DialogTitle>
                            </DialogHeader>
                        </div>

                        <Tabs value={addTab} onValueChange={(v) => {
                            setAddTab(v as typeof addTab);
                            // Only fetched when the tab is opened: most sessions never
                            // touch invite links.
                            if (v === 'links') void fetchInviteLinks();
                        }}>
                            <TabsList variant="segmented" aria-label={t('addMembers')} className="self-start">
                                <TabsTrigger value="usernames"><AtSign className="size-4" aria-hidden="true" />{t('byUsername')}</TabsTrigger>
                                <TabsTrigger value="links"><Link2 className="size-4" aria-hidden="true" />{t('inviteLinks')}</TabsTrigger>
                            </TabsList>

                            <TabsContent value="usernames">
                                <form
                                    className="flex flex-col gap-stack-md"
                                    onSubmit={(e) => { e.preventDefault(); void handleBulkInvite(); }}
                                >
                                    <div className="flex flex-col gap-stack-sm">
                                        <div className="flex items-center justify-between gap-stack-sm">
                                            <Label htmlFor={usernamesId}>{t('usernamesLabel')}</Label>
                                            <Button type="button" variant="link" size="sm" onClick={() => csvRef.current?.click()}>
                                                {t('uploadCsv')}
                                            </Button>
                                            <Input
                                                ref={csvRef}
                                                type="file"
                                                accept=".csv,.txt,text/csv,text/plain"
                                                hidden
                                                aria-label={t('uploadCsv')}
                                                onChange={(e) => { void handleCsv(e.target.files?.[0]); }}
                                            />
                                        </div>
                                        <p id={usernamesHintId} className="m-0 text-sm text-on-surface-variant">{t('usernamesHint')}</p>
                                        {/* A plain textarea until the design system's Combobox gains a
                                            chips mode; then each name becomes a chip with its avatar. */}
                                        <Textarea
                                            id={usernamesId}
                                            aria-describedby={usernamesHintId}
                                            value={bulkText}
                                            onChange={e => setBulkText(e.target.value)}
                                            rows={4}
                                        />
                                    </div>
                                    <div className="flex flex-col gap-stack-sm">
                                        <Label htmlFor={roleId}>{t('roleLabel')}</Label>
                                        <RoleSelect id={roleId} value={bulkPermission} onChange={setBulkPermission} label={t('roleLabel')} t={t} wide />
                                    </div>
                                    <div className="flex items-center justify-end gap-stack-sm border-t border-outline-variant pt-4">
                                        <Button type="button" variant="ghost" onClick={() => setView('members')}>{t('cancel')}</Button>
                                        <Button type="submit" disabled={bulkLoading || bulkCount === 0}>
                                            {bulkLoading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                                            {(bulkCount === 1 ? t('addOnePerson') : t('addNPeople')).replace('{count}', String(bulkCount))}
                                        </Button>
                                    </div>
                                </form>
                            </TabsContent>

                            <TabsContent value="links">
                                <div className="flex flex-col gap-stack-md">
                                    <form
                                        className="flex flex-col gap-stack-sm"
                                        onSubmit={(e) => { e.preventDefault(); void handleCreateInviteLink(); }}
                                    >
                                        <h3 className="m-0 text-base font-semibold text-on-surface">{t('newInviteLink')}</h3>
                                        <div className="flex items-end gap-stack-sm">
                                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                                                <Label htmlFor={linkTitleId}>{t('inviteLinkTitle')} <span aria-hidden="true" className="text-error">*</span></Label>
                                                <Input
                                                    id={linkTitleId}
                                                    value={linkLabel}
                                                    onChange={e => setLinkLabel(e.target.value)}
                                                    maxLength={100}
                                                    required
                                                    placeholder={t('inviteLinkLabelPlaceholder')}
                                                />
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <Label htmlFor={linkRoleId}>{t('roleLabel')} <span aria-hidden="true" className="text-error">*</span></Label>
                                                <RoleSelect id={linkRoleId} value={linkPermission} onChange={setLinkPermission} label={t('roleLabel')} t={t} />
                                            </div>
                                            <Button type="submit" size="field" disabled={linkLoading || !linkLabel.trim()}>
                                                {linkLoading
                                                    ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                                                    : <Plus className="size-4" aria-hidden="true" />}
                                                {t('create')}
                                            </Button>
                                        </div>
                                        <p className="m-0 text-sm text-on-surface-variant">{t('inviteLinkRoleHint')}</p>
                                    </form>

                                    <section aria-labelledby={linksHeadingId} className="flex flex-col gap-stack-sm">
                                        <div className="flex items-center gap-2">
                                            <h3 id={linksHeadingId} className="m-0 text-base font-semibold text-on-surface">{t('activeInviteLinks')}</h3>
                                            <Badge>{inviteLinks.length}</Badge>
                                        </div>
                                        {inviteLinks.length === 0 ? (
                                            <p className="m-0 text-sm text-on-surface-variant">{t('noInviteLinks')}</p>
                                        ) : (
                                            <ul className="m-0 flex max-h-72 list-none flex-col divide-y divide-outline-variant overflow-y-auto rounded-xl border border-outline-variant p-0">
                                                {inviteLinks.map(link => {
                                                    const Icon = ROLE_ICON[link.role];
                                                    const title = link.label || t('inviteLinkUnnamed');
                                                    return (
                                                        <li key={link.id} className="flex items-center gap-3 px-4 py-3">
                                                            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant">
                                                                <Link2 className="size-4" aria-hidden="true" />
                                                            </span>
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex min-w-0 items-center gap-2">
                                                                    <span className="truncate font-medium text-on-surface">{title}</span>
                                                                    <Badge tone={ROLE_TONE[link.role]}>
                                                                        <Icon className="size-3" aria-hidden="true" />
                                                                        {t(ROLE_LABEL_KEY[link.role])}
                                                                    </Badge>
                                                                </div>
                                                                <div
                                                                    className="text-sm text-on-surface-variant"
                                                                    title={link.lastUsedAt ? `${t('inviteLinkLastUsed')}: ${formatInviteLinkLastUsed(link.lastUsedAt)}` : undefined}
                                                                >
                                                                    {link.redemptionCount === 0
                                                                        ? t('inviteLinkNeverUsed')
                                                                        : t('inviteLinkUsedTimes').replace('{count}', String(link.redemptionCount))}
                                                                </div>
                                                            </div>
                                                            <Button variant="outline" size="sm" onClick={() => handleCopyInviteLink(link)} aria-label={`${t('copy')}: ${title}`}>
                                                                <Copy className="size-4" aria-hidden="true" />
                                                                {t('copy')}
                                                            </Button>
                                                            <ActionMenu
                                                                label={t('inviteLinkActions').replace('{label}', title)}
                                                                align="end"
                                                                actions={[{
                                                                    label: t('revokeInviteLink'),
                                                                    icon: <Trash2 className="size-4" aria-hidden="true" />,
                                                                    destructive: true,
                                                                    onSelect: () => { void handleRevokeInviteLink(link.id); },
                                                                }]}
                                                            />
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        )}
                                    </section>

                                    <div className="flex justify-end border-t border-outline-variant pt-4">
                                        <Button variant="outline" onClick={() => setView('members')}>{t('done')}</Button>
                                    </div>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};
