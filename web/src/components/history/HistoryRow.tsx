import { memo } from 'react';
import { ArrowDown, ArrowUp, FolderInput, FolderMinus, GitBranch, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { HoverPreview, SidebarCard, SidebarCardPreview, SortableItem } from '@ki4jlu/design-system';
import type { ChatListEntry, ChatSection } from '../../types';
import type { TopicSection } from '../../utils/topicSection';
import { useTheme } from '../../contexts/ThemeContext';
import type { HistoryItem } from './historyItems';
import { KIND_ICON, OVERVIEW_ICON, OVERVIEW_LABEL } from './historyIcons';
import { splitLeadingEmoji } from './leadingEmoji';

export interface HistoryRowProps {
    item: HistoryItem;
    /** The overview the chat's topic is listed in. */
    overview: TopicSection;
    /** Where the chat is kept: the built-in „Angepinnt", a section of the user's own, or not at all. */
    kept: 'pinned' | 'section' | null;
    /** The fold key of the section it stands in (kept chats only). */
    sectionKey: string | null;
    /** The id of the user's section it is filed in; null for „Angepinnt" and for a chat that is not kept. */
    sectionId: string | null;
    /** Its place in its section and how many chats that section holds (kept chats only). */
    place: number;
    count: number;
    /** The user's own sections, to file the chat in. */
    sections: ChatSection[];
    active: boolean;
    /** Chats are being ticked for deletion. */
    selecting: boolean;
    selected: boolean;
    /** The copy carried while dragging: the row alone, not sorted, no preview. */
    carried?: boolean;
    onOpen: (item: HistoryItem) => void;
    onPin: (id: string, pinned: boolean, sectionId?: string | null) => void;
    onMove: (sectionKey: string, id: string, by: -1 | 1) => void;
    onRename: (item: HistoryItem) => void;
    onStartDelete: (id: string) => void;
    onSelectedChange: (id: string, on: boolean) => void;
}

/* The history list is rebuilt whenever a chat changes, so every row gets a
   new `item` object: the row renders again only when what it shows of the
   chat did, or one of its other props. */
function sameRow(a: HistoryRowProps, b: HistoryRowProps): boolean {
    const [x, y] = [a.item, b.item];
    const [sx, sy] = [x.source as ChatListEntry, y.source as ChatListEntry];
    if (
        x.id !== y.id || x.title !== y.title || x.updatedAt !== y.updatedAt || x.branched !== y.branched || x.kind !== y.kind
        || sx.kbId !== sy.kbId || sx.kbName !== sy.kbName
    ) return false;
    return (Object.keys(a) as (keyof HistoryRowProps)[]).every(key => key === 'item' || a[key] === b[key]);
}

/**
 * One chat as a row of the sidebar history, in a kept section and in the
 * plain history alike. Memoised: a fold, a filter or another chat's change
 * leaves it alone.
 */
export const HistoryRow = memo(function HistoryRow({
    item, overview, kept, sectionKey, sectionId, place, count, sections, active, selecting, selected, carried = false,
    onOpen, onPin, onMove, onRename, onStartDelete, onSelectedChange,
}: HistoryRowProps) {
    const { t, language } = useTheme();
    const Icon = item.branched ? GitBranch : KIND_ICON[item.kind];
    // A leading emoji in the title becomes the card's icon.
    const { emoji, text } = splitLeadingEmoji(item.title);
    const OverviewIcon = OVERVIEW_ICON[overview];
    // Where the chat can go: „Angepinnt" and every section of the user's,
    // the one it is in ticked. Offered once there is a section to choose.
    const moveTo = sections.length === 0 ? [] : [{
        label: t('sectionMoveTo'),
        icon: <FolderInput size={16} aria-hidden="true" />,
        submenu: [
            { label: t('pinnedChats'), checked: kept === 'pinned', onSelect: () => onPin(item.id, true, null) },
            ...sections.map(target => ({
                label: target.name,
                checked: kept === 'section' && sectionId === target.id,
                onSelect: () => onPin(item.id, true, target.id),
            })),
        ],
    }];
    const row = (
        <SidebarCard
            className="history-row"
            icon={emoji ?? <Icon />}
            title={text}
            titleTestId="history-item-title"
            onOpen={() => onOpen(item)}
            // Trailing, at rest: which overview the chat's topic is in. The ⋯
            // menu stands over it while the row is hovered.
            indicator={<OverviewIcon size={16} aria-hidden="true" />}
            active={active}
            actionsLabel={t('chatActions')}
            actions={[
                // „Pinned" is the built-in section only: a chat filed in one of
                // the user's own can still be pinned, and is taken out of its
                // section rather than unpinned.
                kept === 'pinned'
                    ? { label: t('unpinChat'), icon: <PinOff size={16} aria-hidden="true" />, onSelect: () => onPin(item.id, false) }
                    : { label: t('pinChat'), icon: <Pin size={16} aria-hidden="true" />, onSelect: () => onPin(item.id, true, null) },
                ...(kept === 'section' ? [{ label: t('sectionRemoveFrom'), icon: <FolderMinus size={16} aria-hidden="true" />, onSelect: () => onPin(item.id, false) }] : []),
                ...moveTo,
                // A kept chat is also sorted from here: dragging has no keyboard form.
                ...(kept && sectionKey && count > 1 ? [
                    { label: t('movePinUp'), icon: <ArrowUp size={16} aria-hidden="true" />, disabled: place === 0, onSelect: () => onMove(sectionKey, item.id, -1) },
                    { label: t('movePinDown'), icon: <ArrowDown size={16} aria-hidden="true" />, disabled: place === count - 1, onSelect: () => onMove(sectionKey, item.id, 1) },
                ] : []),
                { label: t('renameChat'), icon: <Pencil size={16} aria-hidden="true" />, onSelect: () => onRename(item) },
                { label: t('deleteItem'), icon: <Trash2 size={16} aria-hidden="true" />, destructive: true, separatorBefore: true, onSelect: () => onStartDelete(item.id) },
            ]}
            selectable={selecting}
            selectionMode={selecting}
            selectionTone="destructive"
            selected={selected}
            onSelectedChange={on => onSelectedChange(item.id, on)}
            selectLabel={t('selectChat')}
        />
    );
    if (carried) return row;
    /* What the hover preview says — the pattern of the source previews (rest,
       then open; one card that moves along the list): the full title, which
       the row truncates, where the chat lives and when it was last used. */
    const preview = (
        <SidebarCardPreview
            data-testid="history-preview"
            title={item.title}
            lines={[
                { icon: <OverviewIcon aria-hidden="true" />, text: `${t(OVERVIEW_LABEL[overview])} · ${(item.source as ChatListEntry).kbName}` },
                { text: `${t('historyFilterActivity')}: ${new Date(item.updatedAt).toLocaleDateString(language, { year: 'numeric', month: 'long', day: 'numeric' })}` },
            ]}
        />
    );
    return (
        // Not while chats are being ticked for deletion.
        <HoverPreview content={preview} disabled={selecting}>
            <SortableItem value={item.id} asChild>{row}</SortableItem>
        </HoverPreview>
    );
}, sameRow);
