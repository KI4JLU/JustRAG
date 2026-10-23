import { useState } from 'react';
import type React from 'react';
import { Check, Crown, Eye, Info, Lock, Pencil, Shield, UserPlus } from 'lucide-react';
import {
    Button, Checkbox, HoverCard, HoverCardContent, HoverCardTrigger, Alert, AlertDescription, PanelSection, SegmentedControl, SettingsRow, Switch,
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import type { KbRole, KbSourceFlag, KbSourceFlags } from '../../types';
import {
    KB_ALWAYS_ALL_ROLES, KB_CONFIGURABLE_ROLES, KB_RIGHT_GROUPS, KB_ROLE_COLUMNS, resolveRightCell,
    type KbRight, type KbRightState,
} from '../../utils/kbRoleRights';

const ROLE_ICON: Record<KbRole, typeof Eye> = { owner: Crown, admin: Shield, edit: Pencil, view: Eye };
const ROLE_LABEL_KEY: Record<KbRole, string> = {
    owner: 'kbRoleOwner', admin: 'kbRoleAdmin', edit: 'kbRoleEdit', view: 'kbRoleView',
};
/** The role header's rich tooltip: one sentence, a bullet list, "Nicht änderbar" for fixed roles. */
const ROLE_TIP: Record<KbRole, { lead: string; bullets: string[] }> = {
    owner: { lead: 'rrRoleOwnerTipLead', bullets: ['rrTipAlwaysAll', 'rrTipOwnerInvite', 'rrTipOwnerGrant'] },
    admin: { lead: 'rrRoleAdminTipLead', bullets: ['rrTipAlwaysAll', 'rrTipAdminInvite', 'rrTipAdminGrant'] },
    edit: { lead: 'rrRoleEditTipLead', bullets: ['rrTipConfigurable', 'rrTipNoRoles'] },
    view: { lead: 'rrRoleViewTipLead', bullets: ['rrTipConfigurable', 'rrTipNeverEdit', 'rrTipNoRoles'] },
};
/** One-line description under the narrow layout's role switcher. */
const ROLE_DESC_KEY: Partial<Record<KbRole, string>> = { edit: 'rrRoleEditDesc', view: 'rrRoleViewDesc' };
const RIGHT_LABEL_KEY: Record<KbRight, string> = {
    invite: 'rrRightInvite', seeSources: 'rrRightSeeSources', addSources: 'rrRightAddSources',
    downloadSources: 'rrRightDownloadSources', editSources: 'rrRightEditSources', seeCitations: 'rrRightSeeCitations',
};
const RIGHT_HINT_KEY: Record<KbRight, string> = {
    invite: 'rrRightInviteHint', seeSources: 'rrRightSeeSourcesHint', addSources: 'rrRightAddSourcesHint',
    downloadSources: 'rrRightDownloadSourcesHint', editSources: 'rrRightEditSourcesHint', seeCitations: 'rrRightSeeCitationsHint',
};
const GROUP_LABEL_KEY = { topic: 'rrGroupTopic', sidebar: 'rrGroupSidebar', answers: 'rrGroupAnswers' } as const;

/** The last right of the last group: where the muted column bands end. */
const LAST_RIGHT = KB_RIGHT_GROUPS[KB_RIGHT_GROUPS.length - 1].rights.at(-1);
const isAlwaysAll = (role: KbRole) => KB_ALWAYS_ALL_ROLES.includes(role);
/** Owner + admin read as ONE muted band: joined at their shared side. */
const mutedJoin = (role: KbRole): 'start' | 'end' | undefined =>
    role === 'owner' ? 'start' : role === 'admin' ? 'end' : undefined;

type T = (key: string) => string;
type SetFlag = (flag: KbSourceFlag, value: boolean) => void;

interface KbRolesRightsTabProps {
    /** The editable flags as currently drafted (saved by the panel footer). */
    flags: KbSourceFlags;
    onFlagsChange: (next: KbSourceFlags) => void;
    /** Opens the members dialog ("Personen zuweisen"). */
    onAssignPeople: (e: React.MouseEvent) => void;
}

/**
 * "Rollen & Rechte" tab of Thema-Einstellungen (mockup of 2026-10-16). The
 * model lives in utils/kbRoleRights.ts.
 *
 * Two layouts, chosen by a container query on the tab (not the viewport: the
 * tab sits in a content column whose width depends on the side panels):
 *   - wide (≥ 560px): a rotated matrix, rights as grouped rows, roles as
 *     columns. Owner and admin always have every right: muted columns with
 *     plain marks, no controls.
 *   - narrow: one role at a time (switcher Bearbeiter | Leser), a switch per
 *     editable right. Owner and admin only appear in the hint box.
 * Both are rendered and CSS shows one. `display: none` takes the other out of
 * the accessibility tree, so a screen reader meets each control once.
 */
export function KbRolesRightsTab({ flags, onFlagsChange, onAssignPeople }: KbRolesRightsTabProps) {
    const { t } = useTheme();
    const [narrowRole, setNarrowRole] = useState<KbRole>('edit');

    const roleLabel = (role: KbRole) => t(ROLE_LABEL_KEY[role]);
    const rightLabel = (right: KbRight) => t(RIGHT_LABEL_KEY[right]);
    const setFlag: SetFlag = (flag, value) => onFlagsChange({ ...flags, [flag]: value });

    const [before, middle, after] = splitTemplate(t('rrAlwaysAll'));
    const alwaysAllHint = (
        <Alert icon={<Lock />}>
            <AlertDescription>
                <p>
                    {before}<strong>{roleLabel('owner')}</strong>
                    {middle}<strong>{roleLabel('admin')}</strong>
                    {after}
                </p>
            </AlertDescription>
        </Alert>
    );

    return (
        <section aria-label={t('kbSettingsTabRoles')} className="@container">
            {/* ── Wide: rotated matrix ─────────────────────────────── */}
            <div className="hidden flex-col gap-4 @min-[560px]:flex" data-testid="rr-wide">
                <div className="flex items-center justify-between gap-3">
                    <p className="m-0 text-sm text-on-surface-variant">{t('rrSubtitle')}</p>
                    <Button variant="outline" onClick={onAssignPeople}>
                        <UserPlus size={16} aria-hidden="true" />
                        {t('rrAssignPeople')}
                    </Button>
                </div>
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent">
                            <TableHead wrap="words" className="align-bottom">{t('rrColRight')}</TableHead>
                            {KB_ROLE_COLUMNS.map(role => {
                                const muted = isAlwaysAll(role);
                                return (
                                    <TableHead
                                        key={role}
                                        wrap="words"
                                        muted={muted}
                                        mutedEdge={muted ? 'top' : undefined}
                                        mutedJoin={mutedJoin(role)}
                                        className="h-auto py-2 text-center align-top"
                                        aria-label={roleLabel(role)}
                                    >
                                        <RoleHeader role={role} label={roleLabel(role)} t={t} />
                                    </TableHead>
                                );
                            })}
                        </TableRow>
                    </TableHeader>
                    {KB_RIGHT_GROUPS.map(g => (
                        // One TableBody per group: the row group the heading's scope="rowgroup" names.
                        <TableBody key={g.id}>
                            <TableRow>
                                {/* Only the first column: a heading spanning the muted columns would cover their band. */}
                                <TableHead section="band" count={g.rights.length}>{t(GROUP_LABEL_KEY[g.id])}</TableHead>
                                {KB_ROLE_COLUMNS.map(role => (
                                    <TableCell key={role} aria-hidden="true" muted={isAlwaysAll(role)} mutedJoin={mutedJoin(role)} />
                                ))}
                            </TableRow>
                            {g.rights.map(right => (
                                <TableRow key={right}>
                                    <TableHead scope="row" wrap="words" className="font-normal text-on-surface" title={t(RIGHT_HINT_KEY[right])}>
                                        {rightLabel(right)}
                                    </TableHead>
                                    {KB_ROLE_COLUMNS.map(role => {
                                        const muted = isAlwaysAll(role);
                                        return (
                                            <TableCell
                                                key={role}
                                                wrap="words"
                                                muted={muted}
                                                mutedEdge={muted && right === LAST_RIGHT ? 'bottom' : undefined}
                                                mutedJoin={mutedJoin(role)}
                                                className="text-center"
                                            >
                                                <WideCell
                                                    state={resolveRightCell(role, right, flags)}
                                                    alwaysAll={muted}
                                                    label={`${roleLabel(role)}: ${rightLabel(right)}`}
                                                    onChange={setFlag}
                                                    t={t}
                                                />
                                            </TableCell>
                                        );
                                    })}
                                </TableRow>
                            ))}
                        </TableBody>
                    ))}
                </Table>
                {alwaysAllHint}
            </div>

            {/* ── Narrow: one role at a time ───────────────────────── */}
            <div className="flex flex-col gap-4 @min-[560px]:hidden" data-testid="rr-narrow">
                <p className="m-0 text-sm text-on-surface-variant">{t('rrSubtitle')}</p>
                <Button variant="outline" onClick={onAssignPeople} className="w-full">
                    <UserPlus size={16} aria-hidden="true" />
                    {t('rrAssignPeople')}
                </Button>
                <SegmentedControl
                    aria-label={t('rrRoleSwitcher')}
                    value={narrowRole}
                    onValueChange={(v) => setNarrowRole(v as KbRole)}
                    options={KB_CONFIGURABLE_ROLES.map(role => {
                        const Icon = ROLE_ICON[role];
                        return { value: role, label: roleLabel(role), icon: <Icon size={16} aria-hidden="true" />, showLabel: true };
                    })}
                    className="flex w-full [&>button]:flex-1"
                />
                <p className="m-0 text-sm text-on-surface-variant">{t(ROLE_DESC_KEY[narrowRole] ?? '')}</p>
                {KB_RIGHT_GROUPS.map(g => (
                    <PanelSection key={g.id} title={t(GROUP_LABEL_KEY[g.id])} className="gap-0">
                        {g.rights.map(right => (
                            <SettingsRow
                                key={right}
                                className="py-3"
                                label={rightLabel(right)}
                                control={(
                                    <NarrowControl
                                        state={resolveRightCell(narrowRole, right, flags)}
                                        label={`${roleLabel(narrowRole)}: ${rightLabel(right)}`}
                                        onChange={setFlag}
                                        t={t}
                                    />
                                )}
                            />
                        ))}
                    </PanelSection>
                ))}
                {alwaysAllHint}
            </div>
        </section>
    );
}

/**
 * A role's column header: icon tile, name and an info button that opens a
 * rich tooltip (HoverCard) on hover and keyboard focus. Radix's HoverCard is
 * not announced by screen readers, so the same text is the button's
 * description. (The whole cell highlighting on hover waits for a DS option.)
 */
function RoleHeader({ role, label, t }: { role: KbRole; label: string; t: T }) {
    const Icon = ROLE_ICON[role];
    const tip = ROLE_TIP[role];
    const locked = isAlwaysAll(role);
    const descId = `rr-role-tip-${role}`;
    const description = [t(tip.lead), ...tip.bullets.map(b => t(b)), ...(locked ? [t('rrTipNotChangeable')] : [])].join('. ');
    return (
        <span className="flex flex-col items-center gap-1">
            <span className="inline-flex size-8 items-center justify-center rounded-md bg-primary-fixed text-on-primary-fixed" aria-hidden="true">
                <Icon size={16} />
            </span>
            <span className="inline-flex items-center gap-0.5 font-semibold text-on-surface">
                {label}
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
                        <p className="m-0 mt-2 text-sm text-on-surface-variant">{t(tip.lead)}</p>
                        <ul className="m-0 mt-2 list-disc pl-5 text-sm">
                            {tip.bullets.map(b => <li key={b}>{t(b)}</li>)}
                        </ul>
                        {locked && (
                            <p className="m-0 mt-3 flex items-center gap-1.5 text-xs text-on-surface-variant">
                                <Lock size={12} aria-hidden="true" />
                                {t('rrTipNotChangeable')}
                            </p>
                        )}
                    </HoverCardContent>
                </HoverCard>
            </span>
            {/* `hidden`: still read through aria-describedby, but not part of the header's name. */}
            <span id={descId} hidden>{description}</span>
        </span>
    );
}

/** Splits "{owner} … {admin} …" into the three text parts around the two names. */
function splitTemplate(s: string): [string, string, string] {
    const [a, rest = ''] = s.split('{owner}');
    const [b, c = ''] = rest.split('{admin}');
    return [a, b, c];
}

/** Accessible name of a read-only cell: "Rolle: Recht — ja/nein[, scope][, why] (fest durch die Rolle)". */
function fixedName(state: Extract<KbRightState, { kind: 'fixed' }>, label: string, t: T) {
    const scope = state.scope ? `, ${t(state.scope)}` : '';
    const why = state.blocked ? `, ${t('rrRequiresSee')}` : '';
    return `${label} — ${t(state.granted ? 'rrGranted' : 'rrDenied')}${scope}${why} (${t('rrFixedCell')})`;
}

function NotApplicable({ label, t }: { label: string; t: T }) {
    return <span role="img" aria-label={`${label} — ${t('rrNotApplicable')}`} title={t('rrNotApplicable')}>–</span>;
}

/** A fixed value as plain text: a check mark, the scope ("bis Admin") or "Nein". */
function FixedValue({ state, label, t }: { state: Extract<KbRightState, { kind: 'fixed' }>; label: string; t: T }) {
    const name = fixedName(state, label, t);
    if (!state.granted) {
        return <span role="img" aria-label={name} title={state.blocked ? t('rrRequiresSee') : undefined}>{t('rrNo')}</span>;
    }
    if (state.scope) return <span role="img" aria-label={name}>{t(state.scope)}</span>;
    return <span role="img" aria-label={name} className="inline-flex align-middle"><Check size={16} aria-hidden="true" /></span>;
}

/** One cell of the wide matrix. */
function WideCell({ state, alwaysAll, label, onChange, t }: {
    state: KbRightState; alwaysAll: boolean; label: string; onChange: SetFlag; t: T;
}) {
    if (state.kind === 'na') return <NotApplicable label={label} t={t} />;
    if (state.kind === 'flag') {
        return (
            <Checkbox
                checked={state.checked}
                disabled={state.blocked}
                aria-label={label}
                title={state.blocked ? t('rrRequiresSee') : undefined}
                onCheckedChange={(v) => onChange(state.flag, v === true)}
            />
        );
    }
    // Owner/admin: plain marks in the muted band. A fixed right of a
    // configurable role that depends on "Sehen" (Bearbeiter → Bearbeiten) is a
    // locked checkbox, so it reads as part of the same row of switches.
    if (alwaysAll || (!state.granted && !state.blocked)) return <FixedValue state={state} label={label} t={t} />;
    return (
        <Checkbox
            locked
            checked={state.granted}
            aria-label={fixedName(state, label, t)}
            title={state.blocked ? t('rrRequiresSee') : undefined}
        />
    );
}

/** The switch or read-only value of one right in the narrow layout. */
function NarrowControl({ state, label, onChange, t }: { state: KbRightState; label: string; onChange: SetFlag; t: T }) {
    if (state.kind === 'na') return <NotApplicable label={label} t={t} />;
    if (state.kind === 'flag') {
        return (
            <Switch
                checked={state.checked}
                disabled={state.blocked}
                aria-label={label}
                title={state.blocked ? t('rrRequiresSee') : undefined}
                onCheckedChange={(v) => onChange(state.flag, v)}
            />
        );
    }
    return <FixedValue state={state} label={label} t={t} />;
}
