import type React from 'react';
import { Crown, Eye, Lock, Pencil, Shield, UserPlus } from 'lucide-react';
import {
    Badge, Button, Card, Checkbox,
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import type { KbRole, KbSourceFlags } from '../../types';
import {
    FLAG_REQUIRES, KB_RIGHT_COLUMNS, KB_RIGHT_GROUPS, KB_ROLE_ROWS, kbRightCell, type KbRightColumn,
} from '../../utils/kbRoleRights';

const ROLE_ICON: Record<KbRole, typeof Eye> = { owner: Crown, admin: Shield, edit: Pencil, view: Eye };
const ROLE_LABEL_KEY: Record<KbRole, string> = {
    owner: 'kbRoleOwner', admin: 'kbRoleAdmin', edit: 'kbRoleEdit', view: 'kbRoleView',
};
const ROLE_HINT_KEY: Record<KbRole, string> = {
    owner: 'rrRoleOwnerHint', admin: 'rrRoleAdminHint', edit: 'rrRoleEditHint', view: 'rrRoleViewHint',
};
const COLUMN_LABEL_KEY: Record<KbRightColumn, string> = {
    read: 'rrColRead', edit: 'rrColEdit', members: 'rrColMembers', rights: 'rrColRights',
    seeSources: 'rrColSeeSources', selectSources: 'rrColSelectSources',
    downloadSources: 'rrColDownloadSources', seeCitations: 'rrColSeeCitations',
};
/** Short header labels under their group ("Quellen" → "Sehen"); the full name stays the accessible one. */
const COLUMN_SHORT_KEY: Record<KbRightColumn, string> = {
    read: 'rrShortRead', edit: 'rrShortEdit', members: 'rrShortMembers', rights: 'rrShortRights',
    seeSources: 'rrShortSee', selectSources: 'rrShortSelect',
    downloadSources: 'rrShortDownload', seeCitations: 'rrShortCitations',
};
const GROUP_LABEL_KEY = { topic: 'rrGroupTopic', sources: 'rrGroupSources' } as const;
const COLUMN_HINT_KEY: Record<KbRightColumn, string> = {
    read: 'rrColReadHint', edit: 'rrColEditHint', members: 'rrColMembersHint', rights: 'rrColRightsHint',
    seeSources: 'rrColSeeSourcesHint', selectSources: 'rrColSelectSourcesHint',
    downloadSources: 'rrColDownloadSourcesHint', seeCitations: 'rrColSeeCitationsHint',
};

interface KbRolesRightsTabProps {
    /** The editable flags as currently drafted (saved by the panel footer). */
    flags: KbSourceFlags;
    onFlagsChange: (next: KbSourceFlags) => void;
    /** Opens the members dialog ("Personen zuweisen"). */
    onAssignPeople: (e: React.MouseEvent) => void;
}

/**
 * "Rollen & Rechte" tab of Thema-Einstellungen: one row per KB role, one
 * column per right. Fixed cells are disabled checkboxes showing what the role
 * ladder enforces; cells bound to a source flag are live checkboxes. The
 * model (which cell is which, and why) lives in utils/kbRoleRights.ts.
 */
export function KbRolesRightsTab({ flags, onFlagsChange, onAssignPeople }: KbRolesRightsTabProps) {
    const { t } = useTheme();
    const seeOff = !flags.viewerSeeSources;

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
                            <TableHead scope="col" rowSpan={2} className="align-bottom">{t('rrColRole')}</TableHead>
                            {KB_RIGHT_GROUPS.map(g => (
                                <TableHead key={g.id} scope="colgroup" colSpan={g.columns.length} className="text-center">
                                    {t(GROUP_LABEL_KEY[g.id])}
                                </TableHead>
                            ))}
                        </TableRow>
                        <TableRow>
                            {KB_RIGHT_COLUMNS.map(col => (
                                <TableHead key={col} scope="col" className="whitespace-nowrap text-center text-xs" title={`${t(COLUMN_LABEL_KEY[col])}: ${t(COLUMN_HINT_KEY[col])}`}>
                                    <span aria-hidden="true">{t(COLUMN_SHORT_KEY[col])}</span>
                                    <span className="sr-only">{t(COLUMN_LABEL_KEY[col])}</span>
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
                                    <TableHead scope="row" className="min-w-32 font-normal">
                                        <div className="flex items-start gap-2 py-1">
                                            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-fixed text-on-primary-fixed" aria-hidden="true">
                                                <Icon size={16} />
                                            </span>
                                            <span className="flex flex-col gap-0.5">
                                                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-on-surface">
                                                    {roleLabel}
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
                                    {KB_RIGHT_COLUMNS.map(col => {
                                        const cell = kbRightCell(role, col);
                                        const label = `${roleLabel}: ${t(COLUMN_LABEL_KEY[col])}`;
                                        if (cell.kind === 'fixed') {
                                            return (
                                                <TableCell key={col} className="text-center">
                                                    <Checkbox checked={cell.granted} disabled aria-label={label} title={t('rrFixedCell')} />
                                                </TableCell>
                                            );
                                        }
                                        const requires = FLAG_REQUIRES[cell.flag];
                                        const blocked = requires != null && !flags[requires];
                                        return (
                                            <TableCell key={col} className="text-center">
                                                <Checkbox
                                                    checked={flags[cell.flag] && !blocked}
                                                    disabled={blocked}
                                                    aria-label={label}
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

            <p className="m-0 text-xs text-on-surface-variant">
                {t('rrFootnote')}
                {seeOff && <> {t('rrRequiresSee')}</>}
            </p>
        </section>
    );
}
