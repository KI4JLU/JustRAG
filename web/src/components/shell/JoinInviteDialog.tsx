import { useId, useState, type ReactNode } from 'react';
import { Check, CircleAlert, Eye, Link2Off, Loader2, Mail, Pencil, ShieldCheck, Star } from 'lucide-react';
import {
    Badge, Button, Dialog, DialogContent, DialogEyebrow, DialogFooter, DialogTitle, IconTile,
    Item, ItemContent, ItemDescription, ItemMedia, ItemTitle,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import type { InvitePreview } from '../../hooks/useJoinInvite';
import { StartGlow, TitleCard, TitleCardFrame } from '../kbSettings/assistant/StartPageParts';

const ROLE_KEYS: Record<string, string> = {
    view: 'kbRoleView',
    edit: 'kbRoleEdit',
    admin: 'kbRoleAdmin',
    owner: 'kbRoleOwner',
};

/** What a role lets the joiner do, as the invitation explains it. */
const ACCESS_TEXT_KEYS: Record<string, string> = {
    view: 'joinInviteAccessView',
    edit: 'joinInviteAccessEdit',
    admin: 'joinInviteAccessAdmin',
};

function RoleGlyph({ role }: { role: string }) {
    if (role === 'admin') return <ShieldCheck />;
    if (role === 'edit') return <Pencil />;
    return <Eye />;
}

export interface JoinInviteDialogProps {
    invite: InvitePreview | null;
    busy: boolean;
    onAccept: () => void;
    onClose: () => void;
    onAddFavorite: () => void;
    onOpenKb: () => void;
}

/**
 * What an invite link means for the person who opened it, by `status`
 * (developer mockups „Einladung", „Bereits Mitglied", „Link zurückgezogen",
 * 23.11.2026): a status badge on the close button's line, the topic's title
 * block as its start page shows it (glow, category, documents, description,
 * role), one row saying what the link means, and two equal actions.
 *
 * - `invite`: the access the link grants; only „Beitreten" joins, „Ablehnen"
 *   (or closing) leaves everything as it was.
 * - `member`: the link changes nothing; offers to save the topic as a
 *   favorite, so they need no link to find it again, and opens it.
 * - `revoked`: the invitation ended. Without access only the name shows;
 *   with access (a published public topic) the topic still opens.
 */
export function JoinInviteDialog({ invite, busy, onAccept, onClose, onAddFavorite, onOpenKb }: JoinInviteDialogProps) {
    const { t } = useTheme();
    const descriptionId = useId();
    // The content stays while the dialog animates out.
    const [shown, setShown] = useState(invite);
    if (invite && invite !== shown) setShown(invite);

    const roleLabel = (role: string) => t(ROLE_KEYS[role] ?? 'kbRoleView');
    const spinner = busy && <Loader2 className="animate-spin" aria-hidden="true" />;
    const kb = shown?.kbName ?? '';
    // A revoked link shows a non-member nothing about the topic but its name.
    const details = !!shown && (shown.status !== 'revoked' || shown.role !== '');

    let eyebrow: ReactNode = null;
    let row: { tone: 'tint' | 'warning' | 'caution'; glyph: ReactNode; title: string; text: string } | null = null;
    let actions: ReactNode = null;

    if (shown?.status === 'invite') {
        eyebrow = <Badge tone="primary"><Mail className="size-3.5" aria-hidden="true" />{t('joinInviteEyebrowInvite')}</Badge>;
        const linkRole = shown.linkRole ?? 'view';
        row = {
            tone: 'tint',
            glyph: <RoleGlyph role={linkRole} />,
            title: t('joinInviteAccessTitle').replace('{role}', roleLabel(linkRole)),
            text: t(ACCESS_TEXT_KEYS[linkRole] ?? 'joinInviteAccessView'),
        };
        actions = (
            <>
                <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                    {t('joinInviteDecline')}
                </Button>
                <Button type="button" onClick={onAccept} disabled={busy}>
                    {spinner}
                    {t('joinInviteAccept')}
                </Button>
            </>
        );
    } else if (shown?.status === 'member') {
        // Saved means starred AND in the overview: a starred topic the user
        // removed from the overview is offered again.
        const saved = shown.isFavorite && shown.inOverview;
        // Implicit access to a private or staged topic: no subscription can
        // put it in the overview, so the dialog does not offer to save it.
        const savable = shown.inOverview || !!shown.canSubscribe;
        eyebrow = <Badge tone="success"><Check className="size-3.5" aria-hidden="true" />{t('joinInviteEyebrowMember')}</Badge>;
        row = {
            tone: 'warning',
            glyph: <Star />,
            title: t('joinInviteMemberTitle').replace('{role}', roleLabel(shown.role)),
            text: savable
                ? `${t('joinInviteMemberText')} ${t(saved ? 'joinInviteMemberIsFavorite' : 'joinInviteMemberFavoriteHint')}`
                : t('joinInviteMemberText'),
        };
        actions = (
            <>
                {savable && !saved && (
                    <Button type="button" variant="outline" onClick={onAddFavorite} disabled={busy}>
                        {busy ? spinner : <Star aria-hidden="true" />}
                        {t('joinInviteAddFavorite')}
                    </Button>
                )}
                <Button type="button" onClick={onOpenKb} disabled={busy}>
                    {t('joinInviteOpen')}
                </Button>
            </>
        );
    } else if (shown?.status === 'revoked') {
        eyebrow = <Badge tone="caution"><Link2Off className="size-3.5" aria-hidden="true" />{t('joinInviteEyebrowRevoked')}</Badge>;
        row = {
            tone: 'caution',
            glyph: <CircleAlert />,
            title: t('joinInviteRevokedTitle'),
            text: t('joinInviteRevokedText'),
        };
        actions = shown.role ? (
            <>
                <Button type="button" variant="outline" onClick={onClose}>{t('close')}</Button>
                <Button type="button" onClick={onOpenKb}>{t('joinInviteOpen')}</Button>
            </>
        ) : (
            <Button type="button" onClick={onClose}>{t('close')}</Button>
        );
    }

    return (
        <Dialog open={invite !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
            <DialogContent closeLabel={t('close')} aria-describedby={row ? descriptionId : undefined} className="max-w-xl">
                {shown && details && <StartGlow category={shown.category} />}
                <DialogEyebrow>{eyebrow}</DialogEyebrow>
                <DialogTitle className="sr-only">{t('joinInviteTitle').replace('{kb}', kb)}</DialogTitle>
                {shown && details ? (
                    <TitleCard
                        title={kb}
                        category={shown.category ?? null}
                        role={shown.roleName || undefined}
                        description={shown.description ?? ''}
                        fileCount={shown.fileCount}
                        asOf={shown.lastIngestedAt ?? undefined}
                    />
                ) : (
                    <TitleCardFrame>
                        <h2 className="m-0 text-center text-2xl font-semibold leading-tight text-balance break-words text-on-surface sm:text-3xl">{kb}</h2>
                        <p className="m-0 mt-2 text-center text-sm text-outline">{t('joinInviteRevokedNoDetails')}</p>
                    </TitleCardFrame>
                )}
                {row && (
                    <Item variant="muted" className="mt-2">
                        <ItemMedia>
                            <IconTile tone={row.tone} size="lg">{row.glyph}</IconTile>
                        </ItemMedia>
                        <ItemContent>
                            <ItemTitle>{row.title}</ItemTitle>
                            <ItemDescription id={descriptionId} className="line-clamp-none">{row.text}</ItemDescription>
                        </ItemContent>
                    </Item>
                )}
                <DialogFooter layout="fill" className="mt-2">{actions}</DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
