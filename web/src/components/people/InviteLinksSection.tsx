import { useId, useState } from 'react';
import { Copy, Link2, Loader2, Plus, Trash2 } from 'lucide-react';
import { ActionMenu, Badge, Button, Input, Label } from '@ki4jlu/design-system';
import { SharingRoleSelect } from './SharingRoleSelect';
import type { SharedInviteLink, SharingRole } from './sharing';

interface InviteLinksSectionProps {
    links: readonly SharedInviteLink[];
    roles: readonly SharingRole[];
    /** Creates a link with the chosen role and label; resolves true when it was made (the form is then cleared). */
    onCreate: (role: string, label: string) => Promise<boolean>;
    onCopy: (link: SharedInviteLink) => void;
    onRevoke: (link: SharedInviteLink) => void;
    language: string;
    t: (k: string) => string;
}

/**
 * The "Einladungslinks" tab of adding people: a form for a new link (a label and the role it
 * grants) and the active links with their use count, copy button and revoke action.
 */
export function InviteLinksSection({ links, roles, onCreate, onCopy, onRevoke, language, t }: InviteLinksSectionProps) {
    const [label, setLabel] = useState('');
    const [role, setRole] = useState(roles[0]?.value ?? '');
    const [creating, setCreating] = useState(false);
    const titleId = useId();
    const roleId = useId();
    const headingId = useId();
    const roleOf = (value: string) => roles.find(r => r.value === value) ?? roles[0];

    const lastUsed = (dateStr: string) =>
        new Date(dateStr).toLocaleDateString(language === 'de' ? 'de-DE' : 'en-US', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        });

    const create = async () => {
        if (!label.trim()) return;
        setCreating(true);
        try {
            if (await onCreate(role, label.trim())) setLabel('');
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="flex flex-col gap-stack-md">
            <form
                className="flex flex-col gap-stack-sm"
                onSubmit={(e) => { e.preventDefault(); void create(); }}
            >
                <h3 className="m-0 text-base font-semibold text-on-surface">{t('newInviteLink')}</h3>
                <div className="flex items-end gap-stack-sm">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <Label htmlFor={titleId}>{t('inviteLinkTitle')} <span aria-hidden="true" className="text-error">*</span></Label>
                        <Input
                            id={titleId}
                            value={label}
                            onChange={e => setLabel(e.target.value)}
                            maxLength={100}
                            required
                            placeholder={t('inviteLinkLabelPlaceholder')}
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label htmlFor={roleId}>{t('roleLabel')} <span aria-hidden="true" className="text-error">*</span></Label>
                        <SharingRoleSelect roles={roles} id={roleId} value={role} onChange={setRole} label={t('roleLabel')} t={t} />
                    </div>
                    <Button type="submit" size="field" disabled={creating || !label.trim()}>
                        {creating
                            ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            : <Plus className="size-4" aria-hidden="true" />}
                        {t('create')}
                    </Button>
                </div>
                <p className="m-0 text-sm text-on-surface-variant">{t('inviteLinkRoleHint')}</p>
            </form>

            <section aria-labelledby={headingId} className="flex flex-col gap-stack-sm">
                <div className="flex items-center gap-2">
                    <h3 id={headingId} className="m-0 text-base font-semibold text-on-surface">{t('activeInviteLinks')}</h3>
                    <Badge>{links.length}</Badge>
                </div>
                {links.length === 0 ? (
                    <p className="m-0 text-sm text-on-surface-variant">{t('noInviteLinks')}</p>
                ) : (
                    <ul className="m-0 flex max-h-72 list-none flex-col divide-y divide-outline-variant overflow-y-auto rounded-xl border border-outline-variant p-0">
                        {links.map(link => {
                            const def = roleOf(link.role);
                            const Icon = def.icon;
                            const title = link.label || t('inviteLinkUnnamed');
                            return (
                                <li key={link.id} className="flex items-center gap-3 px-4 py-3">
                                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant">
                                        <Link2 className="size-4" aria-hidden="true" />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <span className="truncate font-medium text-on-surface">{title}</span>
                                            <Badge tone={def.tone}>
                                                <Icon className="size-3" aria-hidden="true" />
                                                {t(def.labelKey)}
                                            </Badge>
                                        </div>
                                        <div
                                            className="text-sm text-on-surface-variant"
                                            title={link.lastUsedAt ? `${t('inviteLinkLastUsed')}: ${lastUsed(link.lastUsedAt)}` : undefined}
                                        >
                                            {link.redemptionCount === 0
                                                ? t('inviteLinkNeverUsed')
                                                : link.redemptionCount === 1
                                                    ? t('inviteLinkUsedOnce')
                                                    // The count is people, not visits.
                                                    : t('inviteLinkUsedTimes').replace('{count}', String(link.redemptionCount))}
                                        </div>
                                    </div>
                                    <Button variant="outline" size="sm" onClick={() => onCopy(link)} aria-label={`${t('copy')}: ${title}`}>
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
                                            onSelect: () => onRevoke(link),
                                        }]}
                                    />
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>
        </div>
    );
}
