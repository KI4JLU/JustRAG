import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import axios from 'axios';
import type { MouseEvent } from 'react';
import { useKnowledgeBases, KB_LIST_PAGE_SIZE } from './useKnowledgeBases';
import type { KnowledgeBase } from '../types';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

// removeKb's own delete-vs-leave-vs-unsubscribe decision is useKbRemoval's
// job (covered by useKbRemoval.test.ts); here it's mocked so these tests can
// drive handleDeleteKB purely through its return value ('deleted' / 'left' /
// 'unsubscribed' / 'cancelled').
const removeKb = vi.fn();
vi.mock('./useKbRemoval', () => ({
  useKbRemoval: () => ({ removeKb, removing: false }),
}));

vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({ t: (key: string) => key }),
}));

const showConfirm = vi.fn();
const showPrompt = vi.fn();
vi.mock('../contexts/ModalContext', () => ({
  useModalContext: () => ({ showConfirm, showPrompt }),
}));

const toastError = vi.fn();
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ error: toastError, success: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const fakeEvent = { stopPropagation: vi.fn() } as unknown as MouseEvent;

const personalKb: KnowledgeBase = {
  id: 'kb-1',
  name: 'Handbuch',
  description: null,
  userId: 'owner-1',
  createdAt: '2026-01-01T00:00:00Z',
  isPro: false,
  aiConfigId: null,
  chatModel: null,
  embeddingModel: null,
  rerankModel: null,
  ttsModel: null,
  myRole: 'owner',
};

const subscribedGlobalKb: KnowledgeBase = {
  id: 'kb-2',
  name: 'Katalog-KB',
  description: null,
  userId: null,
  createdAt: '2026-01-01T00:00:00Z',
  isPro: false,
  aiConfigId: null,
  chatModel: null,
  embeddingModel: null,
  rerankModel: null,
  ttsModel: null,
  isGlobal: true,
  isPublished: true,
  visibility: 'public',
};

const handleGoHome = vi.fn();

const setCurrentKb = vi.fn();

function setup() {
  return renderHook(() => useKnowledgeBases({
    onKBSelected: vi.fn(),
    handleGoHome,
    setCurrentKb,
    setIsPro: vi.fn(),
    setKbView: vi.fn(),
    setView: vi.fn(),
    setSelectedContent: vi.fn(),
    setGeneratedContent: vi.fn(),
  }));
}

describe('useKnowledgeBases handleDeleteKB', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Pins the reviewer-identified gap directly: nothing previously exercised
  // useKnowledgeBases' reaction to a removal outcome. The old implementation
  // relied entirely on the async fetchKBs() reconciliation to update local
  // state, so if that refetch never resolves (fetchKBs swallows its own
  // errors and never rethrows — a slow or failed network leaves it hanging
  // from the caller's perspective), the just-removed KB stayed on screen.
  // The fix splices both lists synchronously first, then still reconciles.
  it('removes the KB from local state before the reconciling refetch resolves, and still triggers the refetch', async () => {
    let resolveGet!: (v: { data: KnowledgeBase[] }) => void;
    mockedAxios.get.mockImplementation(() => new Promise((resolve) => { resolveGet = resolve; }));
    removeKb.mockResolvedValue('deleted');

    const { result } = setup();
    act(() => { result.current.setKbs([personalKb]); });

    act(() => { void result.current.handleDeleteKB(personalKb, fakeEvent); });

    // The KB must be gone from local state even though the GET requests
    // fetchKBs fired are still pending — proves removal doesn't depend on
    // the refetch completing.
    await waitFor(() => expect(result.current.kbs).toEqual([]));
    expect(mockedAxios.get).toHaveBeenCalled();

    // Drain the pending refetch so it doesn't dangle past the test.
    await act(async () => { resolveGet({ data: [] }); await Promise.resolve(); });
  });

  // The latent bug the reviewer flagged the refetch-only version as fixing:
  // a KB living in globalKbs (a subscription) must be spliced out of
  // globalKbs, not kbs — splicing the wrong array would leave a stale card.
  it('removes a subscribed KB from globalKbs, not kbs', async () => {
    mockedAxios.get.mockResolvedValue({ data: [] });
    removeKb.mockResolvedValue('unsubscribed');

    const { result } = setup();
    act(() => { result.current.setGlobalKbs([subscribedGlobalKb]); });

    await act(async () => {
      await result.current.handleDeleteKB(subscribedGlobalKb, fakeEvent);
    });

    expect(result.current.globalKbs).toEqual([]);
    expect(mockedAxios.get).toHaveBeenCalled();
  });

  // Navigation must not wait on the network. Deleting the KB you are currently
  // viewing used to await fetchKBs() first, parking the caller on the deleted
  // KB's view for the whole round trip — and fetchKBs never rejects (it
  // swallows into console.error + a toast), so a hanging network stranded them
  // there indefinitely.
  it('navigates home before the reconciling refetch resolves', async () => {
    let resolveGet!: (v: { data: KnowledgeBase[] }) => void;
    mockedAxios.get.mockImplementation(() => new Promise((resolve) => { resolveGet = resolve; }));
    removeKb.mockResolvedValue('deleted');

    const { result } = setup();
    act(() => { result.current.setKbs([personalKb]); });

    act(() => { void result.current.handleDeleteKB(personalKb, fakeEvent); });

    await waitFor(() => expect(handleGoHome).toHaveBeenCalledTimes(1));
    // Die GETs stehen zu diesem Zeitpunkt noch aus — genau das ist der Punkt.
    expect(mockedAxios.get).toHaveBeenCalled();

    await act(async () => { resolveGet({ data: [] }); await Promise.resolve(); });
  });

  it('leaves local state untouched when the removal is cancelled', async () => {
    removeKb.mockResolvedValue('cancelled');

    const { result } = setup();
    act(() => { result.current.setKbs([personalKb]); });

    await act(async () => {
      await result.current.handleDeleteKB(personalKb, fakeEvent);
    });

    expect(result.current.kbs).toEqual([personalKb]);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});

describe('useKnowledgeBases handleRenameKB', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The rename merges only the new name into the row it already has. PATCH
  // now answers with the full caller-aware row (API.md; see saveKbSettings
  // below), but the name-only merge does not depend on that: the fixture
  // deliberately answers with a row that LACKS myRole, the shape the old
  // server sent, and HomeView's owned/shared split keys on myRole — so these
  // tests still pin that a rename never drops it.
  const patchResponse = (kb: KnowledgeBase, name: string): KnowledgeBase => {
    const bare: KnowledgeBase = { ...kb, name };
    delete bare.myRole;
    return bare;
  };

  it('prompts with the current name, PATCHes the trimmed new name and updates the list', async () => {
    showPrompt.mockResolvedValue('  Neues Handbuch ');
    const renamed = { ...personalKb, name: 'Neues Handbuch' };
    mockedAxios.patch.mockResolvedValue({ data: patchResponse(personalKb, 'Neues Handbuch') });

    const { result } = setup();
    act(() => { result.current.setKbs([personalKb]); });

    await act(async () => { await result.current.handleRenameKB(personalKb, fakeEvent); });

    expect(fakeEvent.stopPropagation).toHaveBeenCalled();
    expect(showPrompt).toHaveBeenCalledWith('renameKbPrompt', 'Handbuch', 'renameKb');
    expect(mockedAxios.patch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/kb\/kb-1$/), { name: 'Neues Handbuch' });
    expect(result.current.kbs).toEqual([renamed]);
  });

  it('propagates the renamed row into the current KB only when it is the same KB', async () => {
    showPrompt.mockResolvedValue('Neu');
    const renamed = { ...personalKb, name: 'Neu' };
    mockedAxios.patch.mockResolvedValue({ data: patchResponse(personalKb, 'Neu') });

    const { result } = setup();
    await act(async () => { await result.current.handleRenameKB(personalKb); });

    // setCurrentKb is React's state setter; the hook must use the functional
    // form so a rename from the Home card of a KB that is NOT open never
    // hijacks currentKb.
    expect(setCurrentKb).toHaveBeenCalledTimes(1);
    const updater = setCurrentKb.mock.calls[0][0] as (prev: KnowledgeBase | null) => KnowledgeBase | null;
    expect(typeof updater).toBe('function');
    expect(updater(null)).toBeNull();
    expect(updater(subscribedGlobalKb)).toBe(subscribedGlobalKb);
    expect(updater(personalKb)).toEqual(renamed);
  });

  it('updates a public KB in globalKbs', async () => {
    showPrompt.mockResolvedValue('Katalog 2');
    const renamed = { ...subscribedGlobalKb, name: 'Katalog 2' };
    mockedAxios.patch.mockResolvedValue({ data: patchResponse(subscribedGlobalKb, 'Katalog 2') });

    const { result } = setup();
    act(() => { result.current.setGlobalKbs([subscribedGlobalKb]); });

    await act(async () => { await result.current.handleRenameKB(subscribedGlobalKb); });

    expect(result.current.globalKbs).toEqual([renamed]);
  });

  it.each([null, '', '   ', 'Handbuch', ' Handbuch '])('does nothing when the prompt yields %j', async (answer) => {
    showPrompt.mockResolvedValue(answer);

    const { result } = setup();
    act(() => { result.current.setKbs([personalKb]); });

    await act(async () => { await result.current.handleRenameKB(personalKb); });

    expect(mockedAxios.patch).not.toHaveBeenCalled();
    expect(result.current.kbs).toEqual([personalKb]);
  });

  it('rejects a name longer than 255 characters before any request', async () => {
    showPrompt.mockResolvedValue('x'.repeat(256));

    const { result } = setup();
    await act(async () => { await result.current.handleRenameKB(personalKb); });

    expect(mockedAxios.patch).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('kbNameTooLong');
  });

  it('toasts and leaves the list untouched when the PATCH fails', async () => {
    showPrompt.mockResolvedValue('Neu');
    mockedAxios.patch.mockRejectedValue(new Error('403'));

    const { result } = setup();
    act(() => { result.current.setKbs([personalKb]); });

    await act(async () => { await result.current.handleRenameKB(personalKb); });

    expect(toastError).toHaveBeenCalledWith('kbRenameError');
    expect(result.current.kbs).toEqual([personalKb]);
    expect(setCurrentKb).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------------------
 * GET /api/kb paging. ORACLE: API.md — `GET /kb` is paged with `?limit=`
 * (maximum 100, larger values clamped) and `?offset=`, while `GET /kb/global`
 * is not paged. The fake server below implements exactly that contract over a
 * fixed list of rows; the expected rows are that list, written out here, not
 * anything the hook computed.
 * ------------------------------------------------------------------------- */
describe('useKnowledgeBases fetchKBs paging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const row = (i: number, extra: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
    ...personalKb, id: `kb-${String(i).padStart(3, '0')}`, name: `Thema ${i}`, ...extra,
  });

  /** A server that pages `rows` the way API.md documents it. */
  function pagingServer(rows: KnowledgeBase[], opts: { ignoreOffset?: boolean } = {}) {
    mockedAxios.get.mockImplementation(async (url: string, config?: { params?: { limit?: number; offset?: number } }) => {
      if (url.endsWith('/api/kb/global')) return { data: [subscribedGlobalKb] };
      if (url.endsWith('/api/kb')) {
        const limit = Math.min(config?.params?.limit ?? 50, 100);
        const offset = opts.ignoreOffset ? 0 : (config?.params?.offset ?? 0);
        return { data: rows.slice(offset, offset + limit) };
      }
      throw new Error(`unexpected GET ${url}`);
    });
  }

  const listCalls = () => mockedAxios.get.mock.calls.filter(([u]) => String(u).endsWith('/api/kb'));

  it('fetches every page, so a favorite past the first page reaches the chip filter', async () => {
    // 207 rows: two full pages and a short third. The starred one is on page 3,
    // which the old single request (default limit 50) never saw.
    const rows = Array.from({ length: 207 }, (_, i) => row(i, i === 205 ? { isFavorite: true } : {}));
    pagingServer(rows);

    const { result } = setup();
    await act(async () => { await result.current.fetchKBs(); });

    expect(result.current.kbs.map(k => k.id)).toEqual(rows.map(k => k.id));
    expect(result.current.kbs.filter(k => k.isFavorite).map(k => k.id)).toEqual(['kb-205']);
    expect(listCalls().map(([, cfg]) => (cfg as { params: unknown }).params)).toEqual([
      { limit: 100, offset: 0 },
      { limit: 100, offset: 100 },
      { limit: 100, offset: 200 },
    ]);
    expect(KB_LIST_PAGE_SIZE).toBe(100); // API.md's maximum page size
    // The global list is one unpaged request.
    expect(result.current.globalKbs).toEqual([subscribedGlobalKb]);
  });

  it('stops after the first page when it is short', async () => {
    pagingServer([row(1), row(2)]);
    const { result } = setup();
    await act(async () => { await result.current.fetchKBs(); });
    expect(result.current.kbs.map(k => k.id)).toEqual(['kb-001', 'kb-002']);
    expect(listCalls()).toHaveLength(1);
  });

  it('asks for one more page when the last full page ends exactly on the boundary', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => row(i));
    pagingServer(rows);
    const { result } = setup();
    await act(async () => { await result.current.fetchKBs(); });
    expect(result.current.kbs).toHaveLength(100);
    expect(listCalls()).toHaveLength(2); // the second answers [] and ends the walk
  });

  it('ends the walk instead of looping when the server ignores offset', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => row(i));
    pagingServer(rows, { ignoreOffset: true });
    const { result } = setup();
    await act(async () => { await result.current.fetchKBs(); });
    // Page two repeats page one: no new id, so the walk stops; no duplicates.
    expect(listCalls()).toHaveLength(2);
    expect(result.current.kbs.map(k => k.id)).toEqual(rows.slice(0, 100).map(k => k.id));
  });
});

/* ---------------------------------------------------------------------------
 * Settings save. ORACLE: API.md — "`PATCH /kb/{id}` returns the KB in the same
 * caller-aware shape as `GET /kb/{id}` (card fields, `myRole`, and the per-user
 * filter fields), so a client can replace its copy with the response." The
 * PATCH responses below are written from that sentence: they carry the star,
 * the counts and myRole, and — to tell "replaced" from "patched with what was
 * sent" — a count the client did not send.
 * ------------------------------------------------------------------------- */
describe('useKnowledgeBases saveKbSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const starred: KnowledgeBase = {
    ...personalKb, isFavorite: true, userCategoryIds: ['cat-1'], memberCount: 3, fileCount: 7, turnCount: 12,
  };

  it('keeps the star, the counts and the role after a save, from the PATCH response', async () => {
    // The full row the server re-reads after the write. fileCount moved on
    // the server meanwhile (an ingest finished) — the client did not send it,
    // so seeing 8 proves the row was replaced, not patched with `data`.
    const patched: KnowledgeBase = { ...starred, chatModel: 'gpt-x', fileCount: 8 };
    mockedAxios.patch.mockResolvedValue({ data: patched });

    const { result } = setup();
    act(() => { result.current.setKbs([starred]); });

    await act(async () => { await result.current.saveKbSettings('kb-1', { chatModel: 'gpt-x' }); });

    expect(mockedAxios.patch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/kb\/kb-1$/), { chatModel: 'gpt-x' });
    const [saved] = result.current.kbs;
    expect(saved.isFavorite).toBe(true);
    expect(saved.userCategoryIds).toEqual(['cat-1']);
    expect(saved.memberCount).toBe(3);
    expect(saved.myRole).toBe('owner');
    expect(saved.chatModel).toBe('gpt-x');
    expect(saved.fileCount).toBe(8);
  });

  it('replaces a public topic in globalKbs and leaves kbs alone', async () => {
    const globalStarred: KnowledgeBase = { ...subscribedGlobalKb, isFavorite: true, memberCount: 40 };
    mockedAxios.patch.mockResolvedValue({ data: { ...globalStarred, rerankModel: 'rr-1' } });

    const { result } = setup();
    act(() => {
      result.current.setKbs([personalKb]);
      result.current.setGlobalKbs([globalStarred]);
    });

    await act(async () => { await result.current.saveKbSettings('kb-2', { rerankModel: 'rr-1' }); });

    expect(result.current.globalKbs).toEqual([{ ...globalStarred, rerankModel: 'rr-1' }]);
    expect(result.current.kbs).toEqual([personalKb]);
  });

  it('updates the open KB only when it is the saved one', async () => {
    const patched: KnowledgeBase = { ...starred, chatModel: 'gpt-x' };
    mockedAxios.patch.mockResolvedValue({ data: patched });

    const { result } = setup();
    await act(async () => { await result.current.saveKbSettings('kb-1', { chatModel: 'gpt-x' }); });

    const updater = setCurrentKb.mock.calls[0][0] as (prev: KnowledgeBase | null) => KnowledgeBase | null;
    expect(updater(null)).toBeNull();
    expect(updater(subscribedGlobalKb)).toBe(subscribedGlobalKb);
    expect(updater(starred)).toEqual(patched);
  });

  it('rejects and leaves every list untouched when the PATCH fails', async () => {
    mockedAxios.patch.mockRejectedValue(new Error('403'));
    const { result } = setup();
    act(() => { result.current.setKbs([starred]); });

    await act(async () => {
      await expect(result.current.saveKbSettings('kb-1', { chatModel: 'gpt-x' })).rejects.toThrow('403');
    });

    expect(result.current.kbs).toEqual([starred]);
    expect(setCurrentKb).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------------------
 * The star. ORACLE: API.md — `PUT /kb/{id}/favorite` and
 * `DELETE /kb/{id}/favorite` (204), and the row field `isFavorite`. The
 * route and the field are spelled `favorite`; the old `favourite` route no
 * longer exists on the server.
 * ------------------------------------------------------------------------- */
describe('useKnowledgeBases handleToggleFavorite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PUTs /api/kb/{id}/favorite to star and flips isFavorite in the list holding the row', async () => {
    mockedAxios.put.mockResolvedValue({ status: 204 });
    const { result } = setup();
    act(() => {
      result.current.setKbs([personalKb]);
      result.current.setGlobalKbs([subscribedGlobalKb]);
    });

    await act(async () => { await result.current.handleToggleFavorite(subscribedGlobalKb, fakeEvent); });

    expect(mockedAxios.put).toHaveBeenCalledWith(expect.stringMatching(/\/api\/kb\/kb-2\/favorite$/));
    expect(result.current.globalKbs[0].isFavorite).toBe(true);
    expect(result.current.kbs).toEqual([personalKb]);
  });

  it('DELETEs /api/kb/{id}/favorite to unstar', async () => {
    mockedAxios.delete.mockResolvedValue({ status: 204 });
    const starred = { ...personalKb, isFavorite: true };
    const { result } = setup();
    act(() => { result.current.setKbs([starred]); });

    await act(async () => { await result.current.handleToggleFavorite(starred, fakeEvent); });

    expect(mockedAxios.delete).toHaveBeenCalledWith(expect.stringMatching(/\/api\/kb\/kb-1\/favorite$/));
    expect(result.current.kbs[0].isFavorite).toBe(false);
  });

  it('reverts the star and toasts when the request fails', async () => {
    mockedAxios.put.mockRejectedValue(new Error('500'));
    const { result } = setup();
    act(() => { result.current.setKbs([personalKb]); });

    await act(async () => { await result.current.handleToggleFavorite(personalKb, fakeEvent); });

    expect(result.current.kbs[0].isFavorite).toBe(false);
    expect(toastError).toHaveBeenCalledWith('favoriteError');
  });
});
