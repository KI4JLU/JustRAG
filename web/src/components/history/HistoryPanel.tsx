import React, { memo, useCallback, useMemo } from 'react';
import {
    MessageSquare, Search, GraduationCap, FileText, Loader2, Plus, Trash2, ArrowLeft, MoreVertical, Pencil,
} from 'lucide-react';
import {
    Button, useSidebarCollapsed,
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
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
import { isCardControlClick } from '../sidebar/cardClick';
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

    const { chats, activeChatId, handleSelectChat, handleDeleteChat, handleRenameChat, handleNewChat } = chat;
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
                <Button
                    type="button"
                    size="icon"
                    onClick={handleNewChat}
                    title={t('newChat')}
                    aria-label={t('newChat')}
                >
                    <Plus size={16} aria-hidden="true" />
                </Button>
                <ul className="history-panel__rail">
                {items.map(item => {
                    const Icon = KIND_ICON[item.kind];
                    const isActive = item.kind !== 'artifact' && item.id === activeChatId;
                    return (
                        <li key={`${item.kind}-${item.id}`}>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => openItem(item)}
                                className={isActive ? 'history-panel__rail-item--active' : undefined}
                                title={item.title}
                                aria-label={item.title}
                                aria-current={isActive ? 'true' : undefined}
                            >
                                <Icon size={18} aria-hidden="true" />
                            </Button>
                        </li>
                    );
                })}
                </ul>
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

            <div className="history-panel">
                <div className="sidebar-ui__section-header">
                    <h2 className="sidebar-ui__section-title">{t('history')}</h2>
                    <button
                        className="send-button history-panel__new-chat-btn"
                        onClick={handleNewChat}
                        title={t('newChat')}
                        aria-label={t('newChat')}
                    >
                        <Plus size={16} />
                    </button>
                </div>

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

                <ul className="sidebar-ui__list sidebar-ui__list--stack">
                    {groups.map(group => (
                        <li key={group.day} className="history-panel__group">
                            <h3 className="history-panel__group-label">{group.label}</h3>
                            <ul className="sidebar-ui__list history-panel__group-list">
                                {group.items.map(item => {
                                    const Icon = KIND_ICON[item.kind];
                                    const isActive = item.kind !== 'artifact' && item.id === activeChatId;
                                    return (
                                                                                // Whole-plane click is a pointer convenience; the title button inside is the keyboard path.
                                        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
                                        <li
                                            key={`${item.kind}-${item.id}`}
                                            className={`source-card history-panel__item${isActive ? ' history-panel__item--active' : ''}`}
                                            onClick={(e) => { if (!isCardControlClick(e)) openItem(item); }}
                                        >
                                            <button
                                                data-testid="history-item-title"
                                                onClick={() => openItem(item)}
                                                className="text-button source-title sidebar-ui__item-title history-panel__item-title"
                                                title={item.title}
                                            >
                                                <Icon size={14} className="flex-shrink-0" aria-hidden="true" />
                                                <span className="history-panel__item-title-text">{item.title}</span>
                                            </button>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" aria-label={`${t('chatActions')} ${item.title}`}>
                                                        <MoreVertical size={16} aria-hidden="true" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onSelect={() => renameItem(item)}>
                                                        <Pencil size={16} aria-hidden="true" />
                                                        {t('renameChat')}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem variant="destructive" onSelect={(e) => deleteItem(item, e)}>
                                                        <Trash2 size={16} aria-hidden="true" />
                                                        {t('deleteItem')}
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </li>
                                    );
                                })}
                            </ul>
                        </li>
                    ))}

                    {items.length === 0 && !generating && (
                        <li className="sidebar-ui__empty">{t('noHistory')}</li>
                    )}
                </ul>
            </div>
        </>
    );
};

export const HistoryPanel = memo(HistoryPanelComp);
