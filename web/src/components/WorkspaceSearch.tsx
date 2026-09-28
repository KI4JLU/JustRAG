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
 * story can render the exact markup the bar gets. For where it sits in the
 * bar (an interim), see `WORKSPACE_SEARCH_INTERIM_CLASS`.
 * ------------------------------------------------------------------------- */

/**
 * INTERIM PLACEMENT (PM decision on KI-838, 2026-09-28): the field sits in
 * `headerActions`, before the gear, at a fixed width — not in the `search`
 * slot. In the `search` slot the DS centre region keeps its full 28rem and
 * squeezed the topic title to 0px at 1280px with both columns open (measured,
 * card KI-838). Numbers for that case: bar 560px − 2×24px gutter − one 16px
 * gap = 496px, i.e. 248px per side region. Actions = field + 8px + 36px gear,
 * so the field may be at most 204px; `w-48` (192px) leaves margin, and the
 * title keeps 248 − 36 − 8 = 204px. `min-w-0` lets the field shrink instead of
 * overlapping on a narrower bar. `hidden lg:block`: below `lg` the shell
 * renders `headerActions` in the narrow bar, and the workspace had no phone
 * search before — this keeps it that way.
 * // TODO: move back to the search slot once DS KI-842 ships.
 */
export const WORKSPACE_SEARCH_INTERIM_CLASS = 'hidden w-48 min-w-0 lg:block';
/** The list is wider than the 192px field and hangs from its right edge. */
const INTERIM_LIST_CLASS = 'w-80';

export interface WorkspaceSearchFieldProps {
  /** Layout-only classes for the wrapper; defaults to the interim placement. */
  className?: string;
  kbId: string;
  kbName: string;
  onOpenTopic: (kbId: string) => void;
  onOpenSource: (source: SearchSourceTarget) => void;
  onOpenChat: (target: SearchChatTarget) => void;
}

export const WorkspaceSearchField = forwardRef<HTMLInputElement, WorkspaceSearchFieldProps>(
  function WorkspaceSearchField(
    { className = WORKSPACE_SEARCH_INTERIM_CLASS, kbId, kbName, onOpenTopic, onOpenSource, onOpenChat },
    ref,
  ) {
    const [query, setQuery] = useState('');
    return (
      <div className={className} data-testid="workspace-search">
        <GlobalSearch
          // A new topic is a new scope: remount, so no widening or result of
          // the previous topic survives the switch.
          key={kbId}
          ref={ref}
          query={query}
          onQueryChange={setQuery}
          scopeKbId={kbId}
          scopeLabel={kbName}
          contentClassName={INTERIM_LIST_CLASS}
          contentAlign="end"
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

export function WorkspaceSearch({ className }: { className?: string } = {}) {
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
      className={className}
      kbId={kbId}
      kbName={currentKb.name}
      onOpenTopic={openTopic}
      onOpenSource={openSource}
      onOpenChat={openChat}
    />
  );
}
