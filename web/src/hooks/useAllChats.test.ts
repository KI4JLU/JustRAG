import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import type { ChatEntry, ChatListEntry, KnowledgeBase } from '../types';
import { useAllChats } from './useAllChats';

vi.mock('axios');
const mockedGet = vi.mocked(axios.get);

const row = (id: string, kbId: string, title: string): ChatListEntry => ({
  id, kbId, userId: 'u1', title, createdAt: '2026-08-10T00:00:00Z', updatedAt: '2026-08-10T00:00:00Z',
  kbName: `Topic ${kbId}`, kbVisibility: 'private', kbRole: 'view',
});
const live = (id: string, kbId: string, title: string): ChatEntry => ({
  id, kbId, userId: 'u1', title, createdAt: '2026-08-11T00:00:00Z', updatedAt: '2026-08-11T00:00:00Z',
});
const kb1 = { id: 'kb1', name: 'Haushalt', myRole: 'owner', visibility: 'private' } as KnowledgeBase;

beforeEach(() => {
  vi.clearAllMocks();
  sectionRows = [];
  answerChats([row('a', 'kb1', 'old title'), row('b', 'kb2', 'elsewhere')]);
});

const onPinError = vi.fn();
const onPinOrderError = vi.fn();
const onSectionError = vi.fn();
const base = { onPinError, onPinOrderError, onSectionError };

/** GET /api/chats answers `chats`, GET /api/chat-sections `sections`. */
let sectionRows: { id: string; name: string; createdAt: string }[] = [];
const answerChats = (chats: unknown) => mockedGet.mockImplementation((url: string) =>
  Promise.resolve({ data: String(url).endsWith('/api/chat-sections') ? sectionRows : chats }));
const chatReads = () => mockedGet.mock.calls.filter(([url]) => String(url).endsWith('/api/chats')).length;

const ids = (chats: ChatListEntry[]) => chats.map(c => c.id).sort();

describe('useAllChats', () => {
  it('lists what GET /api/chats returns while no topic is open', async () => {
    const { result } = renderHook(() => useAllChats({ ...base, liveChats: [], currentKb: null, refreshKey: 'x' }));
    await waitFor(() => expect(ids(result.current.chats)).toEqual(['a', 'b']));
    expect(chatReads()).toBe(1);
  });

  // ORACLE: the open topic's own list is the one a rename, a delete and a new
  // chat update at once, so its rows replace the fetched ones for that topic.
  it('takes the open topic\'s rows from its live list, with the topic as the user sees it', async () => {
    const liveChats = [live('a', 'kb1', 'renamed'), live('n', 'kb1', 'brand new')];
    const { result } = renderHook(() => useAllChats({ ...base, liveChats, currentKb: kb1, refreshKey: 'x' }));
    await waitFor(() => expect(ids(result.current.chats)).toEqual(['a', 'b', 'n']));
    const byId = Object.fromEntries(result.current.chats.map(c => [c.id, c]));
    expect(byId.a.title).toBe('renamed');
    expect(byId.n).toMatchObject({ kbName: 'Haushalt', kbVisibility: 'private', kbRole: 'owner' });
    expect(byId.b.title).toBe('elsewhere');
  });

  it('ignores a live list that still belongs to the previous topic', async () => {
    const liveChats = [live('z', 'kb9', 'previous topic')];
    const { result } = renderHook(() => useAllChats({ ...base, liveChats, currentKb: kb1, refreshKey: 'x' }));
    await waitFor(() => expect(ids(result.current.chats)).toEqual(['a', 'b']));
  });

  it('reads the list again when the refresh key changes', async () => {
    const { rerender } = renderHook(
      ({ refreshKey }) => useAllChats({ ...base, liveChats: [], currentKb: null, refreshKey }),
      { initialProps: { refreshKey: 'x' } },
    );
    await waitFor(() => expect(chatReads()).toBe(1));
    rerender({ refreshKey: 'y' });
    await waitFor(() => expect(chatReads()).toBe(2));
  });

  it('keeps the list it has when the request fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, rerender } = renderHook(
      ({ refreshKey }) => useAllChats({ ...base, liveChats: [], currentKb: null, refreshKey }),
      { initialProps: { refreshKey: 'x' } },
    );
    await waitFor(() => expect(ids(result.current.chats)).toEqual(['a', 'b']));
    mockedGet.mockImplementation(() => Promise.reject(new Error('offline')));
    rerender({ refreshKey: 'y' });
    await waitFor(() => expect(chatReads()).toBe(2));
    expect(ids(result.current.chats)).toEqual(['a', 'b']);
  });

  // ORACLE: the API contract — PUT /api/chats/{id}/pin pins, DELETE lets go —
  // and the list shows the pin before the request has answered.
  describe('pinning', () => {
    const mockedPut = vi.mocked(axios.put);
    const mockedDelete = vi.mocked(axios.delete);
    const pinOf = (chats: ChatListEntry[], id: string) => chats.find(c => c.id === id)?.pinnedAt ?? null;

    it('pins at once, with PUT', async () => {
      mockedPut.mockResolvedValue({ data: null });
      const { result } = renderHook(() => useAllChats({ ...base, liveChats: [], currentKb: null, refreshKey: 'x' }));
      await waitFor(() => expect(ids(result.current.chats)).toEqual(['a', 'b']));

      await act(() => result.current.setPinned('b', true));

      expect(pinOf(result.current.chats, 'b')).not.toBeNull();
      expect(pinOf(result.current.chats, 'a')).toBeNull();
      expect(String(mockedPut.mock.calls[0][0])).toMatch(/\/api\/chats\/b\/pin$/);
      expect(onPinError).not.toHaveBeenCalled();
    });

    // ORACLE: the order of events — a list read before the pin answers after
    // it. It must not put the chat back as unpinned, and the list is read anew.
    it('drops a read that was on its way when a pin started', async () => {
      mockedPut.mockResolvedValue({ data: null });
      const { result, rerender } = renderHook(
        ({ refreshKey }) => useAllChats({ ...base, liveChats: [], currentKb: null, refreshKey }),
        { initialProps: { refreshKey: 'x' } },
      );
      await waitFor(() => expect(ids(result.current.chats)).toEqual(['a', 'b']));

      let answerStale: (value: { data: unknown }) => void = () => {};
      mockedGet.mockImplementationOnce(() => new Promise((resolve) => { answerStale = resolve; }));
      rerender({ refreshKey: 'y' });
      const reads = chatReads();
      // What the server answers once the pin is saved.
      answerChats([row('a', 'kb1', 'one'), { ...row('b', 'kb2', 'two'), pinnedAt: '2026-08-20T00:00:00Z' }]);
      await act(() => result.current.setPinned('b', true));
      await act(async () => { answerStale({ data: [row('a', 'kb1', 'one'), row('b', 'kb2', 'two')] }); });

      expect(pinOf(result.current.chats, 'b')).not.toBeNull();
      await waitFor(() => expect(chatReads()).toBe(reads + 1));
      expect(pinOf(result.current.chats, 'b')).not.toBeNull();
    });

    it('unpins with DELETE', async () => {
      answerChats([{ ...row('a', 'kb1', 'pinned'), pinnedAt: '2026-08-01T00:00:00Z' }]);
      mockedDelete.mockResolvedValue({ data: null });
      const { result } = renderHook(() => useAllChats({ ...base, liveChats: [], currentKb: null, refreshKey: 'x' }));
      await waitFor(() => expect(pinOf(result.current.chats, 'a')).not.toBeNull());

      await act(() => result.current.setPinned('a', false));

      expect(pinOf(result.current.chats, 'a')).toBeNull();
      expect(String(mockedDelete.mock.calls[0][0])).toMatch(/\/api\/chats\/a\/pin$/);
    });

    // ORACLE: the order handed in — the first id is place 1 — and the API
    // contract: the body is the whole order.
    it('saves the order of the pinned chats and shows it at once', async () => {
      answerChats([
        { ...row('a', 'kb1', 'one'), pinnedAt: '2026-08-01T00:00:00Z' },
        { ...row('b', 'kb2', 'two'), pinnedAt: '2026-08-02T00:00:00Z' },
        row('c', 'kb2', 'not pinned'),
      ]);
      mockedPut.mockResolvedValue({ data: null });
      const { result } = renderHook(() => useAllChats({ ...base, liveChats: [], currentKb: null, refreshKey: 'x' }));
      await waitFor(() => expect(ids(result.current.chats)).toEqual(['a', 'b', 'c']));

      await act(() => result.current.setPinnedOrder(['b', 'a']));

      const place = Object.fromEntries(result.current.chats.map(c => [c.id, c.pinPosition ?? null]));
      expect(place).toEqual({ a: 2, b: 1, c: null });
      expect(String(mockedPut.mock.calls[0][0])).toMatch(/\/api\/chats\/pin-order$/);
      expect(mockedPut.mock.calls[0][1]).toEqual({ chatIds: ['b', 'a'] });
    });

    it('reads the stored order again and reports it when the save is refused', async () => {
      mockedPut.mockRejectedValue(new Error('offline'));
      const { result } = renderHook(() => useAllChats({ ...base, liveChats: [], currentKb: null, refreshKey: 'x' }));
      await waitFor(() => expect(chatReads()).toBe(1));

      await act(() => result.current.setPinnedOrder(['b', 'a']));

      expect(onPinOrderError).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(chatReads()).toBe(2));
    });

    it('puts the pin back and reports it when the request is refused', async () => {
      mockedPut.mockRejectedValue(new Error('offline'));
      const { result } = renderHook(() => useAllChats({ ...base, liveChats: [], currentKb: null, refreshKey: 'x' }));
      await waitFor(() => expect(ids(result.current.chats)).toEqual(['a', 'b']));

      await act(() => result.current.setPinned('b', true));

      expect(pinOf(result.current.chats, 'b')).toBeNull();
      expect(onPinError).toHaveBeenCalledExactlyOnceWith(true);
    });
  });

  // ORACLE: the API contract of /api/chat-sections and of a pin with a
  // sectionId; the fixture rows for what moves.
  describe('sections', () => {
    const mockedPut = vi.mocked(axios.put);
    const mockedPost = vi.mocked(axios.post);
    const mockedPatch = vi.mocked(axios.patch);
    const mockedDelete = vi.mocked(axios.delete);
    const work = { id: 's1', name: 'Arbeit', createdAt: '2026-08-01T00:00:00Z' };
    const start = async () => {
      const hook = renderHook(() => useAllChats({ ...base, liveChats: [], currentKb: null, refreshKey: 'x' }));
      await waitFor(() => expect(ids(hook.result.current.chats)).toEqual(['a', 'b']));
      return hook.result;
    };

    it('reads the user\'s sections', async () => {
      sectionRows = [work];
      const result = await start();
      await waitFor(() => expect(result.current.sections).toEqual([work]));
    });

    it('creates, renames and deletes one', async () => {
      mockedPost.mockResolvedValue({ data: work });
      mockedPatch.mockResolvedValue({ data: null });
      mockedDelete.mockResolvedValue({ data: null });
      const result = await start();

      await act(async () => { expect(await result.current.createSection('Arbeit')).toEqual(work); });
      expect(mockedPost.mock.calls[0][1]).toEqual({ name: 'Arbeit' });
      expect(result.current.sections).toEqual([work]);

      await act(async () => { await result.current.renameSection('s1', 'Beruf'); });
      expect(String(mockedPatch.mock.calls[0][0])).toMatch(/\/api\/chat-sections\/s1$/);
      expect(result.current.sections[0].name).toBe('Beruf');

      await act(async () => { await result.current.deleteSection('s1'); });
      expect(result.current.sections).toEqual([]);
    });

    it('keeps the sections and reports it when a write is refused', async () => {
      mockedPost.mockRejectedValue(new Error('offline'));
      const result = await start();
      await act(async () => { expect(await result.current.createSection('Arbeit')).toBeNull(); });
      expect(result.current.sections).toEqual([]);
      expect(onSectionError).toHaveBeenCalledExactlyOnceWith('create');
    });

    it('files a chat in a section, and lets a deleted section\'s chats go', async () => {
      sectionRows = [work];
      mockedPut.mockResolvedValue({ data: null });
      mockedDelete.mockResolvedValue({ data: null });
      const result = await start();
      const chat = (id: string) => result.current.chats.find(c => c.id === id);

      await act(() => result.current.setPinned('a', true, 's1'));
      expect(mockedPut.mock.calls[0][1]).toEqual({ sectionId: 's1' });
      expect(chat('a')).toMatchObject({ sectionId: 's1' });
      expect(chat('a')?.pinnedAt).toBeTruthy();

      await act(async () => { await result.current.deleteSection('s1'); });
      expect(chat('a')).toMatchObject({ pinnedAt: null, sectionId: null, pinPosition: null });
    });

    // ORACLE: the API — PUT /api/chat-sections/order takes all ids, front to back.
    it('orders the sections at once and saves the order', async () => {
      const home = { id: 's2', name: 'Privat', createdAt: '2026-08-02T00:00:00Z' };
      sectionRows = [work, home];
      mockedPut.mockResolvedValue({ data: null });
      const result = await start();
      await waitFor(() => expect(result.current.sections).toHaveLength(2));

      await act(() => result.current.setSectionOrder(['s2', 's1']));
      expect(String(mockedPut.mock.calls[0][0])).toMatch(/\/api\/chat-sections\/order$/);
      expect(mockedPut.mock.calls[0][1]).toEqual({ sectionIds: ['s2', 's1'] });
      expect(result.current.sections.map(s => s.id)).toEqual(['s2', 's1']);
    });

    it('reads the sections again when the order is refused', async () => {
      const home = { id: 's2', name: 'Privat', createdAt: '2026-08-02T00:00:00Z' };
      sectionRows = [work, home];
      mockedPut.mockRejectedValue(new Error('offline'));
      const result = await start();
      await waitFor(() => expect(result.current.sections).toHaveLength(2));

      await act(() => result.current.setSectionOrder(['s2', 's1']));
      expect(onPinOrderError).toHaveBeenCalledTimes(1);
      expect(result.current.sections.map(s => s.id)).toEqual(['s1', 's2']);
    });

    // ORACLE: the API — the pin is saved first, then the section's order
    // (the server orders only chats that are in the section).
    it('files a chat at a place: pins it, then saves the section\'s order', async () => {
      sectionRows = [work];
      answerChats([
        { ...row('a', 'kb1', 'filed'), pinnedAt: '2026-08-01T00:00:00Z', sectionId: 's1', pinPosition: 1 },
        row('b', 'kb2', 'loose'),
      ]);
      mockedPut.mockResolvedValue({ data: null });
      const result = await start();

      await act(() => result.current.fileAt('b', 's1', ['b', 'a']));
      expect(mockedPut.mock.calls.map(c => String(c[0]).replace(/^.*\/api/, ''))).toEqual(['/chats/b/pin', '/chats/pin-order']);
      expect(mockedPut.mock.calls[1][1]).toEqual({ chatIds: ['b', 'a'], sectionId: 's1' });
      const placed = Object.fromEntries(result.current.chats.map(c => [c.id, [c.sectionId, c.pinPosition]]));
      expect(placed).toEqual({ a: ['s1', 2], b: ['s1', 1] });
    });

    it('saves no order when the pin is refused, and puts the chat back', async () => {
      sectionRows = [work];
      answerChats([row('a', 'kb1', 'other'), row('b', 'kb2', 'loose')]);
      mockedPut.mockRejectedValue(new Error('offline'));
      const result = await start();

      await act(() => result.current.fileAt('b', 's1', ['b']));
      expect(mockedPut).toHaveBeenCalledTimes(1);
      expect(result.current.chats.find(c => c.id === 'b')).toMatchObject({ pinnedAt: null, sectionId: null });
    });

    it('orders one section and leaves the pinned chats of another alone', async () => {
      answerChats([
        { ...row('a', 'kb1', 'filed'), pinnedAt: '2026-08-01T00:00:00Z', sectionId: 's1' },
        { ...row('b', 'kb2', 'pinned'), pinnedAt: '2026-08-02T00:00:00Z', pinPosition: 4 },
      ]);
      mockedPut.mockResolvedValue({ data: null });
      const result = await start();

      await act(() => result.current.setPinnedOrder(['a'], 's1'));

      expect(mockedPut.mock.calls[0][1]).toEqual({ chatIds: ['a'], sectionId: 's1' });
      const place = Object.fromEntries(result.current.chats.map(c => [c.id, c.pinPosition ?? null]));
      expect(place).toEqual({ a: 1, b: 4 });
    });
  });
});
