import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { ChatEntry, KnowledgeBase } from '../../types';
import { ChatHistoryProvider, type ChatHistoryContextValue } from '../../contexts/ChatHistoryContext';
import { useAllChats } from '../../hooks/useAllChats';
import { useTheme } from '../../contexts/ThemeContext';
import { useModalContext } from '../../contexts/ModalContext';
import { useToast } from '../../contexts/ToastContext';

/** What the app shell knows and the history needs: the open topic, and the chat actions that live with it. */
export type ChatHistoryHost = Pick<
  ChatHistoryContextValue,
  'activeChatId' | 'openTopicId' | 'sectionOf' | 'openChat' | 'deleteChats' | 'newChat' | 'newTopic'
> & {
  /** Rename a chat (asks for the title); resolves when it is done. */
  renameChat: (id: string, currentTitle: string) => Promise<unknown>;
};

interface ChatHistoryStoreProps {
  host: ChatHistoryHost;
  /** The open topic's chats, which carry its optimistic updates. */
  liveChats: ChatEntry[];
  currentKb: KnowledgeBase | null;
  /** Changes whenever the list should be read again. */
  refreshKey: string;
  children: ReactNode;
}

/**
 * Holds the sidebar history's own state — the chats of all topics, what the
 * user keeps at hand, their sections — and provides it.
 *
 * Its own component below the app shell, so that pinning, filing, sorting or
 * naming renders this provider and the history, and nothing else: the page
 * under it is `children`, which the shell made and which does not change.
 *
 * The actions it hands out keep their identity for good (they read the
 * shell's latest functions when called), so a row that takes them stays
 * memoised across every render of the shell.
 */
export function ChatHistoryStore({ host, liveChats, currentKb, refreshKey, children }: ChatHistoryStoreProps) {
  const { t } = useTheme();
  const toast = useToast();
  const { showConfirm } = useModalContext();

  const onPinError = useCallback((pinned: boolean) => {
    toast.error(t(pinned ? 'pinChatError' : 'unpinChatError'));
  }, [toast, t]);
  const onSectionError = useCallback((action: 'create' | 'rename' | 'delete') => {
    toast.error(t(action === 'create' ? 'sectionCreateError' : action === 'rename' ? 'sectionRenameError' : 'sectionDeleteError'));
  }, [toast, t]);
  const onPinOrderError = useCallback(() => { toast.error(t('pinOrderError')); }, [toast, t]);
  const store = useAllChats({ liveChats, onPinError, onPinOrderError, onSectionError, currentKb, refreshKey });

  // The latest of everything the actions call, read when an action runs.
  const latest = useRef({ host, store, t, showConfirm });
  useEffect(() => {
    latest.current = { host, store, t, showConfirm };
  });

  const actions = useMemo(() => {
    const now = () => latest.current;
    return {
      openChat: (chat) => now().host.openChat(chat),
      deleteChats: async (ids) => {
        const deleted = await now().host.deleteChats(ids);
        if (deleted) void now().store.refresh();
        return deleted;
      },
      renameChat: (id, title) => { void now().host.renameChat(id, title).then(() => now().store.refresh()); },
      pinChat: (id, pinned, sectionId = null) => { void now().store.setPinned(id, pinned, sectionId); },
      reorderPinned: (ids, sectionId) => { void now().store.setPinnedOrder(ids, sectionId); },
      fileChat: (id, sectionId, ids) => { void now().store.fileAt(id, sectionId, ids); },
      createSection: () => now().store.createSection(now().t('sectionNew')),
      renameSection: (section, name) => { void now().store.renameSection(section.id, name); },
      reorderSections: (ids) => { void now().store.setSectionOrder(ids); },
      deleteSection: (section) => {
        const { t: translate, showConfirm: confirm } = now();
        void confirm(translate('sectionDeleteConfirm').replace('{name}', section.name), undefined, { tone: 'destructive', confirmLabel: translate('delete') })
          .then((ok) => { if (ok) void now().store.deleteSection(section.id); });
      },
    } satisfies Partial<ChatHistoryContextValue>;
  }, []);

  const { activeChatId, openTopicId, sectionOf, newChat, newTopic } = host;
  const value = useMemo<ChatHistoryContextValue>(() => ({
    ...actions,
    chats: store.chats,
    sections: store.sections,
    activeChatId, openTopicId, sectionOf, newChat, newTopic,
  }), [actions, store.chats, store.sections, activeChatId, openTopicId, sectionOf, newChat, newTopic]);

  return <ChatHistoryProvider value={value}>{children}</ChatHistoryProvider>;
}
