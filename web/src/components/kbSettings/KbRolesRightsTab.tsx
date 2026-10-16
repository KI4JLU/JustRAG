import type React from 'react';
import { Check, Crown, Eye, Info, Lock, Pencil, Shield, UserPlus } from 'lucide-react';
import {
    Badge, Button, Card, Checkbox,
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
    Tooltip, TooltipContent, TooltipTrigger,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import type { KbRole, KbSourceFlags } from '../../types';
import {
    FLAG_REQUIRES, KB_RIGHT_GROUPS, KB_ROLE_ROWS, kbRightCell, type KbRightColumn,
} from '../../utils/kbRoleRights';

const ROLE_ICON: Record<KbRole, typeof Eye> = { owner: Crown, admin: Shield, edit: Pencil, view: Eye };
const ROLE_LABEL_KEY: Record<KbRole, string> = {
    owner: 'kbRoleOwner', admin: 'kbRoleAdmin', edit: 'kbRoleEdit', view: 'kbRoleView',
};
const ROLE_HINT_KEY: Record<KbRole, string> = {
    owner: 'rrRoleOwnerHint', admin: 'rrRoleAdminHint', edit: 'rrRoleEditHint', view: 'rrRoleViewHint',
};
const ROLE_INFO_KEY: Record<KbRole, string> = {
    owner: 'rrRoleOwnerInfo', admin: 'rrRoleAdminInfo', edit: 'rrRoleEditInfo', view: 'rrRoleViewInfo',
};
const COLUMN_LABEL_KEY: Record<KbRightColumn, string> = {
    invite: 'rrColInvite', rights: 'rrColRights',
    seeSources: 'rrColSeeSources', selectSources: 'rrColSelectSources',
    downloadSources: 'rrColDownloadSources', editSources: 'rrColEditSources', seeCitations: 'rrColSeeCitations',
};
const COLUMN_HINT_KEY: Record<KbRightColumn, string> = {
    invite: 'rrColInviteHint', rights: 'rrColRightsHint',
    seeSources: 'rrColSeeSourcesHint', selectSources: 'rrColSelectSourcesHint',
    downloadSources: 'rrColDownloadSourcesHint', editSources: 'rrColEditSourcesHint', seeCitations: 'rrColSeeCitationsHint',
};
const GROUP_LABEL_KEY = { topic: 'rrGroupTopic', sidebar: 'rrGroupSidebar', answers: 'rrGroupAnswers' } as const;

/** First column of each group after the first carries the group divider. */
const GROUP_START = new Set(KB_RIGHT_GROUPS.slice(1).map(g => g.columns[0]));
const divider = (col: KbRightColumn) => (GROUP_START.has(col) ? 'border-l border-outline-variant' : '');

/** An info icon with a tooltip — a real button, so the tooltip also opens on keyboard focus. */
function InfoTip({ label, text }: { label: string; text: string }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" aria-label={label}>
                    <Info size={14} aria-hidden="true" />
                </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{text}</TooltipContent>
        </Tooltip>
    );
}

/**
 * A cell fixed by the role: not a control, so not a (disabled) checkbox — a
 * grey tile with or without a check, named for assistive technology.
 */
function FixedMark({ granted, label }: { granted: boolean; label: string }) {
    return (
        <span
            role="img"
            aria-label={label}
            className="inline-flex size-5 items-center justify-center rounded-sm bg-surface-container-high text-on-surface"
        >
            {granted && <Check size={14} strokeWidth={2.5} aria-hidden="true" />}
        </span>
    );
}

interface KbRolesRightsTabProps {
    /** The editable flags as currently drafted (saved by the panel footer). */
    flags: KbSourceFlags;
    onFlagsChange: (next: KbSourceFlags) => void;
    /** Opens the members dialog ("Personen zuweisen"). */
    onAssignPeople: (e: React.MouseEvent) => void;
}

/**
 * "Rollen & Rechte" tab of Thema-Einstellungen: one row per KB role, one
 * column per right, grouped into Thema / Quellen in Sidebar / Antworten.
 * Fixed cells (grey) show what the role ladder enforces; cells bound to a
 * source flag are live checkboxes. The model lives in utils/kbRoleRights.ts.
 */
export function KbRolesRightsTab({ flags, onFlagsChange, onAssignPeople }: KbRolesRightsTabProps) {
    const { t } = useTheme();

    return (
        <section aria-labelledby="kb-roles-rights-title" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                    <h3 id="kb-roles-rights-title" className="m-0 text-lg font-semibold text-on-surface">{t('rrTitle')}</h3>
                    <p className="m-0 text-sm text-on-surface-variant">{t('rrSubtitle')}</p>
                </div>
                <Button variant="outline" onClick={onAssignPeople}>
                    <UserPlus size={16} aria-hidden="true" />
                    {t('rrAssignPeople')}
                </Button>
            </div>

            <Card className="p-0 overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead scope="col" rowSpan={2} className="align-bottom">
                                <span className="flex items-center gap-1">
                                    {t('rrColRole')}
                                    <InfoTip label={t('rrRoleColumnInfoLabel')} text={t('rrRoleColumnInfo')} />
                                </span>
                            </TableHead>
                            {KB_RIGHT_GROUPS.map(g => (
                                <TableHead
                                    key={g.id}
                                    scope="colgroup"
                                    colSpan={g.columns.length}
                                    className={`text-center font-semibold text-on-surface ${divider(g.columns[0])}`}
                                >
                                    <span className="mx-2 block border-b border-primary pb-1">{t(GROUP_LABEL_KEY[g.id])}</span>
                                </TableHead>
                            ))}
                        </TableRow>
                        <TableRow>
                            {KB_RIGHT_GROUPS.flatMap(g => g.columns).map(col => (
                                <TableHead
                                    key={col}
                                    scope="col"
                                    className={`text-center ${divider(col)}`}
                                    title={t(COLUMN_HINT_KEY[col])}
                                >
                                    {t(COLUMN_LABEL_KEY[col])}
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {KB_ROLE_ROWS.map(role => {
                            const Icon = ROLE_ICON[role];
                            const roleLabel = t(ROLE_LABEL_KEY[role]);
                            return (
                                <TableRow key={role}>
                                    <TableHead scope="row" className="font-normal">
                                        <div className="flex items-start gap-3 py-1">
                                            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-fixed text-on-primary-fixed" aria-hidden="true">
                                                <Icon size={16} />
                                            </span>
                                            <span className="flex flex-col">
                                                <span className="flex flex-wrap items-center gap-x-1 font-semibold text-on-surface">
                                                    {roleLabel}
                                                    <InfoTip label={`${roleLabel}: ${t('rrRoleInfoLabel')}`} text={t(ROLE_INFO_KEY[role])} />
                                                    {role === 'owner' && (
                                                        <Badge tone="neutral">
                                                            <Lock size={12} aria-hidden="true" />
                                                            {t('rrFixed')}
                                                        </Badge>
                                                    )}
                                                </span>
                                                <span className="text-xs text-on-surface-variant">{t(ROLE_HINT_KEY[role])}</span>
                                            </span>
                                        </div>
                                    </TableHead>
                                    {KB_RIGHT_GROUPS.flatMap(g => g.columns).map(col => {
                                        const cell = kbRightCell(role, col);
                                        const colLabel = t(COLUMN_LABEL_KEY[col]);
                                        if (cell.kind === 'fixed') {
                                            const state = t(cell.granted ? 'rrGranted' : 'rrDenied');
                                            const scope = cell.scope ? t(cell.scope) : '';
                                            return (
                                                <TableCell key={col} className={`text-center ${divider(col)}`}>
                                                    <span className="inline-flex flex-col items-center gap-1">
                                                        <FixedMark
                                                            granted={cell.granted}
                                                            label={`${roleLabel}: ${colLabel} — ${state}${scope ? `, ${scope}` : ''} (${t('rrFixedCell')})`}
                                                        />
                                                        {scope && <span className="text-xs text-on-surface-variant" aria-hidden="true">{scope}</span>}
                                                    </span>
                                                </TableCell>
                                            );
                                        }
                                        const requires = FLAG_REQUIRES[cell.flag];
                                        const blocked = requires != null && !flags[requires];
                                        return (
                                            <TableCell key={col} className={`text-center ${divider(col)}`}>
                                                <Checkbox
                                                    checked={flags[cell.flag] && !blocked}
                                                    disabled={blocked}
                                                    aria-label={`${roleLabel}: ${colLabel}`}
                                                    title={blocked ? t('rrRequiresSee') : undefined}
                                                    onCheckedChange={(v) => onFlagsChange({ ...flags, [cell.flag]: v === true })}
                                                />
                                            </TableCell>
                                        );
                                    })}
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </Card>
        </section>
    );
}
