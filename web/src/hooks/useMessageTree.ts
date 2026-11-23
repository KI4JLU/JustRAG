import { useState, useEffect, useRef, useMemo } from 'react';
import type { Message } from '../types';
import { getPathToRoot } from '../utils/messageTree';

/**
 * Hook for message tree state.
 *
 * Owns the message tree Map and the active leaf; `messages` is the path from
 * the root to that leaf. A chat that still holds several versions of a turn
 * (written before regenerate and edit moved to branch chats, or by an API
 * client) shows the leaf findDefaultLeaf picks — its newest path.
 */
export function useMessageTree() {
  const [messageTree, setMessageTree] = useState<Map<string, Message>>(new Map());
  const messageTreeRef = useRef<Map<string, Message>>(new Map());

  // Sync ref with state
  useEffect(() => {
    messageTreeRef.current = messageTree;
  }, [messageTree]);

  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const messages = useMemo(() => getPathToRoot(messageTree, activeLeafId), [messageTree, activeLeafId]);

  return {
    messageTree,
    setMessageTree,
    messageTreeRef,
    activeLeafId,
    setActiveLeafId,
    messages,
  };
}
