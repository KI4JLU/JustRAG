import { useCallback, useEffect, useRef, useState } from 'react';
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
 * keeps its 2px primary border; its badges („Aktiv", „Rollenauswahl",
 * „Eigene") sit in the body. The ⋯ menu sits in the card's
 * action slot; on hover (or keyboard focus inside) it becomes a split button with
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
    // Hovered, holding the keyboard focus, or its menu open. A click focuses
    // the card or returns the focus to ⋯ too; that focus must not pin the
    // split, or it stays on every card clicked. The split button's halves
    // stay one tree, so an open menu is not remounted when this changes.
    const ref = useRef<HTMLDivElement>(null);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const hot = hovered || focused;
    const syncFocus = useCallback(() => {
        const el = ref.current;
        const at = document.activeElement;
        if (!el || !at) { setFocused(false); return; }
        setFocused(el.contains(at)
            ? isKeyboardFocus(at)
            : !!at.closest('[role="menu"]') && !!el.querySelector('[aria-expanded="true"]'));
    }, []);
    // Read the focus where it lands instead of trusting the blur: the menu
    // unmounts with the focus in it, and React then reports no blur for it
    // (nor does every browser fire one, hence the pointerdown too).
    useEffect(() => {
        if (!focused) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onMove = () => { clearTimeout(timer); timer = setTimeout(syncFocus); };
        const events = ['focusin', 'focusout', 'pointerdown'] as const;
        events.forEach(type => document.addEventListener(type, onMove, true));
        return () => {
            clearTimeout(timer);
            events.forEach(type => document.removeEventListener(type, onMove, true));
        };
    }, [focused, syncFocus]);
    const label = `${role.name}${active ? ` (${t('asstActive')})` : ''} – ${t('asstShowPreview')}`;
    const kind = start?.kind ?? 'input';
    const badges = active || onStartPage || role.custom;
    return (
        <div
            ref={ref}
            className="w-fit"
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={syncFocus}
        >
            <SelectableCard
                value={role.id}
                aria-label={label}
                accentColor={roleAccent(roleCardCover(role, kind))}
                className={cn(
                    ROLE_CARD_SIZE,
                    'select-none',
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
                            {onStartPage && <Badge tone="secondary">{t('asstStartSetUpBadge')}</Badge>}
                            {role.custom && <Badge tone="neutral">{t('asstOwn')}</Badge>}
                        </span>
                    )}
                </RoleCardBody>
            </SelectableCard>
        </div>
    );
}

/** The element holds the focus visibly: reached by keyboard, not by a click. */
function isKeyboardFocus(el: Element): boolean {
    try {
        return el.matches(':focus-visible');
    } catch {
        return true; // no :focus-visible support: treat every focus as visible
    }
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
