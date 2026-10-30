import { useMemo, useState } from 'react';
import { Info, Search, Trash2 } from 'lucide-react';
import {
    ActionMenu, Badge, BreadcrumbBack, Input, ListToolbar, SettingsRow, useSettingsSearch,
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
    type ActionMenuItem, type BadgeProps,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { displayName } from '../../utils/personName';
import { roleLabel } from '../../utils/roleLabel';
import { PersonList, PersonRow } from '../people/PersonList';
import { Choice } from '../form/Choice';
import { COMPACT_INPUT } from '../form/SettingsFieldRow';
import { ListPagination } from '../ListPagination';

// Role pill tones. Was raw hex per role (#6a1b9a, #2563eb); superadmin →
// secondary is a pick, not a spec: the DS has no purple status tone.
const ROLE_TONE: Record<string, BadgeProps['tone']> = {
    superadmin: 'secondary',
    admin: 'primary',
    'api-user': 'info',
};

const ROLES = ['user', 'api-user', 'admin', 'superadmin'] as const;
const ALL = 'all';

/** The user list is read whole (GET /api/admin/users is unpaged), so it is paged here. */
const PAGE_SIZE = 10;

interface User {
    id: string;
    username: string;
    role: string;
    firstName?: string;
    lastName?: string;
    createdAt?: string;
}

interface AdminUsersTabProps {
    usersList: User[];
    currentUser: User;
    handleRoleChange: (id: string, newRole: string) => void;
    handleDeleteUser: (id: string, username: string) => void;
    loading: boolean;
}

export default function AdminUsersTab({ usersList, currentUser, handleRoleChange, handleDeleteUser, loading }: AdminUsersTabProps) {
    const { t, language } = useTheme();
    const [query, setQuery] = useState('');
    // The user whose info is open: a sub-screen of the section, as „Mitglieder hinzufügen" is of the KB settings.
    const [infoId, setInfoId] = useState<string | null>(null);
    const [role, setRole] = useState<string>(ALL);
    const [page, setPage] = useState(0);

    // The admin dialog's search narrows the list too (name, username, role), so a hit on a later page
    // shows; it gives way to the list's own field while that has text, and when it matches no user.
    const dialogSearch = useSettingsSearch();
    const filtered = useMemo(() => {
        const matching = (q: string) => usersList.filter(u =>
            (role === ALL || u.role === role)
            && (!q || `${displayName(u.firstName, u.lastName, u.username)} ${u.username} ${roleLabel(u.role, t)}`
                .toLocaleLowerCase().includes(q)));
        const own = query.trim().toLocaleLowerCase();
        if (own || !dialogSearch.filtering) return matching(own);
        const fromDialog = matching(dialogSearch.query);
        return fromDialog.length ? fromDialog : matching('');
    }, [usersList, query, role, dialogSearch, t]);

    // A filter that shrinks the list below the current page lands on the last page, not an empty one.
    const lastPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
    const shown = Math.min(page, lastPage);
    const rows = filtered.slice(shown * PAGE_SIZE, (shown + 1) * PAGE_SIZE);

    // Roles an operator may hand out; `admin` only a superadmin may.
    const assignable = ['user', 'api-user', ...(currentUser.role === 'superadmin' ? ['admin'] : [])];
    const canEdit = (u: User) =>
        u.role !== 'superadmin' && u.id !== currentUser.id && !(currentUser.role === 'admin' && u.role === 'admin');

    // Everyone can be looked at; only a superadmin deletes, and only where the role is editable too.
    const actionsFor = (u: User): ActionMenuItem[] => [
        { label: t('userInfo'), icon: <Info className="size-4" aria-hidden="true" />, onSelect: () => setInfoId(u.id) },
        ...(currentUser.role === 'superadmin' && canEdit(u) ? [{
            label: t('deleteUser'),
            icon: <Trash2 className="size-4" aria-hidden="true" />,
            destructive: true,
            separatorBefore: true,
            onSelect: () => handleDeleteUser(u.id, u.username),
        }] : []),
    ];

    if (loading) return <div className="loading-spinner"></div>;
    if (usersList.length === 0) {
        return <p style={{ textAlign: 'center', opacity: 0.5, padding: '3rem', color: 'var(--text-secondary)' }}>{t('noUsersFound')}</p>;
    }

    const infoUser = infoId ? usersList.find(u => u.id === infoId) : undefined;
    if (infoUser) {
        const readOnly = (value: React.ReactNode) => <span className="text-on-surface-variant">{value || '–'}</span>;
        return (
            <div className="flex flex-col gap-4">
                <div className="flex min-w-0 flex-col gap-1.5">
                    <BreadcrumbBack
                        trail={[t('adminTabUsers')]}
                        labels={{ nav: t('breadcrumbNav'), back: t('backTo') }}
                        onClick={() => setInfoId(null)}
                    />
                    <h3 className="m-0 text-lg font-semibold text-on-surface">{t('userInfo')}</h3>
                </div>
                <div className="flex flex-col">
                    <SettingsRow label={t('firstName')} control={readOnly(infoUser.firstName)} />
                    <SettingsRow label={t('lastName')} control={readOnly(infoUser.lastName)} />
                    <SettingsRow label={t('username')} control={readOnly(`@${infoUser.username}`)} />
                    <SettingsRow label={t('role')} control={<Badge tone={ROLE_TONE[infoUser.role] ?? 'neutral'}>{roleLabel(infoUser.role, t)}</Badge>} />
                    <SettingsRow label={t('userInfoMemberSince')} control={readOnly(infoUser.createdAt && new Date(infoUser.createdAt).toLocaleDateString(language, { dateStyle: 'long' }))} />
                    <SettingsRow label={t('userInfoId')}>
                        <span className="break-all font-mono text-sm text-on-surface-variant">{infoUser.id}</span>
                    </SettingsRow>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <ListToolbar
                search={(
                    <Input
                        type="search"
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setPage(0); }}
                        placeholder={t('adminUsersSearch')}
                        aria-label={t('adminUsersSearch')}
                        leadingIcon={<Search aria-hidden="true" />}
                        className={COMPACT_INPUT}
                    />
                )}
                // A framed select, not the DS FilterMenu, in the same compact field as the search next to it.
                filters={(
                    <Select value={role} onValueChange={(v) => { setRole(v); setPage(0); }}>
                        <SelectTrigger aria-label={t('adminUsersFilterRole')} className={`${COMPACT_INPUT} w-full lg:w-52`}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="end">
                            <SelectItem value={ALL}>{t('adminUsersAllRoles')}</SelectItem>
                            {ROLES.map(r => <SelectItem key={r} value={r}>{roleLabel(r, t)}</SelectItem>)}
                        </SelectContent>
                    </Select>
                )}
            />

            {rows.length === 0 ? (
                <p className="m-0 py-8 text-center text-on-surface-variant">{t('adminUsersNoMatch')}</p>
            ) : (
                <PersonList>
                    {rows.map(u => (
                        <PersonRow key={u.id} data-testid={`user-row-${u.id}`} firstName={u.firstName} lastName={u.lastName} username={u.username}>
                            {canEdit(u) ? (
                                <Choice
                                    label={`${t('selectRole')}: @${u.username}`}
                                    value={u.role}
                                    onChange={(v) => handleRoleChange(u.id, v)}
                                    options={assignable.map(r => [r, roleLabel(r, t)] as const)}
                                />
                            ) : (
                                <Badge tone={ROLE_TONE[u.role] ?? 'neutral'}>{roleLabel(u.role, t)}</Badge>
                            )}
                            <ActionMenu label={t('memberActions').replace('{username}', u.username)} actions={actionsFor(u)} align="end" />
                        </PersonRow>
                    ))}
                </PersonList>
            )}

            <ListPagination
                page={shown}
                pageSize={PAGE_SIZE}
                total={filtered.length}
                onPageChange={setPage}
                rangeLabel={({ from, to, total }) => t('paginationRange').replace('{from}', String(from)).replace('{to}', String(to)).replace('{total}', String(total))}
                previousLabel={t('previousPage')}
                nextLabel={t('nextPage')}
            />
        </div>
    );
}
