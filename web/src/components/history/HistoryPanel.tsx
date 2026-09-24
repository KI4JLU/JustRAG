import React, { memo, useCallback, useMemo, useState } from 'react';
import {
    MessageSquare, Search, GraduationCap, FileText, Loader2, Plus, Trash2, ArrowLeft, Pencil, ListChecks,
} from 'lucide-react';
import {
    Button, SidebarAction, SidebarCard, SidebarCardList, SidebarRail, SidebarPanel, SidebarRailItem, SidebarSelectionBar,
    Tooltip, TooltipContent, TooltipTrigger, useSidebarCollapsed,
} from '@ki4jlu/design-system';
import type { ChatEntry } from '../../types';
import { useTheme } from '../../contexts/ThemeContext';
import { useIsMobileContext } from '../../contexts/MobileContext';
import { useKbCore } from '../../contexts/KbCoreContext';
import { useKbChat } from '../../contexts/KbChatContext';
import { useKbData } from '../../contexts/KbDataContext';
import { ContentRowSkeleton } from '../Skeleton';
import { buildHistoryItems, type HistoryItem, type HistoryKind } from './historyItems';
import { groupHistoryByDay } from './historyGroups';
import { splitLeadingEmoji } from './leadingEmoji';
import '../sidebar-primitives.css';
import './HistoryPanel.css';

const KIND_ICON: Record<HistoryKind, typeof MessageSquare> = {
    chat: MessageSquare,
    artifact: FileText,
    research: Search,
    academic: GraduationCap,
};

const HistoryPanelComp: React.FC = () => {
    const { t, language } = useTheme();
    const isMobile = useIsMobileContext();
    // TRUE, sobald `SidePanel` die Spalte als 60px-Schiene rendert. Nicht
    // `sidebar.isLeftSidebarOpen`: unterhalb `lg` zeigt die Shell die Spalte
    // bildschirmfüllend und IGNORIERT den Einklapp-Zustand — wer sich auf den
    // App-Zustand verließe, bekäme dort die Schiene über die volle Breite.
    const collapsed = useSidebarCollapsed();
    const { currentKb, setKbView, handleGoHome } = useKbCore();
    const { chat } = useKbChat();
    const { content } = useKbData();

    const { chats, activeChatId, handleSelectChat, handleDeleteChat, handleDeleteChats, handleRenameChat, handleNewChat } = chat;
    const { generatedContent, generating, podcastProgress } = content;

    // Nur Chats (Entwickler, 22.09.2026). Artefakte öffneten die Workspace-
    // Ansicht, Recherche- und Academic-Einträge die Bericht-Ansichten — alle
    // drei sind nicht erreichbar (KbViewType = 'chat'). `handleSelectChat`
    // lädt einen Recherche-Eintrag zudem NICHT als Chat (eigener Zweig in
    // useChat.ts, kehrt ohne activeChatId zurück), der Klick wäre also tot.
    // Die Daten bleiben auf dem Server und kommen mit der Tool-Anbindung
    // zurück.
    const items = useMemo(
        () => buildHistoryItems({ chats, generatedContent }).filter(item => item.kind === 'chat'),
        [chats, generatedContent],
    );

    // Day separators instead of a date on every row (developer, 23.09.2026).
    const groups = useMemo(() => groupHistoryByDay(items, t, language), [items, t, language]);

    // Jeder Eintrag öffnet den Chat — es gibt seit dem 22.09.2026 keine
    // andere Ansicht (KbViewType = 'chat').
    const openItem = useCallback((item: HistoryItem) => {
        // Den bereits offenen Chat NICHT neu laden: handleSelectChat setzt
        // chatSwitchingRef, holt die Nachrichten neu und baut den Baum neu auf
        // (useChat.ts) — bei einer laufenden Antwort überschreibt das lokalen
        // State. Der Reiterwechsel muss trotzdem stattfinden, sonst käme man aus
        // dem Workspace nicht in seinen offenen Chat zurück.
        if (item.id !== activeChatId) {
            handleSelectChat(item.source as ChatEntry);
        }
        setKbView('chat');
    }, [handleSelectChat, setKbView, activeChatId]);

    // Radix hands `onSelect` a DOM Event; the handler only needs
    // stopPropagation, which both share.
    const deleteItem = useCallback((item: HistoryItem, e: Event) => {
        handleDeleteChat(item.id, e as unknown as React.MouseEvent);
    }, [handleDeleteChat]);

    // Selection mode (batch actions): off by default, so the chat cards carry no
    // checkbox. Started from a card's "Select" action with that card ticked.
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
        if (await handleDeleteChats([...selection])) setSelection(null);
    }, [selection, handleDeleteChats]);

    const renameItem = useCallback((item: HistoryItem) => {
        handleRenameChat(item.id, item.title);
    }, [handleRenameChat]);

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
                <SidebarRailItem variant="action" onClick={handleNewChat} title={t('newChat')} aria-label={t('newChat')}>
                    <Plus aria-hidden="true" />
                </SidebarRailItem>
                <SidebarRail>
                {items.map(item => {
                    const Icon = KIND_ICON[item.kind];
                    const isActive = item.kind !== 'artifact' && item.id === activeChatId;
                    return (
                        <li key={`${item.kind}-${item.id}`}>
                            {/* Full title beside the rail: the 60px column has room for the icon only. */}
                            <Tooltip>
                                <TooltipTrigger asChild>
                                <SidebarRailItem
                                    onClick={() => openItem(item)}
                                    active={isActive}
                                    aria-label={item.title}
                                >
                                    {/* Same icon as the expanded card: a leading emoji wins. */}
                                    {splitLeadingEmoji(item.title).emoji ?? <Icon aria-hidden="true" />}
                                </SidebarRailItem>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-72">{item.title}</TooltipContent>
                            </Tooltip>
                        </li>
                    );
                })}
                </SidebarRail>
            </>
        );
    }

    return (
        <>
            {isMobile && (
                <div className="history-panel__mobile-header">
                    <button onClick={handleGoHome} className="history-panel__back" aria-label={t('back')}>
                        <ArrowLeft size={20} />
                    </button>
                    <span className="history-panel__kb-name">{currentKb?.name}</span>
                </div>
            )}

            {/* The same frame as the sources column (DS SidebarPanel): fixed
                head, and only the chat list below it scrolls. */}
            <SidebarPanel
                title={t('history')}
                head={(
                    <>
                            {/* Full-width labelled action under the heading, its icon on the
                                cards' icon axis; the collapsed rail keeps the icon-only form. */}
                            <SidebarAction type="button" onClick={handleNewChat} icon={<Plus />}>
                                {t('newChat')}
                            </SidebarAction>
                            {selecting && (
                                <SidebarSelectionBar
                                    aria-label={t('selectChats')}
                                    countLabel={t('selectedCount').replace('{count}', String(selection.size))}
                                    onCancel={() => setSelection(null)}
                                    cancelLabel={t('cancel')}
                                >
                                    <Button
                                        variant="ghost"
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
                                <span>{podcastProgress ? podcastProgress.message : t('generatingContent')}</span>
                            </div>
                        </div>
                        <ContentRowSkeleton />
                    </>
                )}

                <ul className="history-panel__groups">
                    {groups.map(group => (
                        <li key={group.day} className="history-panel__group">
                            <h3 className="history-panel__group-label">{group.label}</h3>
                            <SidebarCardList>
                                {group.items.map(item => {
                                    const Icon = KIND_ICON[item.kind];
                                    // A leading emoji in the title becomes the card's icon.
                                    const { emoji, text } = splitLeadingEmoji(item.title);
                                    return (
                                        <SidebarCard
                                            key={`${item.kind}-${item.id}`}
                                            icon={emoji ?? <Icon />}
                                            title={text}
                                            titleTestId="history-item-title"
                                            onOpen={() => openItem(item)}
                                            active={!selecting && item.kind !== 'artifact' && item.id === activeChatId}
                                            actionsLabel={t('chatActions')}
                                            actions={[
                                                { label: t('renameChat'), icon: <Pencil size={16} aria-hidden="true" />, onSelect: () => renameItem(item) },
                                                { label: t('selectChats'), icon: <ListChecks size={16} aria-hidden="true" />, onSelect: () => setSelection(new Set([item.id])) },
                                                { label: t('deleteItem'), icon: <Trash2 size={16} aria-hidden="true" />, destructive: true, separatorBefore: true, onSelect: (e) => deleteItem(item, e) },
                                            ]}
                                            selectable={selecting}
                                            selectionMode={selecting}
                                            selected={selection?.has(item.id) ?? false}
                                            onSelectedChange={(on) => toggleSelected(item.id, on)}
                                            selectLabel={t('selectChat')}
                                        />
                                    );
                                })}
                            </SidebarCardList>
                        </li>
                    ))}

                    {items.length === 0 && !generating && (
                        <li className="sidebar-ui__empty">{t('noHistory')}</li>
                    )}
                </ul>
            </SidebarPanel>
        </>
    );
};

export const HistoryPanel = memo(HistoryPanelComp);
