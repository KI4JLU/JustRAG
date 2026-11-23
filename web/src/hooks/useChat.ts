import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import axios from 'axios';
import type { Message, MessageSource, MessageVerification, StructuredTable, KnowledgeBase, FileEntry, ChatEntry, MessageConflict, MessageAttachment, TrajectoryEvent } from '../types';
import { API_BASE_URL } from '../api';
import { useTheme } from '../contexts/ThemeContext';

import { useModalContext } from '../contexts/ModalContext';
import { useToast } from '../contexts/ToastContext';
import { chatSourceSelection } from '../utils/kbAccess';
import { buildMessageMap, findDefaultLeaf, isTempMessageId, nearestPersistedAncestorId } from '../utils/messageTree';
import { useMessageTree } from './useMessageTree';
import { useChatStream } from './useChatStream';

/** The role card a new chat starts from (the start page's „Rollenauswahl"). */
export interface RoleStart {
  /** null = the active role (the default role's card). */
  roleId: string | null;
  kind: 'input' | 'task' | 'file';
  text: string;
  send: boolean;
  instruction: string;
  /** The card's suggestions under the input field (an `input` card). */
  suggestions?: { questionsOn: boolean; questionMode: 'dynamic' | 'fixed'; dynamicCount: number; fixedQuestions: string[] };
}

interface RawChatMessage {
  id: string;
  createdAt?: string;
  parentMessageId?: string | null;
  role: 'user' | 'ai';
  content: string;
  sources?: string | MessageSource[];
  isEnhanced?: boolean;
  reasoning?: string;
  feedback?: 'positive' | 'negative' | null;
  verification?: MessageVerification | null;
  traceId?: string | null;
  structured_table?: StructuredTable | null;
  conflicts?: MessageConflict[];
  attachments?: MessageAttachment[];
  trajectory?: TrajectoryEvent[];
}

interface UseChatParams {
  currentKb: KnowledgeBase | null;
  files: FileEntry[];
  enhance: 'rewrite' | 'expand' | 'spell' | null;
  reasoningEnabled: boolean;
  /** `undefined` omits `webSearch` from the chat request (gate closed). */
  webSearchEnabled: boolean | undefined;
  reasoningLevel: 'low' | 'medium' | 'high';
  onResearchLoaded?: () => void;
  onAcademicResearchLoaded?: () => void;
}

export function useChat({
  currentKb, files, enhance,
  reasoningEnabled, webSearchEnabled, reasoningLevel,
  onResearchLoaded, onAcademicResearchLoaded,
}: UseChatParams) {
  const { language, t } = useTheme();

  const { showConfirm, showPrompt } = useModalContext();
  const toast = useToast();

  // Compose: message tree state and navigation
  const tree = useMessageTree();
  const {
    messageTree, setMessageTree, messageTreeRef,
    activeLeafId, setActiveLeafId, messages,
  } = tree;

  // Editing state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

  // Input state
  const [userMessageInput, setUserMessageInput] = useState('');

  // The role a NEW chat starts in (a role card on the start page). Sent
  // with the turn that opens the chat; the chat then carries it
  // (ChatEntry.roleId). Cleared by handleNewChat.
  const [pendingRoleId, setPendingRoleId] = useState<string | null>(null);
  // The role card the empty chat was started from („Rollenauswahl"): the
  // start page then gives way to the chat (or the card's upload area).
  const [roleStart, setRoleStart] = useState<RoleStart | null>(null);

  // Chat history state
  const [chats, setChats] = useState<ChatEntry[]>([]);
  const [activeChatId, setActiveChatIdState] = useState<string | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const setActiveChatId = useCallback((id: string | null) => {
    activeChatIdRef.current = id;
    setActiveChatIdState(id);
  }, []);

  // Research session loaded from history
  const [loadedResearchSession, setLoadedResearchSession] = useState<{
    id: string; goal: string; report: string; findings: { content: string; sources: { fileName: string; fileId: string; pages?: number[] }[]; relevanceScore: number }[];
  } | null>(null);

  // Academic research session loaded from history
  const [loadedAcademicSession, setLoadedAcademicSession] = useState<{
    id: string; goal: string; report: string;
    findings: { content: string; papers: { id: string; title: string; authors: string[]; year: number; url: string; harvardCitation: string }[]; relevanceScore: number }[];
    papers?: { id: string; title: string; authors: string[]; year: number; journal?: string; volume?: string; issue?: string; pages?: string; abstract?: string; doi?: string; url: string; pdfUrl?: string; citationCount?: number; harvardCitation: string }[];
  } | null>(null);

  const fetchChats = useCallback(async (kbId: string, signal?: AbortSignal) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/kb/${kbId}/chats`, { signal });
      setChats(res.data);
    } catch (err: unknown) {
      if (axios.isCancel(err)) return;
      console.error('Failed to fetch chats:', err);
      toast.error(t('chatListLoadError'));
    }
  }, [toast, t]);

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Changes in the same update that installs a loaded chat's messages, so the
  // transcript scroller remounts onto THOSE messages (its opening position is
  // applied once, on mount). Keying it on activeChatId instead would remount
  // it on the previous chat's rows, before the fetch returns.
  const [transcriptKey, setTranscriptKey] = useState(0);
  const pendingEditRef = useRef<string | null | undefined>(undefined);
  // The edited question's attachments: an edit is a new question that keeps
  // the files the original was asked about.
  const pendingEditAttachmentsRef = useRef<MessageAttachment[]>([]);
  const pendingFollowUpRef = useRef<string | null>(null);
  const fetchChatsTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const forkFocusTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chatSwitchingRef = useRef(false);

  // Compose: SSE streaming
  const stream = useChatStream({
    currentKb, files, enhance,
    reasoningEnabled, webSearchEnabled, reasoningLevel, language,
    setMessageTree, messageTreeRef, setActiveLeafId,
    activeChatIdRef, activeChatId, setActiveChatId, setChats,
    fetchChats, fetchChatsTimerRef,
    t,
  });
  const { loading, chatAbortRef } = stream;

  // Cleanup timers and abort in-flight SSE on unmount. The ref *objects* are
  // captured locally so the cleanup reads their latest .current at unmount
  // (the timers/abort controller are assigned after mount).
  useEffect(() => {
    const fetchChatsTimer = fetchChatsTimerRef;
    const forkFocusTimer = forkFocusTimerRef;
    const chatAbort = chatAbortRef;
    return () => {
      clearTimeout(fetchChatsTimer.current);
      clearTimeout(forkFocusTimer.current);
      chatAbort.current?.abort();
    };
  }, [chatAbortRef]);

  // Textarea height: sized by the design-system composer itself
  // (`field-sizing: content` in PromptInputAdaptiveTextarea, 22.09.2026) —
  // writing an explicit height here fought that and made the one-line /
  // multi-line switch flicker.

  /* Opening a chat — an old one or a new one — puts the caret in the prompt
     field, as chat apps do: the next thing a user does there is type, and a
     keyboard user would otherwise have to travel from the history to it. Only
     with a fine pointer (mouse, trackpad): on a touch screen focusing the
     field raises the on-screen keyboard over the chat just opened. After a
     frame, because the field of a chat that was not on screen is not mounted
     yet when the handler runs. */
  const focusPrompt = useCallback(() => {
    if (typeof window.matchMedia !== 'function' || !window.matchMedia('(pointer: fine)').matches) return;
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const handleSelectChat = useCallback(async (chat: ChatEntry) => {
    if (chat.type === 'research') {
      try {
        const res = await axios.get(`${API_BASE_URL}/api/chats/${chat.id}/messages`);
        const msgs = Array.isArray(res.data) ? res.data : [];
        const userMsg = msgs.find((m: RawChatMessage) => m.role === 'user');
        const aiMsg = msgs.find((m: RawChatMessage) => m.role === 'ai');
        const goal = userMsg?.content || '';
        const report = aiMsg?.content || '';
        type ResearchFinding = { content: string; sources: { fileName: string; fileId: string; pages?: number[] }[]; relevanceScore: number };
        let findings: ResearchFinding[] = [];
        try {
          findings = aiMsg?.sources ? (typeof aiMsg.sources === 'string' ? JSON.parse(aiMsg.sources) : aiMsg.sources) as ResearchFinding[] : [];
        } catch { findings = []; }
        setLoadedResearchSession({ id: chat.id, goal, report, findings });
        onResearchLoaded?.();
      } catch (err: unknown) {
        console.error('Failed to load research session:', err);
        toast.error(t('researchLoadError'));
      }
      return;
    }

    if (chat.type === 'academic_research') {
      try {
        const res = await axios.get(`${API_BASE_URL}/api/chats/${chat.id}/messages`);
        const msgs = Array.isArray(res.data) ? res.data : [];
        const userMsg = msgs.find((m: RawChatMessage) => m.role === 'user');
        const aiMsg = msgs.find((m: RawChatMessage) => m.role === 'ai');
        const goal = userMsg?.content || '';
        const report = aiMsg?.content || '';
        type SavedFinding = { content: string; sources: { fileName: string; fileId: string; url?: string }[]; relevanceScore: number };
        type AcademicPaperSaved = { id: string; title: string; authors: string[]; year: number; journal?: string; volume?: string; issue?: string; pages?: string; abstract?: string; doi?: string; url: string; pdfUrl?: string; citationCount?: number; harvardCitation: string };
        let savedFindings: SavedFinding[] = [];
        let savedPapers: AcademicPaperSaved[] = [];
        try {
          savedFindings = aiMsg?.sources ? (typeof aiMsg.sources === 'string' ? JSON.parse(aiMsg.sources) : aiMsg.sources) as SavedFinding[] : [];
        } catch { savedFindings = []; }
        // Papers are stored in the reasoning column as JSON
        try {
          savedPapers = aiMsg?.reasoning ? JSON.parse(aiMsg.reasoning) as AcademicPaperSaved[] : [];
        } catch { savedPapers = []; }
        // Convert saved Finding[] format back to AcademicFinding[] format
        const findings = savedFindings.map(f => ({
          content: f.content,
          relevanceScore: f.relevanceScore,
          papers: (f.sources || []).map(s => ({
            id: s.fileId,
            title: s.fileName,
            authors: [] as string[],
            year: 0,
            url: s.url || '',
            harvardCitation: s.fileName,
          })),
        }));
        setLoadedAcademicSession({ id: chat.id, goal, report, findings, papers: savedPapers });
        onAcademicResearchLoaded?.();
      } catch (err: unknown) {
        console.error('Failed to load academic research session:', err);
        toast.error(t('researchLoadError'));
      }
      return;
    }

    setActiveChatId(chat.id);
    chatSwitchingRef.current = true;
    focusPrompt();
    try {
      const res = await axios.get(`${API_BASE_URL}/api/chats/${chat.id}/messages`);
      const rawMessages: Message[] = (res.data as RawChatMessage[]).map((m) => ({
        id: m.id,
        createdAt: m.createdAt,
        parentMessageId: m.parentMessageId || undefined,
        role: m.role,
        content: m.content,
        sources: typeof m.sources === 'string' ? (() => { try { return JSON.parse(m.sources as string); } catch { return []; } })() : m.sources,
        isEnhanced: m.isEnhanced,
        reasoning: m.reasoning,
        feedback: m.feedback,
        verification: m.verification ?? null,
        traceId: m.traceId ?? null,
        structured_table: m.structured_table ?? null,
        conflicts: m.conflicts,
        ...(m.trajectory?.length ? { trajectory: m.trajectory } : {}),
        ...(m.attachments?.length ? { attachments: m.attachments } : {}),
      }));
      const newTree = buildMessageMap(rawMessages);
      setMessageTree(newTree);
      setTranscriptKey(k => k + 1);
      setActiveLeafId(findDefaultLeaf(newTree));
    } catch (err: unknown) {
      console.error('Failed to load chat messages:', err);
      toast.error(t('chatLoadError'));
    } finally {
      chatSwitchingRef.current = false;
    }
  }, [onResearchLoaded, onAcademicResearchLoaded, setActiveChatId, setMessageTree, setActiveLeafId, toast, t, focusPrompt]);

  const handleNewChat = useCallback(() => {
    setActiveChatId(null);
    setPendingRoleId(null);
    setRoleStart(null);
    setMessageTree(new Map());
    setActiveLeafId(null);
    setEditingMessageId(null);
    setLoadedResearchSession(null);
    setLoadedAcademicSession(null);
    focusPrompt();
  }, [setActiveChatId, setMessageTree, setActiveLeafId, focusPrompt]);

  const handleDeleteChat = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!await showConfirm(t('confirmDeleteChat'), undefined, { tone: 'destructive', confirmLabel: t('delete') })) return;
    let snapshot: ChatEntry[] = [];
    setChats(prev => { snapshot = prev; return prev.filter(c => c.id !== id); });
    if (activeChatIdRef.current === id) {
      handleNewChat();
    }
    try {
      await axios.delete(`${API_BASE_URL}/api/chats/${id}`);
    } catch {
      setChats(snapshot);
      toast.error(t('deleteChatError'));
    }
  }, [handleNewChat, showConfirm, t, toast]);

  // Batch delete from the history selection mode: one confirmation, optimistic
  // removal, and only the chats whose DELETE failed come back.
  const handleDeleteChats = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return false;
    if (!await showConfirm(t('confirmDeleteChats').replace('{count}', String(ids.length)), undefined, { tone: 'destructive', confirmLabel: t('delete') })) return false;
    let snapshot: ChatEntry[] = [];
    setChats(prev => { snapshot = prev; return prev.filter(c => !ids.includes(c.id)); });
    if (activeChatIdRef.current && ids.includes(activeChatIdRef.current)) handleNewChat();
    const results = await Promise.allSettled(ids.map(id => axios.delete(`${API_BASE_URL}/api/chats/${id}`)));
    const failed = new Set(ids.filter((_, i) => results[i].status === 'rejected'));
    if (failed.size > 0) {
      setChats(prev => [...prev, ...snapshot.filter(c => failed.has(c.id))]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      toast.error(t('deleteChatError'));
    }
    return true;
  }, [handleNewChat, showConfirm, t, toast]);

  // Rename from the history list: prompt with the current title, optimistic
  // update, roll back on a failed PATCH.
  const handleRenameChat = useCallback(async (id: string, currentTitle: string) => {
    const next = await showPrompt(t('renameChatPrompt'), currentTitle, t('renameChat'));
    if (next === null) return;
    const title = next.trim();
    if (!title || title === currentTitle) return;
    let snapshot: ChatEntry[] = [];
    setChats(prev => { snapshot = prev; return prev.map(c => c.id === id ? { ...c, title } : c); });
    try {
      await axios.patch(`${API_BASE_URL}/api/chats/${id}`, { title });
    } catch {
      setChats(snapshot);
      toast.error(t('renameChatError'));
    }
  }, [showPrompt, t, toast]);

  // Orchestrating send: clears input, resets UI state, delegates to stream
  // hook. `attachments` are files already on the server: the composer's
  // uploads (useComposerUploads) or an edited question's attachments. Resolves to whether the turn was sent, so the
  // composer keeps its files when it was not (PromptInput clears them only
  // after a send that did not throw).
  // `text` replaces the input field's text (the upload start's first message).
  const handleSendMessage = useCallback(async (e: React.FormEvent | React.KeyboardEvent, editParentId?: string | null, attachments: MessageAttachment[] = [], text?: string): Promise<boolean> => {
    e.preventDefault();
    if (!currentKb || loading || chatSwitchingRef.current) return false;

    const userMessage = (text ?? userMessageInput).trim();
    if (!userMessage) return false;

    // Guard: require a sendable source selection before clearing input
    // (at least one selected file — unless the caller may not select at all).
    if (!chatSourceSelection(currentKb, files).canSend) return false;

    const sendOpts = {
      ...(attachments.length > 0 ? { attachmentIds: attachments.map(a => a.userFileId), attachments } : {}),
      ...(pendingRoleId ? { roleId: pendingRoleId } : {}),
    };

    setUserMessageInput('');
    setEditingMessageId(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Delegate actual streaming to useChatStream. A turn the server refused
    // (e.g. the attachments together exceed the budget) reports false, so the
    // composer keeps its attachments for a retry.
    // Resolves as soon as the server accepted the turn, not when the answer
    // has finished streaming: the composer clears its attachments on that.
    return new Promise<boolean>(resolve => {
      Promise.resolve(stream.handleSendMessage(e, userMessage, activeLeafId, editParentId, { ...sendOpts, onAccepted: () => resolve(true) }))
        .then(accepted => {
          // The question was not stored: give the user their text back too.
          if (!accepted && text === undefined) setUserMessageInput(prev => prev || userMessage);
          resolve(accepted);
        }, () => resolve(false));
    });
  }, [userMessageInput, currentKb, loading, files, activeLeafId, stream, pendingRoleId]);

  /**
   * A role card on the start page: a NEW chat in `start.roleId` (null = the
   * active role, the card of the default role). An instruction sent at once
   * goes out here; a prefilled one waits in the input field; the input-field
   * and file cards leave the start to the user (ChatView shows the card's
   * upload area for `kind: 'file'`). The role travels with the first turn.
   */
  const startRoleChat = useCallback((start: RoleStart) => {
    if (!currentKb || loading) return;
    handleNewChat();
    setPendingRoleId(start.roleId);
    setRoleStart(start);
    const text = start.kind === 'task' ? start.text.trim() : '';
    if (!text || !start.send || !chatSourceSelection(currentKb, files).canSend) {
      setUserMessageInput(text);
      if (start.kind !== 'file') requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
    const e = { preventDefault: () => undefined } as unknown as React.FormEvent;
    void Promise.resolve(stream.handleSendMessage(e, text, null, null, start.roleId ? { roleId: start.roleId } : {})).then(accepted => {
      if (!accepted) setUserMessageInput(prev => prev || text);
    });
  }, [currentKb, loading, files, handleNewChat, stream]);

  // The role of the chat on screen: the open chat's, or the pending one of a new chat.
  const chatRoleId = activeChatId ? (chats.find(c => c.id === activeChatId)?.roleId ?? null) : pendingRoleId;

  const handleStartEdit = useCallback((messageId: string) => {
    setEditingMessageId(messageId);
  }, []);

  const handleEditSubmit = useCallback((messageId: string, newContent: string) => {
    const msg = messageTreeRef.current.get(messageId);
    if (!msg) return;
    const parentId = msg.parentMessageId;
    setEditingMessageId(null);
    setUserMessageInput(newContent);
    pendingEditRef.current = parentId || null;
    pendingEditAttachmentsRef.current = msg.attachments ?? [];
  }, [messageTreeRef]);

  /**
   * Every way of taking a conversation elsewhere opens a NEW chat (POST
   * /api/chats/{id}/branch), which joins the history with the branch icon and
   * opens; the original chat stays as it was:
   *  - „Verzweigen" on an answer — branched at that answer, ready for a
   *    different follow-up;
   *  - „Antwort neu generieren" — branched at the question, which the branch
   *    then answers (handleRegenerate);
   *  - editing a question — branched at the turn before it (an empty branch
   *    for the first question), where the edit is then sent (the pending-edit
   *    effect below).
   * Resolves to the id of the copied message (undefined for an empty branch),
   * or null when branching failed (a toast says so).
   */
  const openBranch = useCallback(async (messageId: string | null): Promise<string | undefined | null> => {
    const chatId = activeChatIdRef.current;
    if (!chatId || (messageId && isTempMessageId(messageId))) return null;
    try {
      const res = await axios.post(`${API_BASE_URL}/api/chats/${chatId}/branch`, messageId ? { messageId } : {});
      const { copiedMessageId, ...branch } = res.data as ChatEntry & { copiedMessageId?: string };
      setChats(prev => [branch, ...prev.filter(c => c.id !== branch.id)]);
      await handleSelectChat(branch);
      return copiedMessageId;
    } catch (err: unknown) {
      console.error('Failed to branch chat:', err);
      toast.error(t('chatBranchFailed'));
      return null;
    }
  }, [activeChatIdRef, handleSelectChat, toast, t]);

  const handleForkFromMessage = useCallback(async (messageId: string) => {
    if (await openBranch(messageId) === null) return;
    forkFocusTimerRef.current = setTimeout(() => textareaRef.current?.focus(), 50);
  }, [openBranch]);

  /**
   * "Antwort neu generieren" — a second answer under the SAME question.
   *
   * This deliberately does NOT go through the composer: re-typing the
   * question and re-sending it made the backend persist a second copy of it.
   * The new answer goes into a branch chat instead (openBranch), so a chat
   * never holds two versions of a turn.
   */
  const handleRegenerate = useCallback(async (aiMessageId: string) => {
    if (chatSwitchingRef.current) return;

    const aiMsg = messageTreeRef.current.get(aiMessageId);
    if (!aiMsg || aiMsg.role !== 'ai' || isTempMessageId(aiMessageId)) return;

    // An enhanced turn carries a display-only "✨ …" node between question and
    // answer, so the answer's parent is not always the persisted question.
    const userMessageId = nearestPersistedAncestorId(messageTreeRef.current, aiMsg.parentMessageId);
    if (!userMessageId) return;
    const userMsg = messageTreeRef.current.get(userMessageId);
    if (!userMsg || userMsg.role !== 'user') return;

    // A new answer is a new branch: copy the chat up to the question, then
    // have the branch answer its copy of it (regenerateOfMessageId naming
    // the question). The original keeps its answer untouched.
    const question = await openBranch(userMessageId);
    if (!question) return;
    await stream.handleSendMessage(
      { preventDefault: () => {} } as React.FormEvent,
      userMsg.content,
      question,
      undefined,
      { regenerateOf: { aiMessageId: question, userMessageId: question } },
    );
  }, [messageTreeRef, stream, openBranch]);

  const handleFollowUpClick = useCallback((question: string) => {
    pendingFollowUpRef.current = question;
    setUserMessageInput(question);
  }, []);

  const handleFeedback = useCallback(async (messageId: string, feedback: 'positive' | 'negative' | null, comment?: string) => {
    if (!currentKb || !activeChatIdRef.current) return;
    try {
      await axios.post(`${API_BASE_URL}/api/kb/${currentKb.id}/chats/${activeChatIdRef.current}/messages/${messageId}/feedback`,
        { feedback, ...(comment !== undefined ? { comment } : {}) }
      );
      // Update local message tree
      setMessageTree(prev => {
        const updated = new Map(prev);
        const msg = updated.get(messageId);
        if (msg) {
          updated.set(messageId, { ...msg, feedback, feedbackComment: comment });
        }
        return updated;
      });
    } catch (error: unknown) {
      console.error('Failed to submit feedback', error);
      toast.error(t('feedbackError'));
    }
  }, [currentKb, setMessageTree, t, toast]);

  // Auto-trigger for pending edits and follow-ups
  useEffect(() => {
    if (pendingFollowUpRef.current && userMessageInput === pendingFollowUpRef.current) {
      pendingFollowUpRef.current = null;
      const syntheticEvent = { preventDefault: () => { } } as React.FormEvent;
      handleSendMessage(syntheticEvent);
    } else if (pendingEditRef.current !== undefined && userMessageInput) {
      const parentId = pendingEditRef.current;
      const attachments = pendingEditAttachmentsRef.current;
      pendingEditRef.current = undefined;
      pendingEditAttachmentsRef.current = [];
      const syntheticEvent = { preventDefault: () => { } } as React.FormEvent;
      // An edited question is a new branch: copy the chat up to the turn
      // before it (an empty branch for the first question) and send the
      // edit there. `null` is passed through, not collapsed to undefined:
      // the first question has no parent, and "no parent" must not be read
      // as "no opinion" — that fell back to the active leaf and appended the
      // edited question to the answer it was replacing.
      void (async () => {
        const copied = await openBranch(parentId);
        if (copied === null) return;
        await handleSendMessage(syntheticEvent, copied ?? null, attachments);
      })();
    }
  }, [userMessageInput, handleSendMessage, openBranch]);

  return useMemo(() => ({
    // Message tree
    messageTree,
    setMessageTree,
    activeLeafId,
    setActiveLeafId,
    messages,
    // Editing
    editingMessageId,
    setEditingMessageId,
    // Fork
    // Input
    userMessageInput,
    setUserMessageInput,
    loading,
    // Chat history
    chats,
    setChats,
    activeChatId,
    setActiveChatId,
    // Research
    loadedResearchSession,
    setLoadedResearchSession,
    // Academic Research
    loadedAcademicSession,
    setLoadedAcademicSession,
    // Refs
    textareaRef,
    transcriptKey,
    // Handlers
    handleSelectChat,
    handleNewChat,
    handleDeleteChat,
    handleRenameChat,
    handleDeleteChats,
    handleSendMessage,
    handleStartEdit,
    handleEditSubmit,
    handleForkFromMessage,
    handleRegenerate,
    handleFollowUpClick,
    handleFeedback,
    fetchChats,
    // Roles
    chatRoleId,
    roleStart,
    startRoleChat,
  }), [
    chatRoleId,
    roleStart,
    startRoleChat,
    messageTree,
    setMessageTree,
    activeLeafId,
    setActiveLeafId,
    messages,
    setActiveChatId,
    editingMessageId,
    userMessageInput,
    loading,
    chats,
    activeChatId,
    loadedResearchSession,
    loadedAcademicSession,
    transcriptKey,
    handleSelectChat,
    handleNewChat,
    handleDeleteChat,
    handleRenameChat,
    handleDeleteChats,
    handleSendMessage,
    handleStartEdit,
    handleEditSubmit,
    handleForkFromMessage,
    handleRegenerate,
    handleFollowUpClick,
    handleFeedback,
    fetchChats,
  ]);
}
