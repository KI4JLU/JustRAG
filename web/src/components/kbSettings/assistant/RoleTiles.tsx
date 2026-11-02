import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { ActionMenu, Badge, Button, ButtonGroup, ButtonGroupSeparator, SelectableCard, cn, selectableCardClassName, type ActionMenuItem } from '@ki4jlu/design-system';
import { useTheme } from '../../../contexts/ThemeContext';
import type { EntryStart } from './api';
import type { RoleView } from './roleModel';
import { roleAccent, roleCardCover } from './startPageModel';
import { ROLE_CARD_SIZE, RoleCardBody } from './StartPageParts';

/**
 * A role in the role overview, as the start page's role card: band and avatar
 * show how its chat starts on the start page (none set = the input field). It
 * is one radio of the overview's SelectableCardGroup: a click only VIEWS the
 * role (the selected look; the preview panel below shows it); the active role
 * keeps its 2px primary border; its badges („Aktiv", „Standard", „Auf der
 * Startseite", „Eigene") sit in the body. The ⋯ menu sits in the card's
 * action slot; on hover (or focus inside) it becomes a split button with
 * „Verwenden" on its left (not on the active role). Both are siblings of the
 * pick target, never inside it.
 */
export function RoleTile({
    role, start, onStartPage, active, onUse, actions, actionsLabel,
}: {
    role: RoleView;
    /** How the role starts on the start page; undefined = the input field. */
    start?: EntryStart;
    /** The role has a card on the start page. */
    onStartPage?: boolean;
    active: boolean;
    /** Makes the role the active one; not offered on the active role. */
    onUse: () => void;
    /** The ⋯ menu's items and its accessible name. */
    actions: ActionMenuItem[];
    actionsLabel: string;
}) {
    const { t } = useTheme();
    // Hovered or holding the focus (a menu opened from it too: React focus
    // events bubble through its portal). The split button's halves stay one
    // tree, so the open menu is not remounted when this changes.
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const hot = hovered || focused;
    const label = `${role.name}${active ? ` (${t('asstActive')})` : ''} – ${t('asstShowPreview')}`;
    const kind = start?.kind ?? 'input';
    const badges = active || role.isDefault || onStartPage || role.custom;
    return (
        <div
            className="w-fit"
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
        >
            <SelectableCard
                value={role.id}
                aria-label={label}
                accentColor={roleAccent(roleCardCover(role, kind))}
                className={cn(
                    ROLE_CARD_SIZE,
                    'select-none',
                    role.isDefault && 'border-primary/50 bg-primary/5',
                    active && 'border-2 border-primary',
                )}
                action={(
                    <ButtonGroup>
                        {hot && !active && (
                            <>
                                <Button size="sm" aria-label={t('asstUseThisRole')} onClick={onUse}>
                                    <Check className="size-4" aria-hidden="true" /> {t('asstUse')}
                                </Button>
                                <ButtonGroupSeparator className="bg-on-primary/30" />
                            </>
                        )}
                        {/* At rest a ghost ⋯; hovered, the split's primary half (it shows on a dark band too). */}
                        <ActionMenu label={actionsLabel} actions={actions} variant={hot ? 'default' : 'ghost'} />
                    </ButtonGroup>
                )}
            >
                <RoleCardBody kind={kind} title={role.name} description={role.description}>
                    {badges && (
                        <span className="mt-auto flex flex-wrap gap-1 pt-1">
                            {active && <Badge tone="primary">{t('asstActive')}</Badge>}
                            {role.isDefault && <Badge tone="primary">{t('asstDefault')}</Badge>}
                            {onStartPage && <Badge tone="secondary">{t('asstStartSetUpBadge')}</Badge>}
                            {role.custom && <Badge tone="neutral">{t('asstOwn')}</Badge>}
                        </span>
                    )}
                </RoleCardBody>
            </SelectableCard>
        </div>
    );
}

/** A dashed card of the role cards' size that adds something: „Neue Rolle", „Rolle hinzufügen". */
export function AddCardTile({ label, hint, className, ...props }: { label: string; hint?: string } & React.ComponentProps<'button'>) {
    return (
        // eslint-disable-next-line design-system/no-raw-ui-elements -- a card-shaped add action in the SelectableCard frame; Button has no card layout
        <button
            type="button"
            // A menu trigger too (asChild): its props and ref pass through.
            {...props}
            className={cn(selectableCardClassName, ROLE_CARD_SIZE, 'items-center justify-center gap-3 border-dashed border-outline bg-transparent p-4 text-center shadow-none hover:bg-primary/5', className)}
        >
            <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-[var(--ui-radius-tile)] border border-dashed border-outline text-primary [&_svg]:size-[18px]">
                <Plus />
            </span>
            <span className="min-w-0">
                <span className="block font-medium leading-snug">{label}</span>
                {hint && <span className="mt-0.5 block text-sm text-on-surface-variant">{hint}</span>}
            </span>
        </button>
    );
}

/** The „Neue Rolle" card at the end of the grid. One click → generator view. */
export function NewRoleTile({ onClick }: { onClick: () => void }) {
    const { t } = useTheme();
    return <AddCardTile label={t('asstNewRole')} hint={t('asstNewRoleHint')} onClick={onClick} />;
}
