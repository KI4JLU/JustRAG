import { forwardRef, useCallback, useState } from 'react';
import { GlobalSearch } from './GlobalSearch';
import { useKbCore } from '../contexts/KbCoreContext';
import { useKbChat } from '../contexts/KbChatContext';
import { useKbData } from '../contexts/KbDataContext';
import { useAppNav } from '../contexts/AppNavContext';
import { chatEntryFromTarget, type SearchChatTarget, type SearchSourceTarget } from '../hooks/useSearchNavigation';

/* ---------------------------------------------------------------------------
 * The workspace header's topic-scoped search (card KI-838).
 *
 * THE SAME COMPONENT AS THE SHELL HEADER'S, `GlobalSearch`, with
 * `scopeKbId={currentKb.id}`: every group is limited to this topic, the
 * Topics group is omitted, and a „search all topics" row widens the current
 * query. There is no second search component and no second debounce.
 *
 * WHERE A HIT GOES, and why it differs from the shell header:
 *  - A hit IN THIS TOPIC must not reopen the topic. The header's path
 *    (`AppNavContext.onOpen*` → `useSearchNavigation`) starts with
 *    `handleOpenKbById`, whose `handleSelectKB` calls `handleNewChat` — here
 *    that would throw away the chat on screen for nothing. So in-topic hits
 *    call `handleSelectChat` / `handlePreviewSource` directly, exactly as the
 *    history sidebar and the sources panel do.
 *  - A hit in ANOTHER topic (only reachable after widening) navigates like the
 *    header: through `AppNavContext`, topic first.
 *  - A topic hit for THIS topic (widened results can contain it) is a no-op
 *    beyond closing the list: the user is already there.
 *
 * `WorkspaceSearchField` is the part with no context reads, so the geometry
 * story can render the exact markup the bar gets. It sits in the bar's
 * centred `search` slot (KI-844; `KbWorkspaceLayout.tsx`).
 * ------------------------------------------------------------------------- */

/**
 * The list's own width. The field sits in `AppShellLayout`'s centred `search`
 * slot (KI-844, design-system 0.44.1), which gives way before the side
 * regions: at 1280px with both columns at 320px the slot shrinks to its 8rem
 * (128px) floor, too narrow for a two-line result row. So the popover is
 * 20rem wide and centred under the field, whatever width the field has.
 */
const LIST_CLASS = 'w-80';

export interface WorkspaceSearchFieldProps {
  kbId: string;
  kbName: string;
  onOpenTopic: (kbId: string) => void;
  onOpenSource: (source: SearchSourceTarget) => void;
  onOpenChat: (target: SearchChatTarget) => void;
}

export const WorkspaceSearchField = forwardRef<HTMLInputElement, WorkspaceSearchFieldProps>(
  function WorkspaceSearchField(
    { kbId, kbName, onOpenTopic, onOpenSource, onOpenChat },
    ref,
  ) {
    const [query, setQuery] = useState('');
    return (
      /* `w-full` on the wrapper: the field fills the slot, which the design
         system sizes (28rem, shrinking to 8rem) and centres on the bar — the
         same recipe as AppChrome's field. */
      <div className="w-full" data-testid="workspace-search">
        <GlobalSearch
          // A new topic is a new scope: remount, so no widening or result of
          // the previous topic survives the switch.
          key={kbId}
          ref={ref}
          query={query}
          onQueryChange={setQuery}
          scopeKbId={kbId}
          scopeLabel={kbName}
          contentClassName={LIST_CLASS}
          contentAlign="center"
          onOpenTopic={(hit) => onOpenTopic(hit.id)}
          onOpenSource={(hit) => onOpenSource({ id: hit.id, name: hit.name, kbId: hit.kbId })}
          onOpenChat={(hit) => onOpenChat({
            chatId: hit.id, kbId: hit.kbId, title: hit.title, type: hit.type, timestamp: hit.updatedAt,
          })}
          onOpenMessage={(hit) => onOpenChat({
            chatId: hit.chatId, kbId: hit.kbId, title: hit.chatTitle, type: hit.chatType, timestamp: hit.createdAt,
          })}
        />
      </div>
    );
  },
);

export function WorkspaceSearch() {
  const { currentKb, setKbView } = useKbCore();
  const { chat } = useKbChat();
  const { webTools } = useKbData();
  const appNav = useAppNav();
  const kbId = currentKb.id;
  const { chats, activeChatId, handleSelectChat } = chat;
  const { handlePreviewSource } = webTools;

  const openTopic = useCallback((id: string) => {
    if (id !== kbId) appNav.onOpenTopic(id);
  }, [kbId, appNav]);

  const openSource = useCallback((source: SearchSourceTarget) => {
    if (source.kbId !== kbId) {
      appNav.onOpenSource(source);
      return;
    }
    handlePreviewSource(source.id, source.name);
  }, [kbId, appNav, handlePreviewSource]);

  const openChat = useCallback((target: SearchChatTarget) => {
    if (target.kbId !== kbId) {
      appNav.onOpenChat(target);
      return;
    }
    // The sidebar's own entry when it has one: it carries the chat's sticky
    // team/agent, which a search hit does not (see useSearchNavigation).
    const entry = chats.find((c) => c.id === target.chatId) ?? chatEntryFromTarget(target);
    // Same rule as HistoryPanel.openItem: the chat already on screen is not
    // reloaded (a reload rebuilds the tree under a running answer).
    if (entry.id !== activeChatId) void handleSelectChat(entry);
    setKbView('chat');
  }, [kbId, appNav, chats, activeChatId, handleSelectChat, setKbView]);

  return (
    <WorkspaceSearchField
      kbId={kbId}
      kbName={currentKb.name}
      onOpenTopic={openTopic}
      onOpenSource={openSource}
      onOpenChat={openChat}
    />
  );
}
