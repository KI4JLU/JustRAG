import { useId } from 'react';
import { Clock, Crown, Loader2, Trash2 } from 'lucide-react';
import { ActionMenu, Badge, Button, type ActionMenuItem } from '@ki4jlu/design-system';
import { PersonList, PersonRow } from './PersonList';
import { SharingRoleSelect } from './SharingRoleSelect';
import type { SharedMember, SharedPendingInvite, SharingRole } from './sharing';

interface MemberSectionProps {
    members: readonly SharedMember[];
    loading: boolean;
    roles: readonly SharingRole[];
    ownerRole: string;
    /** The role a row shows: the stored one, or a draft of it. */
    roleOf: (member: SharedMember) => string;
    onRoleChange: (member: SharedMember, role: string) => void;
    /** What a row's menu offers (hand over ownership, remove). */
    actionsOf: (member: SharedMember) => ActionMenuItem[];
    t: (k: string) => string;
}

/** "Alle Mitglieder": everyone holding a role, the owner as a badge and everyone else with a role picker and a menu. */
export function MemberSection({ members, loading, roles, ownerRole, roleOf, onRoleChange, actionsOf, t }: MemberSectionProps) {
    const headingId = useId();
    return (
        <section aria-labelledby={headingId} className="flex flex-col gap-stack-sm">
            <div className="flex items-center gap-2">
                <h3 id={headingId} className="m-0 text-base font-semibold text-on-surface">{t('allMembers')}</h3>
                <Badge>{members.length}</Badge>
                {loading && <Loader2 className="size-4 animate-spin text-on-surface-variant" aria-hidden="true" />}
            </div>
            {members.length > 0 && (
                <PersonList className="max-h-80 overflow-y-auto">
                    {members.map(m => (
                        <PersonRow key={m.userId} data-testid={`member-row-${m.userId}`} firstName={m.firstName} lastName={m.lastName} username={m.username}>
                            {m.role === ownerRole ? (
                                <Badge tone="warning" title={t('ownerLabel')}>
                                    <Crown className="size-3" aria-hidden="true" />
                                    {t('kbRoleOwner')}
                                </Badge>
                            ) : (
                                <>
                                    <SharingRoleSelect
                                        roles={roles}
                                        value={roleOf(m)}
                                        onChange={(role) => onRoleChange(m, role)}
                                        label={`${t('selectRole')}: @${m.username}`}
                                        t={t}
                                    />
                                    <ActionMenu
                                        label={t('memberActions').replace('{username}', m.username)}
                                        actions={actionsOf(m)}
                                        align="end"
                                    />
                                </>
                            )}
                        </PersonRow>
                    ))}
                </PersonList>
            )}
        </section>
    );
}

interface PendingSectionProps {
    pending: readonly SharedPendingInvite[];
    roles: readonly SharingRole[];
    onRevoke: (username: string) => void;
    t: (k: string) => string;
}

/** "Ausstehende Einladungen": names without an account yet, each withdrawable. */
export function PendingSection({ pending, roles, onRevoke, t }: PendingSectionProps) {
    if (pending.length === 0) return null;
    return (
        <section className="flex flex-col gap-stack-sm">
            <h3 className="m-0 text-base font-semibold text-on-surface">{t('pendingInvites')}</h3>
            <p className="m-0 text-sm text-on-surface-variant">{t('pendingInviteHint')}</p>
            <ul className="m-0 flex max-h-48 list-none flex-col divide-y divide-outline-variant overflow-y-auto rounded-xl border border-outline-variant p-0">
                {pending.map(p => (
                    <li key={p.username} data-testid={`pending-row-${p.username}`} className="flex items-center gap-3 px-4 py-2">
                        <Clock className="size-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-on-surface">@{p.username}</span>
                        <span className="shrink-0 text-sm text-on-surface-variant">
                            {t(roles.find(r => r.value === p.role)?.labelKey ?? roles[0].labelKey)}
                        </span>
                        <Button variant="ghost-destructive" size="icon" onClick={() => onRevoke(p.username)} aria-label={t('revokeInvite')} title={t('revokeInvite')}>
                            <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
