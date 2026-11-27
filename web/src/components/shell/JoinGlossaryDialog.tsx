import { useState, type ReactNode } from 'react';
import { BookOpen, Check, CircleAlert, Eye, Link2Off, Loader2, Mail, Pencil, ShieldCheck } from 'lucide-react';
import {
    Badge, Button, Dialog, DialogContent, DialogDescription, DialogEyebrow, DialogFooter, DialogTitle, IconTile,
    Item, ItemContent, ItemDescription, ItemMedia, ItemTitle,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import type { GlossaryInvitePreview } from '../translator/types';
import { GLOSSARY_ROLE_LABEL_KEY } from '../translator/glossarySharingConfig';

/** What a role lets the joiner do, as the invitation explains it. */
const ACCESS_TEXT_KEYS: Record<string, string> = {
    viewer: 'joinGlossaryAccessViewer',
    editor: 'joinGlossaryAccessEditor',
    admin: 'joinGlossaryAccessAdmin',
};

function RoleGlyph({ role }: { role: string }) {
    if (role === 'admin') return <ShieldCheck />;
    if (role === 'editor') return <Pencil />;
    return <Eye />;
}

export interface JoinGlossaryDialogProps {
    invite: GlossaryInvitePreview | null;
    busy: boolean;
    onAccept: () => void;
    onClose: () => void;
    onOpen: () => void;
}

/**
 * What a glossary invite link means for the person who opened it, by `status` (the knowledge-base
 * link's dialog is the model): a status badge, the glossary's name and description, one row
 * saying what the link means, and the actions.
 *
 * - `invite`: the role the link grants; only „Beitreten" joins, „Ablehnen" (or closing) leaves
 *   everything as it was.
 * - `member`: the link changes nothing (a link never changes a membership); opens the translator.
 * - `revoked`: the invitation ended; someone who already has access can still open the translator.
 */
export function JoinGlossaryDialog({ invite, busy, onAccept, onClose, onOpen }: JoinGlossaryDialogProps) {
    const { t } = useTheme();
    // The content stays while the dialog animates out.
    const [shown, setShown] = useState(invite);
    if (invite && invite !== shown) setShown(invite);

    const spinner = busy && <Loader2 className="animate-spin" aria-hidden="true" />;
    const name = shown?.glossaryName ?? '';
    const roleLabel = (role: string) => t(GLOSSARY_ROLE_LABEL_KEY[role as keyof typeof GLOSSARY_ROLE_LABEL_KEY] ?? 'kbRoleView');
    // A revoked link shows a non-member nothing about the glossary but its name.
    const details = !!shown && (shown.status !== 'revoked' || shown.role !== '');

    let eyebrow: ReactNode = null;
    let row: { tone: 'tint' | 'warning' | 'caution'; glyph: ReactNode; title: string; text: string } | null = null;
    let actions: ReactNode = null;

    if (shown?.status === 'invite') {
        eyebrow = <Badge tone="primary"><Mail className="size-3.5" aria-hidden="true" />{t('joinInviteEyebrowInvite')}</Badge>;
        const linkRole = shown.linkRole ?? 'viewer';
        row = {
            tone: 'tint',
            glyph: <RoleGlyph role={linkRole} />,
            title: t('joinGlossaryAccessTitle').replace('{role}', roleLabel(linkRole)),
            text: t(ACCESS_TEXT_KEYS[linkRole] ?? 'joinGlossaryAccessViewer'),
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
        eyebrow = <Badge tone="success"><Check className="size-3.5" aria-hidden="true" />{t('joinInviteEyebrowMember')}</Badge>;
        row = {
            tone: 'warning',
            glyph: <BookOpen />,
            title: t('joinGlossaryMemberTitle').replace('{role}', roleLabel(shown.role)),
            text: t('joinGlossaryMemberText'),
        };
        actions = (
            <>
                <Button type="button" variant="outline" onClick={onClose}>{t('close')}</Button>
                <Button type="button" onClick={onOpen}>{t('joinGlossaryOpen')}</Button>
            </>
        );
    } else if (shown?.status === 'revoked') {
        eyebrow = <Badge tone="caution"><Link2Off className="size-3.5" aria-hidden="true" />{t('joinInviteEyebrowRevoked')}</Badge>;
        row = {
            tone: 'caution',
            glyph: <CircleAlert />,
            title: t('joinInviteRevokedTitle'),
            text: t('joinGlossaryRevokedText'),
        };
        actions = shown.role ? (
            <>
                <Button type="button" variant="outline" onClick={onClose}>{t('close')}</Button>
                <Button type="button" onClick={onOpen}>{t('joinGlossaryOpen')}</Button>
            </>
        ) : (
            <Button type="button" onClick={onClose}>{t('close')}</Button>
        );
    }

    return (
        <Dialog open={invite !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
            <DialogContent closeLabel={t('close')} className="max-w-xl">
                <DialogEyebrow>{eyebrow}</DialogEyebrow>
                <DialogTitle className="text-center text-2xl break-words">{name}</DialogTitle>
                <DialogDescription className="text-center">
                    {details && shown?.description ? shown.description : t(details ? 'joinGlossaryIntro' : 'joinGlossaryRevokedNoDetails')}
                </DialogDescription>
                {row && (
                    <Item variant="muted" className="mt-2">
                        <ItemMedia>
                            <IconTile tone={row.tone} size="lg">{row.glyph}</IconTile>
                        </ItemMedia>
                        <ItemContent>
                            <ItemTitle>{row.title}</ItemTitle>
                            <ItemDescription className="line-clamp-none">{row.text}</ItemDescription>
                        </ItemContent>
                    </Item>
                )}
                <DialogFooter layout="fill" className="mt-2">{actions}</DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
