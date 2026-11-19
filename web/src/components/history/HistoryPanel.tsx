import { ShortcutHint } from '../ShortcutHint';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    GitBranch, Loader2, SquarePen, Trash2, Pencil, FolderPlus, ArrowUp, ArrowDown, ChevronsDownUp,
} from 'lucide-react';
import {
    Button, HoverPreview, HoverPreviewGroup, SidebarAction, SidebarCardGroup, SidebarCardList, SidebarCardPreview,
    SidebarRail, SidebarPanel, SidebarRailItem, SidebarSection, SidebarSelectionBar, Sortable, SortableGroup,
    SortableOverlay, useSidebarCollapsed, type SortableCommitMeta,
} from '@ki4jlu/design-system';
import type { ChatListEntry, ChatSection } from '../../types';
import { useTheme } from '../../contexts/ThemeContext';
import { useIsMobileContext } from '../../contexts/MobileContext';
import { useChatHistory } from '../../contexts/ChatHistoryContext';
import { ContentRowSkeleton } from '../Skeleton';
import { buildHistoryItems, type HistoryItem } from './historyItems';
import { filterHistory, groupHistory } from './historyFilters';
import { HistoryFilterMenu } from './HistoryFilterMenu';
import { useHistoryFilters } from '../../hooks/useHistoryFilters';
import { useFoldedSections } from '../../hooks/useFoldedSections';
import { splitLeadingEmoji } from './leadingEmoji';
import { KIND_ICON, OVERVIEW_ICON, OVERVIEW_LABEL } from './historyIcons';
import { HistoryRow } from './HistoryRow';
import '../sidebar-primitives.css';
import './HistoryPanel.css';

/** The fold keys of the two built-in sections; a section of the user's own folds under its id. */
const PINNED_KEY = 'pinned';
const RECENT_KEY = 'recent';

/** A section of kept chats above „Verlauf": the built-in „Angepinnt" or one of the user's own. */
interface KeptSection {
    /** Fold key and React key. */
    key: string;
    /** Null for „Angepinnt". */
    sectionId: string | null;
    label: string;
    /** The user's section; absent for „Angepinnt". */
    custom?: ChatSection;
    items: HistoryItem[];
}

/** The longest name a section takes (the server's limit). */
const SECTION_NAME_MAX = 60;
/** The plain history keeps its order by date: chats are carried out of and into it, not sorted in it. */
const LOCKED_GROUPS = [RECENT_KEY];

const pinnedAt = (item: HistoryItem) => (item.source as ChatListEntry).pinnedAt;
const isPinned = (item: HistoryItem) => !!pinnedAt(item);
const pinTime = (item: HistoryItem) => new Date(pinnedAt(item) ?? 0).getTime();
const pinPosition = (item: HistoryItem) => (item.source as ChatListEntry).pinPosition ?? null;
const sectionIdOf = (item: HistoryItem) => (item.source as ChatListEntry).sectionId ?? null;
/** A kept section's order: chats without a place first, newest first, then the user's order. */
function byPinOrder(a: HistoryItem, b: HistoryItem): number {
    const [pa, pb] = [pinPosition(a), pinPosition(b)];
    if (pa === null && pb === null) return pinTime(b) - pinTime(a);
    if (pa === null) return -1;
    if (pb === null) return 1;
    return pa - pb;
}

interface HistoryPanelProps {
    /** The app's primary navigation rows, shown above the chat list (and in the collapsed rail). */
    nav?: React.ReactNode;
}

const HistoryPanelComp: React.FC<HistoryPanelProps> = ({ nav }) => {
    const { t, language } = useTheme();
    const isMobile = useIsMobileContext();
    // TRUE, sobald `SidePanel` die Spalte als 60px-Schiene rendert. Nicht
    // `sidebar.isLeftSidebarOpen`: unterhalb `lg` zeigt die Shell die Spalte
    // bildschirmfüllend und IGNORIERT den Einklapp-Zustand — wer sich auf den
    // App-Zustand verließe, bekäme dort die Schiene über die volle Breite.
    const collapsed = useSidebarCollapsed();
    const {
        chats, activeChatId, openTopicId, sectionOf, openChat, deleteChats, renameChat, pinChat, reorderPinned, fileChat,
        sections, createSection, renameSection, reorderSections, deleteSection,
        generating, generatingMessage,
    } = useChatHistory();
    const primary = usePrimaryAction();
    const { filters, set: setFilter, reset: resetFilters } = useHistoryFilters();

    // Chats only: research and academic entries opened report views that are
    // not reachable (KbViewType = 'chat'), and loading one as a chat does
    // nothing. The data stays on the server.
    const allItems = useMemo(
        () => buildHistoryItems({ chats, generatedContent: [] }).filter(item => item.kind === 'chat'),
        [chats],
    );
    /* Kept chats stand above „Verlauf", each in its section: the built-in
       „Angepinnt" (shown while it holds a chat) and the user's own (always
       shown, so an empty one can be filled). Inside a section the order is the
       user's — dragged, or moved from a row's menu — and a chat added since
       comes first. They are kept at hand whatever the filter says, so the
       filter skips them. A chat whose section is not in the list (deleted in
       another tab) shows in „Angepinnt". */
    const keptSections = useMemo<KeptSection[]>(() => {
        const known = new Set(sections.map(section => section.id));
        const bySection = new Map<string | null, HistoryItem[]>();
        for (const item of allItems.filter(isPinned)) {
            const id = sectionIdOf(item);
            const key = id !== null && known.has(id) ? id : null;
            bySection.set(key, [...(bySection.get(key) ?? []), item]);
        }
        const itemsOf = (id: string | null) => (bySection.get(id) ?? []).sort(byPinOrder);
        const pinned = itemsOf(null);
        return [
            ...(pinned.length > 0 ? [{ key: PINNED_KEY, sectionId: null, label: t('pinnedChats'), items: pinned }] : []),
            ...sections.map(section => ({
                key: section.id, sectionId: section.id, label: section.name, custom: section, items: itemsOf(section.id),
            })),
        ];
    }, [allItems, sections, t]);
    const keptItems = useMemo(() => keptSections.flatMap(section => section.items), [keptSections]);
    const unpinnedItems = useMemo(() => allItems.filter(item => !isPinned(item)), [allItems]);
    // What the filter menu lets through, in its order.
    const items = useMemo(
        () => filterHistory(unpinnedItems, filters, { openTopicId, sectionOf }),
        [unpinnedItems, filters, openTopicId, sectionOf],
    );
    // Every section folds away; remembered like the other view preferences.
    const folds = useFoldedSections();
    // The section whose name is being edited in its heading.
    const [namingSection, setNamingSection] = useState<string | null>(null);
    /* A new section starts under the default name, open and with that name
       ready to be typed over. */
    const addSection = useCallback(async () => {
        const created = await createSection();
        if (!created) return;
        folds.setOpen(created.id, true);
        setNamingSection(created.id);
    }, [createSection, folds]);
    const historyOpen = folds.isOpen(RECENT_KEY);
    const foldKeys = [...keptSections.map(section => section.key), RECENT_KEY];

    // Group labels instead of a date on every row: days, topics, or none.
    const groups = useMemo(() => groupHistory(items, filters, t, language), [items, filters, t, language]);

    /* What a chat's hover preview says, on an expanded row and on a rail icon
       alike — the pattern of the source previews (rest, then open; one card
       that moves along the list): the full title, which the row truncates,
       where the chat lives and when it was last used. */
    const preview = (item: HistoryItem) => {
        const chat = item.source as ChatListEntry;
        const section = sectionOf(chat);
        const SectionIcon = OVERVIEW_ICON[section];
        return (
            <SidebarCardPreview
                data-testid="history-preview"
                title={item.title}
                lines={[
                    { icon: <SectionIcon aria-hidden="true" />, text: `${t(OVERVIEW_LABEL[section])} · ${chat.kbName}` },
                    { text: `${t('historyFilterActivity')}: ${new Date(item.updatedAt).toLocaleDateString(language, { year: 'numeric', month: 'long', day: 'numeric' })}` },
                ]}
            />
        );
    };

    /* The list as the sortable sees it: every section's chats in their order,
       then the plain history as it is shown. */
    const sortableValue = useMemo<Record<string, string[]>>(() => ({
        ...Object.fromEntries(keptSections.map(section => [section.key, section.items.map(item => item.id)])),
        [RECENT_KEY]: items.map(item => item.id),
    }), [keptSections, items]);

    /* A drop: a section moved among the sections; or a chat sorted in its
       section, filed in another (which opens to show it), or let go into the
       plain history. */
    const onCommit = (next: Record<string, string[]>, meta: SortableCommitMeta<string>) => {
        if (meta.kind === 'group') {
            const own = new Set(sections.map(section => section.id));
            reorderSections(Object.keys(next).filter(key => own.has(key)));
            return;
        }
        if (meta.toGroup === RECENT_KEY) { pinChat(meta.id, false); return; }
        const target = keptSections.find(section => section.key === meta.toGroup);
        if (!target) return;
        if (meta.fromGroup === meta.toGroup) { reorderPinned(next[meta.toGroup], target.sectionId); return; }
        fileChat(meta.id, target.sectionId, next[meta.toGroup]);
        folds.setOpen(target.key, true);
    };
    /* While a row is carried, the rows it passes take no pointer: no hover
       fill, no preview. Set on the list itself, not as state — the panel and
       its rows do not render again for picking a row up or letting it go. */
    const setCarrying = (on: boolean) => { listRef.current?.toggleAttribute('data-carrying', on); };

    const listRef = useRef<HTMLUListElement>(null);
    const sectionIds = useMemo(() => sections.map(section => section.id), [sections]);
    const outside = useMemo(() => ({ boundsRef: listRef, group: RECENT_KEY }), []);
    /* Move one of the user's sections one place up or down among them.
       „Angepinnt" stays first and „Verlauf" last: neither is in the list. */
    const moveSection = (id: string, by: -1 | 1) => {
        const ids = sections.map(section => section.id);
        const from = ids.indexOf(id);
        const to = from + by;
        if (from < 0 || to < 0 || to >= ids.length) return;
        [ids[from], ids[to]] = [ids[to], ids[from]];
        reorderSections(ids);
    };

    const openItem = useCallback((item: HistoryItem) => {
        openChat(item.source as ChatListEntry);
    }, [openChat]);

    // Delete mode, as in the sources list: off by default, so the chat cards
    // carry no checkbox. A card's Delete action starts it with that card
    // ticked, in the error colour; the bar's delete asks once for the batch.
    const [selection, setSelection] = useState<Set<string> | null>(null);
    const selecting = selection !== null;
    const toggleSelected = useCallback((id: string, on: boolean) => {
        setSelection(prev => {
            const next = new Set(prev ?? []);
            if (on) next.add(id); else next.delete(id);
            return next;
        });
    }, []);
    const deleteSelected = useCallback(async () => {
        if (!selection) return;
        if (await deleteChats([...selection])) setSelection(null);
    }, [selection, deleteChats]);

    const renameItem = useCallback((item: HistoryItem) => {
        renameChat(item.id, item.title);
    }, [renameChat]);

    /* Move a kept chat one place up or down in its section: the keyboard's
       way to sort them. Reads the sections as they are when it runs, so the
       rows that take it are not rendered again for every change of the list. */
    const keptRef = useRef(keptSections);
    useEffect(() => {
        keptRef.current = keptSections;
    });
    const moveKept = useCallback((sectionKey: string, id: string, by: -1 | 1) => {
        const section = keptRef.current.find(candidate => candidate.key === sectionKey);
        if (!section) return;
        const ids = section.items.map(item => item.id);
        const from = ids.indexOf(id);
        const to = from + by;
        if (from < 0 || to < 0 || to >= ids.length) return;
        [ids[from], ids[to]] = [ids[to], ids[from]];
        reorderPinned(ids, section.sectionId);
    }, [reorderPinned]);
    const startDelete = useCallback((id: string) => setSelection(new Set([id])), []);

    /* One chat as a row, in a kept section (`section`) and in the groups alike. */
    const card = (item: HistoryItem, section?: KeptSection, carried = false) => (
        <HistoryRow
            key={item.id}
            item={item}
            overview={sectionOf(item.source as ChatListEntry)}
            kept={section ? (section.custom ? 'section' : 'pinned') : null}
            sectionKey={section?.key ?? null}
            sectionId={section?.sectionId ?? null}
            place={section ? section.items.indexOf(item) : -1}
            count={section?.items.length ?? 0}
            sections={sections}
            active={!selecting && item.kind !== 'artifact' && item.id === activeChatId}
            selecting={selecting}
            selected={selection?.has(item.id) ?? false}
            carried={carried}
            onOpen={openItem}
            onPin={pinChat}
            onMove={moveKept}
            onRename={renameItem}
            onStartDelete={startDelete}
            onSelectedChange={toggleSelected}
        />
    );
    /* A chat as it is carried: its row again, lifted off the list. */
    const renderDragged = (id: string) => {
        const item = allItems.find(candidate => candidate.id === id);
        if (!item) return null;
        return (
            <ul className="m-0 list-none rounded-[var(--ui-radius-row)] bg-surface-container p-0" data-testid="history-dragged">
                {card(item, undefined, true)}
            </ul>
        );
    };

    /* DIE EINGEKLAPPTE SCHIENE (60px).
     *
     * `AppShellLayout` rendert `nav` in BEIDEN Zuständen — ausgeklappt als
     * Spalteninhalt, eingeklappt als `collapsedPreview` der Schiene. Ohne
     * diesen Zweig landete also das ganze Verlaufspanel in 60px Breite:
     * Überschrift, Datumszeilen und Löschknöpfe, umbrochen bis zur
     * Unleserlichkeit. Das war der falsche Zustand.
     *
     * Ein Symbol je Eintrag, und zwar das Symbol SEINER ART (`KIND_ICON`) —
     * dieselbe Zuordnung wie in der ausgeklappten Liste, damit ein Eintrag
     * beim Ein- und Ausklappen nicht das Symbol wechselt. Der Titel steht im
     * `aria-label` und im `title`, weil in der Schiene kein Text hinpasst und
     * ein Knopf ohne zugänglichen Namen für Screenreader leer wäre.
     *
     * Der „Neuer Chat"-Knopf kommt mit (Entwickler, 22.09.2026): oben in der
     * Schiene, vor der Liste, so wie er ausgeklappt über ihr steht. Ein
     * gefüllter 32px-Knopf (`Button size="icon"`, 16px Symbol) — dieselbe
     * Gestalt wie ausgeklappt, damit er beim Ein- und Ausklappen nicht die
     * Form wechselt.
     */
    if (collapsed) {
        return (
            <>
                {primary && (
                    <SidebarRailItem variant="action" onClick={primary.run} title={primary.label} aria-label={primary.label}>
                        <primary.Icon aria-hidden="true" />
                    </SidebarRailItem>
                )}
                {nav}
                {/* One preview card for the rail: it moves from icon to icon. */}
                <HoverPreviewGroup side="right" align="start">
                <SidebarRail>
                {[...keptItems, ...items].map(item => {
                    const Icon = item.branched ? GitBranch : KIND_ICON[item.kind];
                    const isActive = item.kind !== 'artifact' && item.id === activeChatId;
                    return (
                        <li key={`${item.kind}-${item.id}`}>
                            {/* The 60px column has room for the icon only: title and topic are in the preview. */}
                            <HoverPreview content={preview(item)}>
                                <SidebarRailItem
                                    onClick={() => openItem(item)}
                                    active={isActive}
                                    aria-label={item.title}
                                >
                                    {/* Same icon as the expanded card: a leading emoji wins. */}
                                    {splitLeadingEmoji(item.title).emoji ?? <Icon aria-hidden="true" />}
                                </SidebarRailItem>
                            </HoverPreview>
                        </li>
                    );
                })}
                </SidebarRail>
                </HoverPreviewGroup>
            </>
        );
    }

    return (
        <>
            {/* The same frame as the sources column (DS SidebarPanel): fixed
                head, and only the chat list below it scrolls. */}
            <SidebarPanel
                nav={nav}
                head={(
                    <>
                            {/* Full-width labelled action under the heading, its icon on the
                                cards' icon axis; the collapsed rail keeps the icon-only form. */}
                            {/* ⌘N is the desktop app's (its menu owns it, see
                                DesktopMenuCommands); the hint shows there only. */}
                            {/* Below lg the action is the drawer's bottom button
                                (NewChatButton, placed by the shell), not a row here. */}
                            {!isMobile && primary && (
                                <SidebarAction
                                    type="button"
                                    onClick={primary.run}
                                    icon={<primary.Icon />}
                                    trailing={primary.chat ? <ShortcutHint letter="N" desktopOnly /> : undefined}
                                >
                                    {primary.label}
                                </SidebarAction>
                            )}
                            {selecting && (
                                <SidebarSelectionBar
                                    aria-label={t('deleteChats')}
                                    countLabel={t('selectedCount').replace('{count}', String(selection.size))}
                                    onCancel={() => setSelection(null)}
                                    cancelLabel={t('cancel')}
                                >
                                    <Button
                                        variant="ghost-destructive"
                                        size="icon"
                                        onClick={deleteSelected}
                                        disabled={selection.size === 0}
                                        aria-label={t('deleteSelected')}
                                        title={t('deleteSelected')}
                                    >
                                        <Trash2 size={16} aria-hidden="true" />
                                    </Button>
                                </SidebarSelectionBar>
                            )}
                    </>
                )}
            >
                {generating && (
                    <>
                        <div className="source-card history-panel__generating-card sidebar-ui__item-card">
                            <div className="history-panel__generating-row">
                                <Loader2 className="animate-spin" size={16} />
                                <span>{generatingMessage ?? t('generatingContent')}</span>
                            </div>
                        </div>
                        <ContentRowSkeleton />
                    </>
                )}

                {/* One Tab stop for the whole history: ↑/↓ run through the chats
                    of every day, →/← reach a chat's ⋯ menu (the design
                    system's `data-sidebar-card-groups`). */}
                {/* One preview card for the history: it moves from row to row. */}
                <HoverPreviewGroup side="right" align="start">
                {/* One drag surface: a chat is sorted in its section and carried
                    between the sections and the history. Not while chats are
                    being ticked for deletion. */}
                <Sortable
                    value={sortableValue}
                    onValueCommit={onCommit}
                    strategy="vertical"
                    disabled={selecting}
                    lockedGroups={LOCKED_GROUPS}
                    sortableGroups={sectionIds}
                    placement="start"
                    outside={outside}
                    onDragStart={() => setCarrying(true)}
                    onDragEnd={() => setCarrying(false)}
                >
                <ul ref={listRef} className="history-panel__groups" data-sidebar-card-groups="">
                    {/* The kept sections stand above „Verlauf", each under its
                        own heading; all scroll with the list. A section of the
                        user's own is dragged by its heading. */}
                    {keptSections.map((section) => {
                        const { custom } = section;
                        // Its place among the user's sections: only a move that is possible is offered.
                        const place = custom ? sections.indexOf(custom) : -1;
                        return (
                            <SortableGroup key={section.key} value={section.key} items={sortableValue[section.key]} asChild unstyled>
                                <SidebarSection
                                    label={section.label}
                                    open={folds.isOpen(section.key)}
                                    onOpenChange={next => folds.setOpen(section.key, next)}
                                    renaming={!!custom && namingSection === custom.id}
                                    renameLabel={t('sectionNamePrompt')}
                                    maxNameLength={SECTION_NAME_MAX}
                                    onRename={(name) => {
                                        setNamingSection(null);
                                        if (name && custom) renameSection(custom, name);
                                    }}
                                    empty={t('sectionEmpty')}
                                    actionsLabel={`${t('sectionActions')} ${section.label}`}
                                    actions={[
                                        { label: t('sectionNew'), icon: <FolderPlus size={16} aria-hidden="true" />, onSelect: () => { void addSection(); } },
                                        // Renaming, moving and deleting are for the user's own sections: „Angepinnt" is built in and stays first.
                                        ...(custom ? [{
                                            label: t('sectionRename'), icon: <Pencil size={16} aria-hidden="true" />, separatorBefore: true,
                                            // After the menu's own close, which hands the focus back to its trigger: the name field takes it then.
                                            onSelect: () => { setTimeout(() => setNamingSection(custom.id), 0); },
                                        }] : []),
                                        ...(custom && place > 0 ? [{ label: t('sectionMoveUp'), icon: <ArrowUp size={16} aria-hidden="true" />, onSelect: () => moveSection(custom.id, -1) }] : []),
                                        ...(custom && place < sections.length - 1 ? [{ label: t('sectionMoveDown'), icon: <ArrowDown size={16} aria-hidden="true" />, onSelect: () => moveSection(custom.id, 1) }] : []),
                                        { label: t('sectionCollapseOthers'), icon: <ChevronsDownUp size={16} aria-hidden="true" />, separatorBefore: true, onSelect: () => folds.foldOthers(section.key, foldKeys) },
                                        ...(custom ? [{ label: t('sectionDelete'), icon: <Trash2 size={16} aria-hidden="true" />, destructive: true, separatorBefore: true, onSelect: () => { setTimeout(() => deleteSection(custom), 0); } }] : []),
                                    ]}
                                >
                                    {section.items.length > 0 && (
                                        <SidebarCardList>{section.items.map(item => card(item, section))}</SidebarCardList>
                                    )}
                                </SidebarSection>
                            </SortableGroup>
                        );
                    })}

                    {/* The plain history, always last. It takes drops too: a
                        kept chat let go here is no longer kept. */}
                    <SortableGroup value={RECENT_KEY} items={sortableValue[RECENT_KEY]} asChild unstyled>
                        <SidebarSection
                            label={t('history')}
                            open={historyOpen}
                            onOpenChange={next => folds.setOpen(RECENT_KEY, next)}
                            aside={<HistoryFilterMenu filters={filters} onChange={setFilter} onReset={resetFilters} onCreateSection={() => { void addSection(); }} />}
                        >
                            {groups.map(group => (
                                <SidebarCardGroup key={group.day} label={group.label}>
                                    <SidebarCardList>{group.items.map(item => card(item))}</SidebarCardList>
                                </SidebarCardGroup>
                            ))}
                            {/* Nothing below the pinned section: no chats at all, or the
                                filter hides the rest. Pinned chats alone need no line. */}
                            {items.length === 0 && !generating && (allItems.length === 0 || unpinnedItems.length > 0) && (
                                <p className="sidebar-ui__empty">
                                    {allItems.length === 0 ? t('noHistory') : t('historyFilterEmpty')}
                                </p>
                            )}
                        </SidebarSection>
                    </SortableGroup>
                </ul>
                <SortableOverlay lift="row">{({ value }) => renderDragged(value)}</SortableOverlay>
                </Sortable>
                </HoverPreviewGroup>
            </SidebarPanel>
        </>
    );
};

export const HistoryPanel = memo(HistoryPanelComp);

/**
 * The sidebar's primary action, always in the same place: „Neuer Chat" inside
 * a topic, „Neues Thema" while none is open. A chat needs a topic, and a
 * row that came and went would move everything below it.
 */
function usePrimaryAction() {
    const { t } = useTheme();
    const { newChat, newTopic } = useChatHistory();
    if (newChat) return { run: newChat, label: t('newChat'), Icon: SquarePen, chat: true };
    if (newTopic) return { run: newTopic, label: t('newTopic'), Icon: FolderPlus, chat: false };
    return null;
}

/**
 * The primary action as the navigation drawer's bottom button below lg (the
 * shell's `sidebarNarrowAction`). Its own component, so the layout that
 * places it does not subscribe to the chat history.
 */
export function NewChatButton({ onStarted }: { onStarted: () => void }) {
    const primary = usePrimaryAction();
    if (!primary) return null;
    return (
        <Button type="button" onClick={() => { primary.run(); onStarted(); }}>
            <primary.Icon aria-hidden="true" />
            {primary.label}
        </Button>
    );
}
