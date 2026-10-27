import { useState, useRef, useCallback, useEffect } from 'react';
import type { Message, MessageSource, MessageVerification, StructuredTable, KnowledgeBase, FileEntry, ChatEntry, TrajectoryEvent, ComparisonFinding, MessageConflict, MessageAttachment } from '../types';
import { API_BASE_URL, authFetch } from '../api';
import { HAPTIC_PATTERNS, triggerHaptic } from '../utils/haptics';
import { chatSourceSelection } from '../utils/kbAccess';
import {
  addMessageToTree, updateMessageInTree, remapMessageId, nearestPersistedAncestorId, removeSubtree,
} from '../utils/messageTree';
import { parseSseStream, SseIdleTimeoutError } from '../utils/sseParser';
import { errorInfoFromBody, isFileErrorCode, userErrorMessage } from '../utils/userErrors';
import type { AgentSelection } from './useKbSettings';

interface UseChatStreamParams {
  currentKb: KnowledgeBase | null;
  files: FileEntry[];
  enhance: 'rewrite' | 'expand' | 'spell' | null;
  reasoningEnabled: boolean;
  /** `webSearch` for the request body; `undefined` omits the field (see
   *  utils/chatWebSearch.ts `chatWebSearchRequestField`). */
  webSearchEnabled: boolean | undefined;
  reasoningLevel: 'low' | 'medium' | 'high';
  agentSelection: AgentSelection;
  language: string;
  // Tree state setters from useMessageTree
  setMessageTree: React.Dispatch<React.SetStateAction<Map<string, Message>>>;
  messageTreeRef: React.MutableRefObject<Map<string, Message>>;
  setActiveLeafId: (id: string | null) => void;
  // Chat state from useChat
  activeChatIdRef: React.MutableRefObject<string | null>;
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  setChats: React.Dispatch<React.SetStateAction<ChatEntry[]>>;
  fetchChats: (kbId: string) => Promise<void>;
  fetchChatsTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>;
  // Translation
  t: (key: string) => string;
}

/**
 * Hook for SSE streaming of chat messages.
 *
 * Owns the loading state, abort controllers and the sequential request
 * counter for staleness detection.
 *
 * `loading` covers generation only: it ends with the `aiMessageId` frame, when
 * the answer is saved. The stream then keeps running for the post-response
 * frames (verification, follow-ups, conflicts), which land on that answer by
 * id, while the composer is free for the next question.
 */
export function useChatStream({
  currentKb, files, enhance,
  reasoningEnabled, webSearchEnabled, reasoningLevel, agentSelection, language,
  setMessageTree, messageTreeRef, setActiveLeafId,
  activeChatIdRef, setActiveChatId, setChats,
  fetchChats, fetchChatsTimerRef,
  t,
}: UseChatStreamParams) {
  const [loading, setLoading] = useState(false);
  // The stream that is still generating; a new send or a cancel aborts it.
  const chatAbortRef = useRef<AbortController | null>(null);
  // Streams whose answer is saved and that only wait for post-response
  // frames. A new send leaves them running; unmount aborts them.
  const finishingRef = useRef<Set<AbortController>>(new Set());
  const requestIdRef = useRef(0);
  useEffect(() => {
    const finishing = finishingRef.current;
    return () => { finishing.forEach(c => c.abort()); };
  }, []);
  // Optimistic questions of sends the server refused before storing them.
  // They stay on screen with their error bubble; the next send from below one
  // replaces it (removeSubtree), since the composer got its text back.
  const refusedQuestionIdsRef = useRef<Set<string>>(new Set());

  const handleSendMessage = useCallback(async (
    _e: React.FormEvent | React.KeyboardEvent,
    userMessage: string,
    activeLeafId: string | null,
    // `null` means "this message is the root of the chat" and is NOT the same
    // as `undefined` ("caller has no opinion, use the active leaf"). Editing
    // the first question of a chat produces the former; collapsing the two
    // appended the edited question to the very answer it replaces.
    editParentId?: string | null,
    opts?: {
      attachmentId?: string;
      comparisonModes?: string[];
      // Chat attachments of this question: ids for the request, chip data for
      // the optimistic message.
      attachmentIds?: string[];
      attachments?: MessageAttachment[];
      // Called once the server accepted the turn (the question is stored),
      // before the answer streams — the composer clears its files then.
      onAccepted?: () => void;
      agentSelection?: AgentSelection;
      // "Antwort neu generieren": no new question is written. The answer
      // hangs under the named, already-persisted question as a sibling of
      // `aiMessageId`, so the prompt appears exactly once and the ‹1/2›
      // switcher lands on the answers.
      regenerateOf?: { aiMessageId: string; userMessageId: string };
    },
  ): Promise<boolean> => {
    // A caller who cannot see the source list sends no selectedFileIds (the
    // turn uses the whole KB); see chatSourceSelection.
    const selection = chatSourceSelection(currentKb, files);
    if (!userMessage.trim() || !currentKb || loading || !selection.canSend) return false;
    triggerHaptic(HAPTIC_PATTERNS.send);

    // Die Auswahl aus den Sende-Optionen schlägt den Hook-State: setAgentSelection
    // wirkt erst ab dem nächsten Render, der Vergleichs-Turn wird aber sofort
    // abgeschickt und liefe sonst mit der vorherigen Auswahl.
    const effectiveSelection = opts?.agentSelection ?? agentSelection;

    const regenerateOf = opts?.regenerateOf;

    // The active leaf can be an unpersisted temp id (e.g. a temp-error node from
    // a failed send). Resolve to the nearest persisted ancestor so we never post
    // a temp id as parentMessageId — doing so hits the uuid `messages` columns
    // and drops the whole conversation history (SQLSTATE 22P02).
    const rawParentId = editParentId !== undefined ? editParentId : activeLeafId;
    const parentId = nearestPersistedAncestorId(messageTreeRef.current, rawParentId) ?? undefined;
    // A retry from below a refused question replaces it: it was never stored.
    let refusedQuestionId: string | undefined;
    for (let cur = rawParentId ?? undefined; cur && cur !== parentId; cur = messageTreeRef.current.get(cur)?.parentMessageId ?? undefined) {
      if (refusedQuestionIdsRef.current.has(cur)) refusedQuestionId = cur;
    }
    const tempUserMsgId = `temp-user-${Date.now()}`;
    const sentAt = new Date().toISOString();
    const tempAiMsgId = `temp-ai-${Date.now()}`;

    // Everything below hangs off the turn's question. On a regenerate that is
    // the existing, already-persisted one; otherwise it is the placeholder we
    // are about to insert.
    const userNodeId = regenerateOf?.userMessageId ?? tempUserMsgId;

    if (refusedQuestionId) refusedQuestionIdsRef.current.delete(refusedQuestionId);
    setMessageTree(prev => {
      let tree = refusedQuestionId ? removeSubtree(prev, refusedQuestionId) : prev;
      if (!regenerateOf) {
        tree = addMessageToTree(tree, {
          id: tempUserMsgId,
          createdAt: sentAt,
          parentMessageId: parentId,
          role: 'user',
          content: userMessage,
          ...(opts?.attachments?.length ? { attachments: opts.attachments } : {}),
        });
      }
      const aiMsg: Message = {
        id: tempAiMsgId,
        createdAt: sentAt,
        parentMessageId: userNodeId,
        role: 'ai',
        content: '',
      };
      tree = addMessageToTree(tree, aiMsg);
      return tree;
    });
    setActiveLeafId(tempAiMsgId);
    const thisRequestId = ++requestIdRef.current;
    setLoading(true);
    // Whether the server took the turn (the question is stored from then on).
    // The composer keeps its attachments when it did not, for a retry.
    let accepted = false;
    // The reason shown in the error bubble when the server refused the turn
    // for a cause the user can fix; anything else shows the generic error.
    let refusal: string | null = null;
    // The tree node this request writes to: the temp id until the
    // `aiMessageId` frame, the saved id after it. Request-local, so a stream
    // still finishing writes to its own answer after the next send.
    let aiNodeId = tempAiMsgId;
    // True once the answer is saved (the `aiMessageId` frame).
    let answerSaved = false;
    // Abort a previous stream that is still generating; one that is only
    // finishing keeps running.
    chatAbortRef.current?.abort();
    const abortController = new AbortController();
    chatAbortRef.current = abortController;

    try {
      const response = await authFetch(`${API_BASE_URL}/api/kb/${currentKb.id}/chat?stream=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          method: 'semantic',
          enhance: enhance,
          chatId: activeChatIdRef.current,
          // Mutually exclusive: a regenerate names the answer to replace and
          // the backend derives the question (and its parent) from it. Sending
          // a parent alongside would insert a second copy of the question.
          ...(regenerateOf
            ? { regenerateOfMessageId: regenerateOf.aiMessageId }
            : { parentMessageId: parentId }),
          reasoningEnabled: reasoningEnabled,
          reasoningLevel: reasoningLevel,
          // Per-turn capability from the composer's + menu: hands the answer
          // LLM the web_search tool for this turn (chat/web_search_turn.go).
          // Omitted entirely while the admin gate is closed, so the answer
          // tools behave as upstream (API.md: absent ≠ false).
          ...(webSearchEnabled === undefined ? {} : { webSearch: webSearchEnabled }),
          language,
          ...(selection.selectedFileIds ? { selectedFileIds: selection.selectedFileIds } : {}),
          // Sticky agent/team selection for this chat session (Standard omits
          // both). Sent with every chat POST when set. `effectiveSelection`
          // prefers `opts.agentSelection` over the hook-state closure — see
          // the comment above its declaration.
          ...(effectiveSelection?.teamId ? { teamId: effectiveSelection.teamId } : {}),
          ...(effectiveSelection?.agentId ? { agentId: effectiveSelection.agentId } : {}),
          // In-chat document comparison: when an attachment is present the
          // backend injects it; non-empty `comparisonModes` makes the turn a
          // comparison (otherwise it's a normal follow-up over the attachment).
          ...(opts?.attachmentId ? { attachmentId: opts.attachmentId } : {}),
          // Chat attachments as context (API.md § Chat): files uploaded for
          // this question.
          ...(opts?.attachmentIds?.length ? { attachmentIds: opts.attachmentIds } : {}),
          ...(opts?.comparisonModes && opts.comparisonModes.length > 0
            ? { comparisonModes: opts.comparisonModes }
            : {}),
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorData: unknown = await response.json().catch(() => ({}));
        const info = errorInfoFromBody(response.status, errorData);
        // A send refers to its attachments by id; a file refusal carries the
        // attachment's fileName so the message can say which one to remove.
        const fileName = (errorData as { fileName?: unknown } | null)?.fileName;
        if (info.code === 'too_large_for_context') {
          refusal = t('chatAttachmentsTooLongTogether');
        } else if (isFileErrorCode(info.code) && typeof fileName === 'string' && fileName) {
          refusal = `${userErrorMessage(info, t, { name: fileName, locale: language })} ${t('chatAttachmentRemoveHint')}`;
        } else if (isFileErrorCode(info.code)) {
          refusal = t('chatAttachmentsUnusable');
        } else {
          refusal = userErrorMessage(info, t, { fallbackKey: 'chatSendError' });
        }
        throw new Error(`chat send refused: ${response.status}`);
      }

      accepted = true;
      opts?.onAccepted?.();
      const reader = response.body?.getReader();
      if (!reader) throw new Error(t('noReaderError'));

      let aiMessageContent = '';
      let aiSources: MessageSource[] = [];
      let enhancedShown = false;

      await parseSseStream(reader, {
        // Watchdog against a silently hung server: orchestrators stream
        // trajectory/token events steadily, but a single long LLM call can
        // legitimately go quiet for tens of seconds — so the window is
        // generous. On timeout the parser cancels the stream and throws
        // SseIdleTimeoutError, which the catch below reports as a timeout.
        idleTimeoutMs: 120_000,
        isStale: () => abortController.signal.aborted,
        onParseError: (e) => { console.error('Error parsing SSE data:', e); },
        onEvent: (data: unknown) => {
          const event = data as Record<string, unknown>;

          // Never on a regenerate: the enhanced query renders as a second
          // user bubble under the question, which is precisely the duplicate
          // prompt this path exists to avoid. The backend suppresses the
          // enhancer for a regenerate; this is the client-side half of it.
          if (event.enhancedQuery && !enhancedShown && !regenerateOf) {
            enhancedShown = true;
            const enhancedMsgId = `temp-enhanced-${Date.now()}`;
            const aiTempId = aiNodeId;
            setMessageTree(prev => {
              const tree = new Map(prev);
              const aiNode = tree.get(aiTempId);
              if (aiNode) {
                const enhancedMsg: Message = {
                  id: enhancedMsgId,
                  parentMessageId: tempUserMsgId,
                  role: 'user',
                  content: `\u2728 ${event.enhancedQuery}`,
                  isEnhanced: true,
                  childIds: [aiTempId],
                };
                tree.set(enhancedMsgId, enhancedMsg);

                const userNode = tree.get(tempUserMsgId);
                if (userNode) {
                  tree.set(tempUserMsgId, {
                    ...userNode,
                    childIds: (userNode.childIds || []).map(id => id === aiTempId ? enhancedMsgId : id),
                  });
                }

                tree.set(aiTempId, { ...aiNode, parentMessageId: enhancedMsgId });
              }
              return tree;
            });
          }

          if (event.deepSearch) {
            setMessageTree(prev => updateMessageInTree(prev, aiNodeId, {
              isDeepSearch: true,
            }));
          }

          if (event.deepSearchStatus) {
            // Status updates from deep search (e.g. "Searching...", "Synthesizing...")
            // Currently unused in UI, but available for future display
          }

          if (event.agentTrajectory) {
            // Unified agent-trajectory envelope (Phase 1 §1.1). Append to
            // the AI message's `trajectory` array — the renderer derives
            // the reasoning panel from that array.
            //
            // AP-A2: when the event is `refine_complete` and carries the
            // refined text, replace the streamed answer in place so the
            // painted answer reflects the corrected version. The diff
            // remains on the trajectory entry so TrajectoryPanel can
            // highlight changed words, but the diff itself is
            // newline-lossy (see go-backend refine_diff.go) and must NOT
            // be used to reconstruct the message body.
            const evt = event.agentTrajectory as TrajectoryEvent;
            const aiTempId = aiNodeId;
            setMessageTree(prev => {
              const node = prev.get(aiTempId);
              if (!node) return prev;
              const nextTrajectory = [...(node.trajectory ?? []), evt];
              const update: Partial<Message> = { trajectory: nextTrajectory };
              if (evt.stage === 'refine_complete' && evt.refined_text) {
                update.content = evt.refined_text;
              }
              return updateMessageInTree(prev, aiTempId, update);
            });
          }

          // Legacy `planExecuteStage` / `agenticHop` events: backwards-compat
          // shim while the unified `agentTrajectory` envelope rolls out. The
          // backend emits both shapes for one release; once it stops, this
          // block becomes dead code and can be deleted.
          if (event.planExecuteStage || event.agenticHop) {
            if (typeof console !== 'undefined' && console.debug) {
              console.debug('[trajectory.legacy]', event);
            }
          }

          if (event.chatId && !activeChatIdRef.current) {
            setActiveChatId(event.chatId as string);
            // Optimistically add the new chat to the list immediately
            setChats(prev => {
              if (prev.some(c => c.id === event.chatId)) return prev;
              const now = new Date().toISOString();
              return [{ id: event.chatId as string, kbId: currentKb.id, userId: '', title: userMessage.substring(0, 50), createdAt: now, updatedAt: now }, ...prev];
            });
          }

          if (event.userMessageId) {
            setMessageTree(prev => remapMessageId(prev, tempUserMsgId, event.userMessageId as string));
          }

          if (event.aiMessageId) {
            const prevAiTempId = aiNodeId;
            aiNodeId = event.aiMessageId as string;
            // Atomically remap the tree node and update the active leaf in a single state update
            // to prevent an intermediate render where activeLeafId points to a non-existent node
            setMessageTree(prev => remapMessageId(prev, prevAiTempId, event.aiMessageId as string));
            setActiveLeafId(event.aiMessageId as string);
            // Stamp attribution from the CURRENT selection (`effectiveSelection`,
            // not the closure-only `agentSelection` — see above) so the chip
            // renders immediately, without waiting for a chat reload to pick up
            // the backend-persisted teamId/agentId columns, and so the persisted
            // attribution matches the agent that actually answered this turn.
            setMessageTree(prev => updateMessageInTree(prev, event.aiMessageId as string, {
              teamId: effectiveSelection?.teamId ?? null,
              agentId: effectiveSelection?.agentId ?? null,
            }));
            // The answer is saved: free the composer and keep this stream
            // for the post-response frames.
            answerSaved = true;
            if (chatAbortRef.current === abortController) {
              chatAbortRef.current = null;
              finishingRef.current.add(abortController);
            }
            if (requestIdRef.current === thisRequestId) setLoading(false);
          }

          if (event.error) {
            // The frame's text is the backend's (English, technical); the
            // user sees a localized message, after whatever already streamed.
            console.error('[Chat] Server error:', event.error);
            const notice = t('errorAnswerFailed');
            setMessageTree(prev => updateMessageInTree(prev, aiNodeId, {
              content: aiMessageContent ? `${aiMessageContent}\n\n${notice}` : notice,
            }));
          }
          if (event.sources) {
            aiSources = event.sources as MessageSource[];
          }
          if (event.reasoning) {
            setMessageTree(prev => {
              const existing = prev.get(aiNodeId);
              return updateMessageInTree(prev, aiNodeId, {
                reasoning: (existing?.reasoning || '') + (event.reasoning as string),
                sources: aiSources,
              });
            });
          }
          if (event.content) {
            aiMessageContent += event.content as string;
            setMessageTree(prev => updateMessageInTree(prev, aiNodeId, {
              content: aiMessageContent,
              sources: aiSources,
            }));
          }
          if (event.followUpQuestions) {
            setMessageTree(prev => updateMessageInTree(prev, aiNodeId, {
              followUpQuestions: event.followUpQuestions as string[],
            }));
          }
          if (event.verification) {
            setMessageTree(prev => updateMessageInTree(prev, aiNodeId, {
              verification: event.verification as MessageVerification,
            }));
          }
          if (event.structuredTable) {
            setMessageTree(prev => updateMessageInTree(prev, aiNodeId, {
              structured_table: event.structuredTable as StructuredTable,
            }));
          }
          if (event.comparisonFindings) {
            setMessageTree(prev => updateMessageInTree(prev, aiNodeId, {
              comparisonFindings: event.comparisonFindings as ComparisonFinding[],
            }));
          }
          if (event.conflicts) {
            setMessageTree(prev => updateMessageInTree(prev, aiNodeId, {
              conflicts: event.conflicts as MessageConflict[],
            }));
          }
        },
      });

      clearTimeout(fetchChatsTimerRef.current);
      fetchChatsTimerRef.current = setTimeout(() => {
        fetchChats(currentKb.id);
      }, 1000);

    } catch (err: unknown) {
      // Ignore abort errors (user navigated away or sent a new message)
      if (err instanceof DOMException && err.name === 'AbortError') return accepted;
      // A failure after the answer was saved only costs the post-response
      // frames; the answer stands and the next turn may already be running.
      if (answerSaved) {
        console.error('Chat post-response stream failed:', err);
        return accepted;
      }
      console.error('Chat failed:', err);
      if (!accepted && !regenerateOf) refusedQuestionIdsRef.current.add(tempUserMsgId);
      const errorMsgId = `temp-error-${Date.now()}`;
      let content = refusal ?? t('aiGenericError');
      if (err instanceof SseIdleTimeoutError) content = t('errorAnswerTimeout');
      else if (err instanceof TypeError) content = t('errorServiceUnavailable'); // fetch: network failure
      setMessageTree(prev => addMessageToTree(prev, {
        id: errorMsgId,
        parentMessageId: userNodeId,
        role: 'ai',
        content,
      }));
      setActiveLeafId(errorMsgId);
    } finally {
      finishingRef.current.delete(abortController);
      if (chatAbortRef.current === abortController) chatAbortRef.current = null;
      // Only reset loading if this is still the active request.
      // Prevents a stale finally from an aborted request clearing loading
      // while a newer request is in-flight.
      if (requestIdRef.current === thisRequestId) {
        setLoading(false);
      }
    }
    return accepted;
  }, [currentKb, loading, files, enhance, reasoningEnabled, webSearchEnabled, reasoningLevel, agentSelection, language, fetchChats, t, activeChatIdRef, fetchChatsTimerRef, messageTreeRef, setActiveChatId, setActiveLeafId, setChats, setMessageTree]);

  const cancelStream = useCallback(() => {
    chatAbortRef.current?.abort();
  }, []);

  return {
    loading,
    handleSendMessage,
    cancelStream,
    chatAbortRef,
  };
}
