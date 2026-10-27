import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useState } from 'react';
import axios from 'axios';
import { useChat, buildComparisonSend } from './useChat';
import type { KnowledgeBase, FileEntry, ChatEntry } from '../types';
import type { ChatAttachment } from './useChatAttachment';

// handleSelectChat's reload path (GET /api/chats/:id/messages) and the branch
// call (POST /api/chats/:id/branch, which regenerate/edit/fork make before
// they send) are the only places in this file that touch axios directly —
// everything else goes through the mocked useChatStream/useChatAttachment
// sub-hooks below.
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

// No pre-existing test harness for useChat (checked: `ls hooks/*.test.ts*`
// before writing this file — no `useChat.test.ts`/`.tsx` in the repo). The
// hook pulls in ThemeContext/ModalContext/ToastContext plus the useChatStream
// and useChatAttachment sub-hooks, so a *minimal* harness is built here
// (mirrors the vi.mock pattern already used in useKnowledgeBases.test.ts /
// useKbRemoval.test.ts) rather than skipping hook-level coverage entirely.
//
// Fix round 1: the selection now travels through `opts.agentSelection` on
// the outgoing send, NOT (only) through `setAgentSelection` state —
// `useChatStream.handleSendMessage` builds its request synchronously from a
// closure captured before any `setAgentSelection` call can take effect, so
// the state write alone silently sent the *previous* selection for the
// comparison turn itself. `setAgentSelection` is still called too, but only
// to make the choice stick for FOLLOW-UP turns in the new chat — see the
// comment on that call in `useChat.ts`. The test below asserts on the send,
// not just the state write, because the state-write-only assertion is
// exactly what let the original (wrong) fix pass its own test.
//
// `buildComparisonSend` (below) still gets its own pure-function tests: it's
// the one piece of `startComparison`'s logic dense enough to be worth testing
// in isolation from the hook plumbing.

const setAgentSelection = vi.fn();
const streamSend = vi.fn();
const uploadMock = vi.fn();
const clearMock = vi.fn();
const adoptMock = vi.fn();
const toastError = vi.fn();
// A real ref-like object (not a vi.fn()) — `startComparison` reads
// `errorRef.current` synchronously right after `await upload()` resolves.
// See useChatAttachment.ts's doc comment on why `error` state can't do this.
const attachmentErrorRef: { current: string | null } = { current: null };

vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({ language: 'de', t: (key: string) => key }),
}));
vi.mock('../contexts/ModalContext', () => ({
  useModalContext: () => ({ showConfirm: vi.fn() }),
}));
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: toastError, warning: vi.fn(), info: vi.fn() }),
}));
vi.mock('./useChatStream', () => ({
  useChatStream: () => ({
    loading: false,
    handleSendMessage: streamSend,
    cancelStream: vi.fn(),
    chatAbortRef: { current: null },
  }),
}));
// Backs `attachment` with real React state (like `useChatAttachment` itself
// does), not a bare vi.fn() return — the follow-up-send test below needs
// `adopt`'s write to actually be visible to the NEXT `handleSendMessage`
// call, which a static mock object can't provide.
vi.mock('./useChatAttachment', () => ({
  useChatAttachment: () => {
    const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
    const upload = async (file: File) => {
      const result = await uploadMock(file);
      if (result) setAttachment(result);
      return result;
    };
    const clear = () => {
      clearMock();
      setAttachment(null);
    };
    const adopt = (att: ChatAttachment) => {
      adoptMock(att);
      setAttachment(att);
    };
    return {
      attachment,
      uploading: false,
      error: null,
      errorRef: attachmentErrorRef,
      upload,
      clear,
      adopt,
    };
  },
}));

const kb = { id: 'kb1', name: 'Handbuch' } as KnowledgeBase;

// One selected file by default: handleSendMessage's own
// "at least one selected file" guard would otherwise block every send,
// including the follow-up-send test below, which sends through
// handleSendMessage (not startComparison, which has no such guard).
function renderUseChat(files: FileEntry[] = [{ id: 'f1', selected: true } as FileEntry]) {
  return renderHook(() => useChat({
    currentKb: kb,
    files,
    enhance: null,
    reasoningEnabled: false,
    webSearchEnabled: false,
    reasoningLevel: 'low',
    agentSelection: {},
    setAgentSelection,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  attachmentErrorRef.current = null;
});

describe('useChat.startComparison', () => {
  it('wendet die im Dialog gewählte Agent-/Team-Auswahl an und sendet Anhang plus Modi', async () => {
    uploadMock.mockResolvedValueOnce({ attachmentId: 'att1', filename: 'entwurf.docx', sectionCount: 3, charCount: 120 });
    const { result } = renderUseChat();

    await act(async () => {
      await result.current.startComparison({
        file: new File(['x'], 'entwurf.docx'),
        modes: ['contradiction'],
        instruction: 'Fasse die Abweichungen zusammen.',
        agentSelection: { teamId: 't1' },
      });
    });

    // Fix round 1: the FIRST fix (setAgentSelection alone) shipped a test that
    // only asserted setAgentSelection was called — that would have passed
    // against the broken version too, since setAgentSelection was always
    // called; it just didn't affect *this* request. The real guard is on the
    // outgoing send: `streamSend`'s opts must carry the selection, because
    // `useChatStream` reads it from `opts.agentSelection` (falling back to
    // its own closure state) to build the request that goes out THIS turn.
    expect(streamSend).toHaveBeenCalledWith(
      expect.anything(),
      'Fasse die Abweichungen zusammen.',
      null,
      undefined,
      expect.objectContaining({
        attachmentId: 'att1',
        comparisonModes: ['contradiction'],
        agentSelection: { teamId: 't1' },
      }),
    );
    // Still expected — this is the SEPARATE write that makes the choice
    // stick for follow-up questions in the chat handleNewChat() just
    // created, not the one that governs this turn's own request.
    expect(setAgentSelection).toHaveBeenCalledWith({ teamId: 't1' });
  });

  it('sendet nicht und wendet keine Agent-Auswahl an, wenn der Upload fehlschlägt', async () => {
    uploadMock.mockResolvedValueOnce(null);
    const { result } = renderUseChat();

    await act(async () => {
      await result.current.startComparison({
        file: new File(['x'], 'zu-gross.docx'),
        modes: ['contradiction'],
        instruction: 'x',
        agentSelection: { teamId: 't1' },
      });
    });

    expect(streamSend).not.toHaveBeenCalled();
    expect(setAgentSelection).not.toHaveBeenCalled();
  });

  // Fix wave item 3: before this fix, a failed upload closed the dialog and
  // switched to Chat with zero user-visible feedback — attachmentState.error
  // had no consumer. Now startComparison must (a) surface the error via a
  // toast and (b) report failure back to the caller so the Workspace dialog
  // stays open instead of closing on a silent failure.
  it('zeigt einen Toast mit der Upload-Fehlermeldung und meldet false zurück', async () => {
    uploadMock.mockImplementationOnce(async () => {
      attachmentErrorRef.current = 'Datei zu groß';
      return null;
    });
    const { result } = renderUseChat();

    let started: boolean | undefined;
    await act(async () => {
      started = await result.current.startComparison({
        file: new File(['x'], 'zu-gross.docx'),
        modes: ['contradiction'],
        instruction: 'x',
        agentSelection: { teamId: 't1' },
      });
    });

    expect(started).toBe(false);
    expect(toastError).toHaveBeenCalledWith('Datei zu groß');
    expect(streamSend).not.toHaveBeenCalled();
  });

  it('meldet true zurück, wenn der Vergleich tatsächlich gestartet wurde', async () => {
    uploadMock.mockResolvedValueOnce({ attachmentId: 'att1', filename: 'x.docx', sectionCount: 1, charCount: 10 });
    const { result } = renderUseChat();

    let started: boolean | undefined;
    await act(async () => {
      started = await result.current.startComparison({
        file: new File(['x'], 'x.docx'),
        modes: ['contradiction'],
        instruction: 'x',
        agentSelection: {},
      });
    });

    expect(started).toBe(true);
  });

  // Regression fix: pre-rework (78c1a2c), handleSendMessage deliberately kept
  // the attachment after a comparison send ("keep the attachment until the
  // user removes it") so follow-up turns still carried attachmentId. This
  // branch's startComparison called handleNewChat() (clears the attachment,
  // needed so it can't leak from the PREVIOUS chat) AFTER uploading, which
  // silently wiped it for the NEW chat too — every follow-up question about
  // the uploaded document went out with no attachmentId, and the backend's
  // buildFollowUpContext injection never fired. Fixed via
  // attachmentState.adopt(uploaded) right after handleNewChat().
  it('behält den Anhang nach dem Vergleich (nicht null)', async () => {
    uploadMock.mockResolvedValueOnce({ attachmentId: 'att1', filename: 'x.docx', sectionCount: 1, charCount: 10 });
    const { result } = renderUseChat();

    await act(async () => {
      await result.current.startComparison({
        file: new File(['x'], 'x.docx'),
        modes: ['contradiction'],
        instruction: 'x',
        agentSelection: {},
      });
    });

    expect(result.current.attachment).toEqual({ attachmentId: 'att1', filename: 'x.docx', sectionCount: 1, charCount: 10 });
  });

  // This is the test that actually encodes the spec's promise: it asserts on
  // the outgoing SEND of a follow-up turn, not just on hook state — hook
  // state alone could be right while the send still omits attachmentId (that
  // was exactly the bug: `attachmentState.attachment` becomes non-null again
  // via adopt, but only a real follow-up send proves it is actually used).
  it('ein Folge-Turn nach dem Vergleich sendet weiterhin die attachmentId', async () => {
    uploadMock.mockResolvedValueOnce({ attachmentId: 'att1', filename: 'x.docx', sectionCount: 1, charCount: 10 });
    const { result } = renderUseChat();

    await act(async () => {
      await result.current.startComparison({
        file: new File(['x'], 'x.docx'),
        modes: ['contradiction'],
        instruction: 'x',
        agentSelection: {},
      });
    });

    streamSend.mockClear();
    act(() => {
      result.current.setUserMessageInput('Und was sagt Richtlinie 4 dazu?');
    });
    await act(async () => {
      await result.current.handleSendMessage({ preventDefault: () => {} } as React.FormEvent);
    });

    expect(streamSend).toHaveBeenCalledWith(
      expect.anything(),
      'Und was sagt Richtlinie 4 dazu?',
      null,
      undefined,
      expect.objectContaining({ attachmentId: 'att1' }),
    );
  });
});

/**
 * Every branch is a new chat: regenerate, edit and fork first POST
 * /api/chats/{active}/branch (`{messageId}` to copy the chat up to that
 * message, `{}` for an empty branch), add and select the returned chat (whose
 * messages handleSelectChat then GETs), and only then send — in the branch.
 * The response is a ChatRow plus `copiedMessageId`, the branch's copy of the
 * message named in the request. This mocks that round trip with hand-picked
 * ids so the assertions below can tell the original's ids from the copy's.
 */
const ORIGINAL_CHAT = 'chat-original';
const BRANCH_CHAT = 'chat-branch';
function mockBranch(copiedMessageId: string | undefined, branchMessages: unknown[]) {
  mockedAxios.post.mockResolvedValueOnce({
    data: {
      id: BRANCH_CHAT, kbId: 'kb1', userId: 'u1', title: 'Chat', type: 'chat',
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
      ...(copiedMessageId ? { copiedMessageId } : {}),
    },
  });
  mockedAxios.get.mockResolvedValueOnce({ data: branchMessages });
}

// A regenerate must not travel through the composer. The old implementation
// typed the question back into the input and re-sent it, which persisted a
// second copy of the user's prompt — visible as the same question twice in
// one thread whenever the turn was the first of the chat.
describe('useChat.handleRegenerate', () => {
  const U1 = '11111111-1111-4111-8111-111111111111';
  const A1 = '22222222-2222-4222-8222-222222222222';
  // The branch's copy of U1 (copiedMessageId).
  const U1_COPY = '33333333-3333-4333-8333-333333333333';

  function withAnsweredTurn(result: { current: ReturnType<typeof useChat> }) {
    act(() => {
      result.current.setActiveChatId(ORIGINAL_CHAT);
      result.current.setMessageTree(new Map([
        [U1, { id: U1, role: 'user', content: 'Wie funktioniert X?', childIds: [A1] }],
        [A1, { id: A1, role: 'ai', content: 'Antwort 1', parentMessageId: U1, childIds: [] }],
      ]));
      result.current.setActiveLeafId(A1);
    });
  }

  // A new answer is a new branch: the chat is copied up to the question, and
  // the branch then answers ITS copy of the question — so every id in the
  // send is the copy's (U1_COPY), never the original's. The original chat
  // keeps its answer untouched.
  it('sendet die gespeicherte Frage als Regeneration der genannten Antwort', async () => {
    const { result } = renderUseChat();
    withAnsweredTurn(result);
    mockBranch(U1_COPY, [{ id: U1_COPY, role: 'user', content: 'Wie funktioniert X?' }]);

    await act(async () => {
      await result.current.handleRegenerate(A1);
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(expect.stringContaining(`/api/chats/${ORIGINAL_CHAT}/branch`), { messageId: U1 });
    expect(result.current.activeChatId).toBe(BRANCH_CHAT);
    expect(result.current.chats.map(c => c.id)).toContain(BRANCH_CHAT);

    expect(streamSend).toHaveBeenCalledTimes(1);
    const [, message, leafId, editParentId, opts] = streamSend.mock.calls[0];
    expect(message).toBe('Wie funktioniert X?');
    expect(leafId).toBe(U1_COPY);
    expect(opts).toEqual(expect.objectContaining({
      regenerateOf: { aiMessageId: U1_COPY, userMessageId: U1_COPY },
    }));
    expect(editParentId).toBeUndefined();
  });

  it('sendet nichts, wenn das Verzweigen scheitert', async () => {
    const { result } = renderUseChat();
    withAnsweredTurn(result);
    mockedAxios.post.mockRejectedValueOnce(new Error('500'));

    await act(async () => {
      await result.current.handleRegenerate(A1);
    });

    expect(streamSend).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('chatBranchFailed');
    expect(result.current.activeChatId).toBe(ORIGINAL_CHAT);
  });

  // The old implementation typed the question into the composer and let the
  // send effect pick it up. When the send was refused — here: no file
  // selected — the question stayed behind in the input box as if the user had
  // typed it. Asserting on an *unblocked* send would not catch that, since
  // handleSendMessage clears the input on its way out either way.
  it('hinterlässt die Frage nicht im Eingabefeld, wenn der Turn abgelehnt wird', async () => {
    const { result } = renderUseChat([{ id: 'f1', selected: false } as FileEntry]);
    withAnsweredTurn(result);

    await act(async () => {
      await result.current.handleRegenerate(A1);
    });

    expect(result.current.userMessageInput).toBe('');
  });

  // An enhanced turn renders the rewritten query as a display-only "✨" bubble
  // between question and answer, so the answer's local parent is a
  // `temp-enhanced-*` id. The server never returns that node (it stores
  // `is_enhanced` on the question row instead), so no reload reproduces it —
  // the regenerate has to hop over it to the persisted question.
  it('überspringt den Anzeige-Knoten eines Enhance-Turns', async () => {
    const { result } = renderUseChat();
    mockBranch(U1_COPY, [{ id: U1_COPY, role: 'user', content: 'Wie funktioniert X?' }]);
    act(() => {
      result.current.setActiveChatId(ORIGINAL_CHAT);
      result.current.setMessageTree(new Map([
        [U1, { id: U1, role: 'user', content: 'Wie funktioniert X?', childIds: ['temp-enhanced-1'] }],
        ['temp-enhanced-1', { id: 'temp-enhanced-1', role: 'user', content: '✨ Wie funktioniert X genau?', isEnhanced: true, parentMessageId: U1, childIds: [A1] }],
        [A1, { id: A1, role: 'ai', content: 'Antwort 1', parentMessageId: 'temp-enhanced-1', childIds: [] }],
      ]));
      result.current.setActiveLeafId(A1);
    });

    await act(async () => {
      await result.current.handleRegenerate(A1);
    });

    // The branch is cut at the persisted question U1, not at the display node.
    expect(mockedAxios.post).toHaveBeenCalledWith(expect.stringContaining('/branch'), { messageId: U1 });
    expect(streamSend).toHaveBeenCalledTimes(1);
    const [, message, , , opts] = streamSend.mock.calls[0];
    expect(opts.regenerateOf.userMessageId).toBe(U1_COPY);
    expect(message).toBe('Wie funktioniert X?');
  });

  it('sendet nichts für eine noch nicht gespeicherte Antwort', async () => {
    const { result } = renderUseChat();
    act(() => {
      result.current.setActiveChatId(ORIGINAL_CHAT);
      result.current.setMessageTree(new Map([
        ['temp-user-1', { id: 'temp-user-1', role: 'user', content: 'Frage', childIds: ['temp-ai-1'] }],
        ['temp-ai-1', { id: 'temp-ai-1', role: 'ai', content: 'Antwort', parentMessageId: 'temp-user-1', childIds: [] }],
      ]));
      result.current.setActiveLeafId('temp-ai-1');
    });

    await act(async () => {
      await result.current.handleRegenerate('temp-ai-1');
    });

    // Posting a temp id would hit the uuid `messages` columns (SQLSTATE
    // 22P02) and drop the whole conversation history — neither the branch
    // call nor the send may carry it.
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(streamSend).not.toHaveBeenCalled();
  });
});

// Editing the FIRST question of a chat produces a parent of `null` — "this is
// the root" — which must reach useChatStream as null, not be flattened to
// undefined. Flattened, it fell through to the active leaf and appended the
// edited question to the answer it was replacing.
//
// An edit is also a new branch: the chat is copied up to the turn before the
// edited question — for the first question that is an EMPTY branch (POST
// `{}`, no copiedMessageId) — and the edit is sent there.
describe('useChat.handleEditSubmit', () => {
  const U1 = '11111111-1111-4111-8111-111111111111';
  const A0 = '44444444-4444-4444-8444-444444444444';
  const A0_COPY = '55555555-5555-4555-8555-555555555555';

  it('gibt für die erste Frage eines Chats null als Parent weiter', async () => {
    const { result } = renderUseChat();
    mockBranch(undefined, []);
    act(() => {
      result.current.setActiveChatId(ORIGINAL_CHAT);
      result.current.setMessageTree(new Map([
        [U1, { id: U1, role: 'user', content: 'Alte Frage', childIds: [] }],
      ]));
      result.current.setActiveLeafId(U1);
    });

    await act(async () => {
      result.current.handleEditSubmit(U1, 'Neu formulierte Frage');
    });

    await waitFor(() => expect(streamSend).toHaveBeenCalledTimes(1));
    expect(mockedAxios.post).toHaveBeenCalledWith(expect.stringContaining(`/api/chats/${ORIGINAL_CHAT}/branch`), {});
    expect(result.current.activeChatId).toBe(BRANCH_CHAT);
    const [, message, , editParentId] = streamSend.mock.calls[0];
    expect(message).toBe('Neu formulierte Frage');
    expect(editParentId).toBeNull();
  });

  // A later question: the branch copies the chat up to the answer before it,
  // and the edit hangs under the branch's COPY of that answer.
  it('hängt eine spätere Frage an die Kopie der vorigen Antwort im neuen Zweig', async () => {
    const { result } = renderUseChat();
    mockBranch(A0_COPY, [{ id: A0_COPY, role: 'ai', content: 'Antwort 0' }]);
    act(() => {
      result.current.setActiveChatId(ORIGINAL_CHAT);
      result.current.setMessageTree(new Map([
        [A0, { id: A0, role: 'ai', content: 'Antwort 0', childIds: [U1] }],
        [U1, { id: U1, role: 'user', content: 'Alte Frage', parentMessageId: A0, childIds: [] }],
      ]));
      result.current.setActiveLeafId(U1);
    });

    await act(async () => {
      result.current.handleEditSubmit(U1, 'Neu formulierte Frage');
    });

    await waitFor(() => expect(streamSend).toHaveBeenCalledTimes(1));
    expect(mockedAxios.post).toHaveBeenCalledWith(expect.stringContaining('/branch'), { messageId: A0 });
    const [, , , editParentId] = streamSend.mock.calls[0];
    expect(editParentId).toBe(A0_COPY);
  });

  // Oracle: the send resolves when the server accepted the turn, not when
  // the answer has finished streaming — PromptInput clears its attachment
  // chips on that resolution.
  it('meldet die Annahme, bevor die Antwort fertig gestreamt ist', async () => {
    const { result } = renderUseChat();
    streamSend.mockImplementationOnce((_e: unknown, _m: unknown, _l: unknown, _p: unknown, opts?: { onAccepted?: () => void }) => {
      opts?.onAccepted?.();
      return new Promise(() => {}); // the answer never finishes in this test
    });
    act(() => {
      result.current.setUserMessageInput('Frage');
    });
    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.handleSendMessage({ preventDefault: () => {} } as React.FormEvent);
    });
    expect(sent).toBe(true);
  });

  // Oracle: an edit is a new question about the same files — the original's
  // attachments go with it, as ids for the request and chips for the bubble.
  it('nimmt die Anhänge der bearbeiteten Frage mit', async () => {
    const { result } = renderUseChat();
    const attachments = [{ userFileId: 'uf-1', name: 'ordnung.pdf', mime: 'application/pdf', size: 3 }];
    mockBranch(undefined, []);
    act(() => {
      result.current.setActiveChatId(ORIGINAL_CHAT);
      result.current.setMessageTree(new Map([
        [U1, { id: U1, role: 'user', content: 'Alte Frage', childIds: [], attachments }],
      ]));
      result.current.setActiveLeafId(U1);
    });

    await act(async () => {
      result.current.handleEditSubmit(U1, 'Neu formulierte Frage');
    });

    await waitFor(() => expect(streamSend).toHaveBeenCalledTimes(1));
    const [, , , , opts] = streamSend.mock.calls[0];
    expect(opts).toMatchObject({ attachmentIds: ['uf-1'], attachments });
  });
});

// „Verzweigen" on an answer opens a branch cut at that answer, ready for a
// different follow-up — it sends nothing by itself.
describe('useChat.handleForkFromMessage', () => {
  const A1 = '22222222-2222-4222-8222-222222222222';

  it('öffnet einen neuen Chat ab der Antwort, ohne etwas zu senden', async () => {
    const { result } = renderUseChat();
    mockBranch('66666666-6666-4666-8666-666666666666', [{ id: '66666666-6666-4666-8666-666666666666', role: 'ai', content: 'Antwort 1' }]);
    act(() => { result.current.setActiveChatId(ORIGINAL_CHAT); });

    await act(async () => {
      await result.current.handleForkFromMessage(A1);
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(expect.stringContaining(`/api/chats/${ORIGINAL_CHAT}/branch`), { messageId: A1 });
    expect(result.current.activeChatId).toBe(BRANCH_CHAT);
    expect(result.current.messageTree.has('66666666-6666-4666-8666-666666666666')).toBe(true);
    expect(streamSend).not.toHaveBeenCalled();
  });
});

describe('buildComparisonSend', () => {
  const attachment: ChatAttachment = { attachmentId: 'att1', filename: 'x.docx', sectionCount: 2, charCount: 50 };

  it('verwendet die getrimmte Instruktion als Nachricht', () => {
    const result = buildComparisonSend(attachment, ['contradiction', 'formal'], '  Fasse zusammen.  ', 'Fallback', { teamId: 't1' });
    expect(result).toEqual({
      message: 'Fasse zusammen.',
      opts: { attachmentId: 'att1', comparisonModes: ['contradiction', 'formal'], agentSelection: { teamId: 't1' } },
    });
  });

  it('fällt bei leerer (oder nur Leerzeichen-) Instruktion auf die Standardnachricht zurück', () => {
    const result = buildComparisonSend(attachment, ['completeness'], '   ', 'Vergleiche dieses Dokument mit der Wissensbasis', {});
    expect(result.message).toBe('Vergleiche dieses Dokument mit der Wissensbasis');
  });

  it('gibt die Agent-/Team-Auswahl unverändert in opts zurück (statt sie zu verwerfen)', () => {
    const result = buildComparisonSend(attachment, ['formal'], 'x', 'Fallback', { agentId: 'a9' });
    expect(result.opts.agentSelection).toEqual({ agentId: 'a9' });
  });
});

// Wave 5 conflict surfacing, reload path: `GET /api/chats/:id/messages`
// carries `conflicts` as a bare array directly on the message row (task-3's
// binding wire shape — no `.conflicts.conflicts` nesting). handleSelectChat
// must map it straight onto Message.conflicts so a reloaded chat shows the
// same badge as a freshly streamed one.
describe('useChat.handleSelectChat — conflicts (reload path)', () => {
  const chat: ChatEntry = {
    id: 'c1', kbId: 'kb1', userId: 'u1', title: 'Chat', type: 'chat',
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
  };

  it('übernimmt conflicts aus der Nachricht auf Message.conflicts', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        { id: 'u1', role: 'user', content: 'Wie hoch ist die Beitragshöhe?' },
        {
          id: 'a1', role: 'ai', content: 'Die Quellen widersprechen sich.',
          conflicts: [
            { claim: 'Beitragshöhe', sourceA: 1, sourceB: 2, kind: 'contradiction', newer: 'unknown', fileA: 'alt.md', fileB: 'neu.md' },
          ],
        },
      ],
    });
    const { result } = renderUseChat();

    await act(async () => {
      await result.current.handleSelectChat(chat);
    });

    const aiMsg = result.current.messageTree.get('a1');
    expect(aiMsg?.conflicts).toHaveLength(1);
    expect(aiMsg?.conflicts?.[0].claim).toBe('Beitragshöhe');
    expect(aiMsg?.conflicts?.[0].fileB).toBe('neu.md');
  });

  it('lässt conflicts undefined, wenn der Schlüssel im Response fehlt', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        { id: 'u2', role: 'user', content: 'Frage ohne Widerspruch' },
        { id: 'a2', role: 'ai', content: 'Antwort ohne Widerspruch' },
      ],
    });
    const { result } = renderUseChat();

    await act(async () => {
      await result.current.handleSelectChat(chat);
    });

    expect(result.current.messageTree.get('a2')?.conflicts).toBeUndefined();
  });
});
