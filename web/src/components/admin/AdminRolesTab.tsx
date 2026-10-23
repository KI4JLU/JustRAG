import { Check, Crown, Eye, Info, KeyRound, Lock, Pencil, Shield, ShieldCheck, User } from 'lucide-react';
import {
    Badge, Button, HoverCard, HoverCardContent, HoverCardTrigger, Alert, AlertDescription, PanelSection,
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import type { KbRole } from '../../types';
import { roleLabel as systemRoleLabel } from '../../utils/roleLabel';
import {
    countUsersByRole, SYSTEM_ALWAYS_ALL_ROLE, SYSTEM_RIGHT_GROUPS, SYSTEM_RIGHT_ROUTES, SYSTEM_ROLE_COLUMNS,
    systemRightCell, type SystemRight, type SystemRightGroupId, type SystemRole,
} from '../../utils/systemRoleRights';
import {
    cellRequires, KB_ALWAYS_ALL_ROLES, KB_RIGHT_GROUPS, KB_ROLE_COLUMNS, kbRightCell, SOURCE_FLAG_DEFAULTS,
    type KbRight,
} from '../../utils/kbRoleRights';

type T = (key: string) => string;

const SYSTEM_ROLE_ICON: Record<SystemRole, typeof User> = {
    superadmin: ShieldCheck, admin: Shield, 'api-user': KeyRound, user: User,
};
/** The role header's rich tooltip: one sentence and a bullet list. */
const SYSTEM_ROLE_TIP: Record<SystemRole, { lead: string; bullets: string[] }> = {
    superadmin: { lead: 'arRoleSuperadminTipLead', bullets: ['arTipPassesEveryCheck', 'arTipOwnerEverywhere', 'arTipNotAssignable'] },
    admin: { lead: 'arRoleAdminTipLead', bullets: ['arTipAdminAssigns', 'arTipAdminNoAdmins', 'arTipAdminGlobalTopics'] },
    'api-user': { lead: 'arRoleApiUserTipLead', bullets: ['arTipApiKeys', 'arTipAdvancedAsTopicAdmin'] },
    user: { lead: 'arRoleUserTipLead', bullets: ['arTipPrivateTopics', 'arTipTopicRole'] },
};
const SYSTEM_RIGHT_LABEL_KEY: Record<SystemRight, string> = {
    manageUsers: 'arRightManageUsers', appointAdmins: 'arRightAppointAdmins', deleteUsers: 'arRightDeleteUsers',
    createPrivateTopic: 'arRightCreatePrivateTopic', manageGlobalTopics: 'arRightManageGlobalTopics',
    advancedTopicSettings: 'arRightAdvancedTopicSettings', manageAnyTopic: 'arRightManageAnyTopic',
    apiAccess: 'arRightApiAccess', aiModels: 'arRightAiModels', authProviders: 'arRightAuthProviders',
    monitoring: 'arRightMonitoring',
    systemSettings: 'arRightSystemSettings', auditLogs: 'arRightAuditLogs',
};
const SYSTEM_RIGHT_HINT_KEY: Record<SystemRight, string> = {
    manageUsers: 'arRightManageUsersHint', appointAdmins: 'arRightAppointAdminsHint', deleteUsers: 'arRightDeleteUsersHint',
    createPrivateTopic: 'arRightCreatePrivateTopicHint', manageGlobalTopics: 'arRightManageGlobalTopicsHint',
    advancedTopicSettings: 'arRightAdvancedTopicSettingsHint', manageAnyTopic: 'arRightManageAnyTopicHint',
    apiAccess: 'arRightApiAccessHint', aiModels: 'arRightAiModelsHint', authProviders: 'arRightAuthProvidersHint',
    monitoring: 'arRightMonitoringHint',
    systemSettings: 'arRightSystemSettingsHint', auditLogs: 'arRightAuditLogsHint',
};
const SYSTEM_GROUP_LABEL_KEY: Record<SystemRightGroupId, string> = {
    users: 'arGroupUsers', topics: 'arGroupTopics', system: 'arGroupSystem',
};
const LAST_SYSTEM_RIGHT = SYSTEM_RIGHT_GROUPS[SYSTEM_RIGHT_GROUPS.length - 1].rights.at(-1);

const KB_ROLE_ICON: Record<KbRole, typeof Eye> = { owner: Crown, admin: Shield, edit: Pencil, view: Eye };
const KB_ROLE_LABEL_KEY: Record<KbRole, string> = {
    owner: 'kbRoleOwner', admin: 'kbRoleAdmin', edit: 'kbRoleEdit', view: 'kbRoleView',
};
const KB_RIGHT_LABEL_KEY: Record<KbRight, string> = {
    invite: 'rrRightInvite', seeSources: 'rrRightSeeSources', addSources: 'rrRightAddSources',
    downloadSources: 'rrRightDownloadSources', editSources: 'rrRightEditSources', seeCitations: 'rrRightSeeCitations',
};
const KB_RIGHT_HINT_KEY: Record<KbRight, string> = {
    invite: 'rrRightInviteHint', seeSources: 'rrRightSeeSourcesHint', addSources: 'rrRightAddSourcesHint',
    downloadSources: 'rrRightDownloadSourcesHint', editSources: 'rrRightEditSourcesHint', seeCitations: 'rrRightSeeCitationsHint',
};
const KB_GROUP_LABEL_KEY = { topic: 'rrGroupTopic', sidebar: 'rrGroupSidebar', answers: 'rrGroupAnswers' } as const;
const LAST_KB_RIGHT = KB_RIGHT_GROUPS[KB_RIGHT_GROUPS.length - 1].rights.at(-1);
const isKbAlwaysAll = (role: KbRole) => KB_ALWAYS_ALL_ROLES.includes(role);
/** Owner + admin read as ONE muted band, as in the topic's own Rollen & Rechte tab. */
const kbMutedJoin = (role: KbRole): 'start' | 'end' | undefined =>
    role === 'owner' ? 'start' : role === 'admin' ? 'end' : undefined;

interface AdminRolesTabProps {
    /** GET /api/admin/users as fetched by AdminUI; null while not loaded. */
    users: unknown[] | null;
}

/**
 * Admin panel → "Rollen & Rechte": a read-only reference of what each system
 * role and each topic role may do. Nothing here is editable — roles are code,
 * not data (utils/systemRoleRights.ts, utils/kbRoleRights.ts). Visual language
 * follows the topic's own Rollen & Rechte tab (kbSettings/KbRolesRightsTab):
 * rights as grouped rows, roles as columns, roles that always have everything
 * as a muted band with plain marks.
 */
export default function AdminRolesTab({ users }: AdminRolesTabProps) {
    const { t } = useTheme();
    const counts = users ? countUsersByRole(users) : null;
    const roleCount = (n: number) => t('arRoleCount').replace('{n}', String(n));

    return (
        <div className="flex flex-col gap-8">
            <Alert icon={<Lock />}>
                <AlertDescription>{t('arNotice')}</AlertDescription>
            </Alert>

            <PanelSection
                title={t('arSystemRolesTitle')}
                aside={<Badge tone="neutral">{roleCount(SYSTEM_ROLE_COLUMNS.length)}</Badge>}
                hint={t('arSystemRolesHint')}
                className="gap-4"
            >
                <SystemRolesTable counts={counts} t={t} />
            </PanelSection>

            <PanelSection
                title={t('arKbRolesTitle')}
                aside={<Badge tone="neutral">{roleCount(KB_ROLE_COLUMNS.length)}</Badge>}
                hint={t('arKbRolesHint')}
                className="gap-4"
            >
                <KbRolesTable t={t} />
                <Alert icon={<Info />}>
                    <AlertDescription>{t('arKbFlagsNotice')}</AlertDescription>
                </Alert>
                <div className="flex flex-col gap-2">
                    <h4 className="m-0 text-sm font-semibold text-on-surface">{t('arMappingTitle')}</h4>
                    <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-on-surface-variant">
                        <li><strong className="text-on-surface">{systemRoleLabel('superadmin', t)}</strong>: {t('arMapSuperadmin')}</li>
                        <li><strong className="text-on-surface">{systemRoleLabel('admin', t)}</strong>: {t('arMapAdmin')}</li>
                        <li><strong className="text-on-surface">{t('arMapOthersLabel')}</strong>: {t('arMapOthers')}</li>
                    </ul>
                </div>
            </PanelSection>
        </div>
    );
}

function SystemRolesTable({ counts, t }: { counts: Record<SystemRole, number> | null; t: T }) {
    const label = (role: SystemRole) => systemRoleLabel(role, t);
    const rightLabel = (right: SystemRight) => t(SYSTEM_RIGHT_LABEL_KEY[right]);
    const rightHint = (right: SystemRight) =>
        `${t(SYSTEM_RIGHT_HINT_KEY[right])}\n${t('arRoutes')}: ${SYSTEM_RIGHT_ROUTES[right].join(', ')}`;
    return (
        <Table aria-label={t('arSystemRolesTitle')}>
            <TableHeader>
                <TableRow className="hover:bg-transparent">
                    <TableHead wrap="words" className="align-bottom">{t('rrColRight')}</TableHead>
                    {SYSTEM_ROLE_COLUMNS.map(role => {
                        const muted = role === SYSTEM_ALWAYS_ALL_ROLE;
                        const tip = SYSTEM_ROLE_TIP[role];
                        // aria-label replaces the cell's content for assistive
                        // tech, so the count badge has to be named here too.
                        const badge = counts ? userCount(counts[role], t) : undefined;
                        return (
                            <TableHead
                                key={role}
                                wrap="words"
                                muted={muted}
                                mutedEdge={muted ? 'top' : undefined}
                                className="h-auto py-2 text-center align-top"
                                aria-label={badge ? `${label(role)}, ${badge}` : label(role)}
                            >
                                <RoleHeader
                                    id={`ar-sys-${role}`}
                                    Icon={SYSTEM_ROLE_ICON[role]}
                                    label={label(role)}
                                    tip={{ lead: t(tip.lead), bullets: tip.bullets.map(b => t(b)) }}
                                    badge={badge}
                                    t={t}
                                />
                            </TableHead>
                        );
                    })}
                </TableRow>
            </TableHeader>
            {SYSTEM_RIGHT_GROUPS.map(g => (
                <TableBody key={g.id}>
                    <TableRow>
                        <TableHead section="band" count={g.rights.length}>{t(SYSTEM_GROUP_LABEL_KEY[g.id])}</TableHead>
                        {SYSTEM_ROLE_COLUMNS.map(role => (
                            <TableCell key={role} aria-hidden="true" muted={role === SYSTEM_ALWAYS_ALL_ROLE} />
                        ))}
                    </TableRow>
                    {g.rights.map(right => (
                        <TableRow key={right}>
                            <TableHead scope="row" wrap="words" className="font-normal text-on-surface" title={rightHint(right)}>
                                {rightLabel(right)}
                            </TableHead>
                            {SYSTEM_ROLE_COLUMNS.map(role => {
                                const muted = role === SYSTEM_ALWAYS_ALL_ROLE;
                                const cell = systemRightCell(role, right);
                                return (
                                    <TableCell
                                        key={role}
                                        wrap="words"
                                        muted={muted}
                                        mutedEdge={muted && right === LAST_SYSTEM_RIGHT ? 'bottom' : undefined}
                                        className="text-center"
                                    >
                                        <Mark granted={cell.granted} scope={cell.scope} label={`${label(role)}: ${rightLabel(right)}`} t={t} />
                                    </TableCell>
                                );
                            })}
                        </TableRow>
                    ))}
                </TableBody>
            ))}
        </Table>
    );
}

function KbRolesTable({ t }: { t: T }) {
    const label = (role: KbRole) => t(KB_ROLE_LABEL_KEY[role]);
    const rightLabel = (right: KbRight) => t(KB_RIGHT_LABEL_KEY[right]);
    return (
        <Table aria-label={t('arKbRolesTitle')}>
            <TableHeader>
                <TableRow className="hover:bg-transparent">
                    <TableHead wrap="words" className="align-bottom">{t('rrColRight')}</TableHead>
                    {KB_ROLE_COLUMNS.map(role => {
                        const muted = isKbAlwaysAll(role);
                        return (
                            <TableHead
                                key={role}
                                wrap="words"
                                muted={muted}
                                mutedEdge={muted ? 'top' : undefined}
                                mutedJoin={kbMutedJoin(role)}
                                className="h-auto py-2 text-center align-top"
                                aria-label={label(role)}
                            >
                                <RoleHeader id={`ar-kb-${role}`} Icon={KB_ROLE_ICON[role]} label={label(role)} t={t} />
                            </TableHead>
                        );
                    })}
                </TableRow>
            </TableHeader>
            {KB_RIGHT_GROUPS.map(g => (
                <TableBody key={g.id}>
                    <TableRow>
                        <TableHead section="band" count={g.rights.length}>{t(KB_GROUP_LABEL_KEY[g.id])}</TableHead>
                        {KB_ROLE_COLUMNS.map(role => (
                            <TableCell key={role} aria-hidden="true" muted={isKbAlwaysAll(role)} mutedJoin={kbMutedJoin(role)} />
                        ))}
                    </TableRow>
                    {g.rights.map(right => (
                        <TableRow key={right}>
                            <TableHead scope="row" wrap="words" className="font-normal text-on-surface" title={t(KB_RIGHT_HINT_KEY[right])}>
                                {rightLabel(right)}
                            </TableHead>
                            {KB_ROLE_COLUMNS.map(role => {
                                const muted = isKbAlwaysAll(role);
                                return (
                                    <TableCell
                                        key={role}
                                        wrap="words"
                                        muted={muted}
                                        mutedEdge={muted && right === LAST_KB_RIGHT ? 'bottom' : undefined}
                                        mutedJoin={kbMutedJoin(role)}
                                        className="text-center"
                                    >
                                        <KbReferenceCell role={role} right={right} label={`${label(role)}: ${rightLabel(right)}`} t={t} />
                                    </TableCell>
                                );
                            })}
                        </TableRow>
                    ))}
                </TableBody>
            ))}
        </Table>
    );
}

/** One cell of the topic-role reference: the ladder's fixed value, or "pro Thema" for a per-topic switch. */
function KbReferenceCell({ role, right, label, t }: { role: KbRole; right: KbRight; label: string; t: T }) {
    const cell = kbRightCell(role, right);
    if (cell.kind === 'na') {
        return <span role="img" aria-label={`${label} — ${t('rrNotApplicable')}`} title={t('rrNotApplicable')}>–</span>;
    }
    if (cell.kind === 'flag') {
        const hint = t('arPerTopicHint').replace('{default}', t(SOURCE_FLAG_DEFAULTS[cell.flag] ? 'arDefaultOn' : 'arDefaultOff'));
        return <span role="img" aria-label={`${label} — ${hint}`} title={hint} className="text-on-surface-variant">{t('arPerTopic')}</span>;
    }
    const requires = cellRequires(cell);
    return (
        <Mark
            granted={cell.granted}
            scope={cell.scope}
            label={label}
            note={requires ? t('rrRequiresSee') : undefined}
            t={t}
        />
    );
}

/** A fixed value as plain text: a check mark, the scope ("bis API-Nutzer") or "Nein". */
function Mark({ granted, scope, label, note, t }: { granted: boolean; scope?: string; label: string; note?: string; t: T }) {
    const name = `${label} — ${t(granted ? 'rrGranted' : 'rrDenied')}${scope ? `, ${t(scope)}` : ''}${note ? `, ${note}` : ''}`;
    if (!granted) return <span role="img" aria-label={name}>{t('rrNo')}</span>;
    if (scope) return <span role="img" aria-label={name} title={note}>{t(scope)}</span>;
    return (
        <span role="img" aria-label={name} title={note} className="inline-flex align-middle">
            <Check size={16} aria-hidden="true" />
        </span>
    );
}

function userCount(n: number, t: T): string {
    return t(n === 1 ? 'arUserCountOne' : 'arUserCountOther').replace('{n}', String(n));
}

/**
 * A role's column header: icon tile, name, optionally a badge (users holding
 * the role) and an info button with a rich tooltip. Radix's HoverCard is not
 * announced by screen readers, so its text is also the button's description.
 */
function RoleHeader({ id, Icon, label, tip, badge, t }: {
    id: string;
    Icon: typeof User;
    label: string;
    tip?: { lead: string; bullets: string[] };
    badge?: string;
    t: T;
}) {
    const descId = `${id}-tip`;
    return (
        <span className="flex flex-col items-center gap-1">
            <span className="inline-flex size-8 items-center justify-center rounded-md bg-primary-fixed text-on-primary-fixed" aria-hidden="true">
                <Icon size={16} />
            </span>
            <span className="inline-flex items-center gap-0.5 font-semibold text-on-surface">
                {label}
                {tip && (
                    <HoverCard openDelay={150} closeDelay={100}>
                        <HoverCardTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                aria-label={`${label}: ${t('rrRoleInfo')}`}
                                aria-describedby={descId}
                            >
                                <Info size={14} aria-hidden="true" />
                            </Button>
                        </HoverCardTrigger>
                        <HoverCardContent side="bottom" className="w-72 text-left">
                            <div className="flex items-center gap-2 font-semibold">
                                <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary-fixed text-on-primary-fixed" aria-hidden="true">
                                    <Icon size={14} />
                                </span>
                                {label}
                            </div>
                            <p className="m-0 mt-2 text-sm text-on-surface-variant">{tip.lead}</p>
                            <ul className="m-0 mt-2 list-disc pl-5 text-sm">
                                {tip.bullets.map(b => <li key={b}>{b}</li>)}
                            </ul>
                        </HoverCardContent>
                    </HoverCard>
                )}
            </span>
            {badge && <Badge tone="neutral" className="font-normal">{badge}</Badge>}
            {tip && <span id={descId} hidden>{[tip.lead, ...tip.bullets].join('. ')}</span>}
        </span>
    );
}
