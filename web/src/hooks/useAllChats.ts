import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import type { ChatEntry, ChatListEntry, ChatSection, KnowledgeBase } from '../types';

interface UseAllChatsParams {
  /** The open topic's chats (useChat), which carry its optimistic updates. */
  liveChats: ChatEntry[];
  /** Called when a pin or unpin was refused; the lists are back as they were. */
  onPinError: (pinned: boolean) => void;
  /** Called when the order of the pinned chats could not be saved. */
  onPinOrderError: () => void;
  /** Called when a section could not be created, renamed or deleted. */
  onSectionError: (action: 'create' | 'rename' | 'delete') => void;
  /** The topic `liveChats` belongs to once they are loaded. */
  currentKb: KnowledgeBase | null;
  /** Changes whenever the list should be read again (the view, the open topic). */
  refreshKey: string;
}

/**
 * The user's chats across all topics (GET /api/chats), for the sidebar
 * history.
 *
 * The open topic's rows come from `liveChats` instead of the fetched list:
 * that list is the one a new chat, a rename and a delete update at once, so
 * the history follows them without waiting for a request. What the user keeps
 * at hand (pin, section, place) is this hook's own state alone — the fetched
 * list — and is laid over those rows, so a pin or a move changes nothing in
 * the open topic's state and renders nothing but the history.
 */
export function useAllChats({
  liveChats, onPinError, onPinOrderError, onSectionError, currentKb, refreshKey,
}: UseAllChatsParams) {
  const [fetched, setFetched] = useState<ChatListEntry[]>([]);
  const requestRef = useRef(0);

  // Reads the list; a slower, older answer must not replace a newer one.
  const reading = useRef(0);
  const load = useCallback(() => {
    const request = ++requestRef.current;
    reading.current += 1;
    return axios.get<ChatListEntry[]>(`${API_BASE_URL}/api/chats`)
      .then((res) => { if (request === requestRef.current) setFetched(res.data); })
      // The history keeps what it has; the open topic's chats still show.
      .catch((err: unknown) => { console.error('Failed to fetch the chat history:', err); })
      .finally(() => { reading.current -= 1; });
  }, []);

  /* A write starts: a read still on its way was taken before it and would
     put the list back as it was. Its answer is dropped, and the list is read
     again once the write is through (`settled`). Without a read on its way
     nothing is read: the list already shows the write. */
  const beginWrite = useCallback(() => {
    if (reading.current === 0) return () => {};
    requestRef.current += 1;
    return () => { void load(); };
  }, [load]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  // The rows as they are now, for `setPinned` to find a chat's previous pin.
  const fetchedRef = useRef(fetched);
  useEffect(() => {
    fetchedRef.current = fetched;
  });

  const chats = useMemo(() => {
    // `liveChats` still holds the previous topic's rows until the new
    // topic's list has loaded; only rows of the open topic are taken.
    const liveKbId = liveChats[0]?.kbId;
    if (!currentKb || liveKbId !== currentKb.id) return fetched;
    const topic = {
      kbName: currentKb.name,
      kbVisibility: currentKb.visibility === 'public' || currentKb.isGlobal ? 'public' as const : 'private' as const,
      kbRole: currentKb.myRole ?? 'view',
    };
    // A chat the fetched list does not hold yet (just started) keeps what
    // its own row says.
    const kept = new Map(fetched.map(c => [c.id, c]));
    return [
      ...fetched.filter(c => c.kbId !== liveKbId),
      ...liveChats.map((c) => {
        const own = kept.get(c.id) ?? c;
        return { ...c, ...topic, pinnedAt: own.pinnedAt, pinPosition: own.pinPosition, sectionId: own.sectionId };
      }),
    ];
  }, [fetched, liveChats, currentKb]);

  /* Keep a chat at hand, or let it go (PUT / DELETE /api/chats/{id}/pin):
     pinned in „Angepinnt" (`sectionId` null) or filed in one of the user's
     sections. Both lists show it at once; a refused request puts them back
     and says so. */
  const setPinned = useCallback(async (id: string, pinned: boolean, sectionId: string | null = null) => {
    type Kept = Pick<ChatEntry, 'pinnedAt' | 'pinPosition' | 'sectionId'>;
    const write = (kept: Kept) => <T extends ChatEntry>(rows: T[]) =>
      rows.map(c => (c.id === id ? { ...c, ...kept } : c));
    const before = fetchedRef.current.find(c => c.id === id);
    const previous: Kept = {
      pinnedAt: before?.pinnedAt ?? null,
      pinPosition: before?.pinPosition ?? null,
      sectionId: before?.sectionId ?? null,
    };
    const next: Kept = pinned
      ? {
        pinnedAt: previous.pinnedAt ?? new Date().toISOString(),
        sectionId,
        // It keeps its place only while it stays in its section.
        pinPosition: previous.pinnedAt && previous.sectionId === sectionId ? previous.pinPosition : null,
      }
      : { pinnedAt: null, pinPosition: null, sectionId: null };
    const settled = beginWrite();
    setFetched(write(next));
    try {
      const url = `${API_BASE_URL}/api/chats/${id}/pin`;
      await (pinned ? axios.put(url, sectionId ? { sectionId } : {}) : axios.delete(url));
      // A chat the list does not hold yet could not be shown as kept: read it.
      if (!before) void load();
      else settled();
      return true;
    } catch {
      setFetched(write(previous));
      onPinError(pinned);
      settled();
      return false;
    }
  }, [onPinError, load, beginWrite]);

  /* Save the user's order of one section's chats (PUT /api/chats/pin-order):
     `ids` front to back, all of them; `sectionId` null is „Angepinnt". Shown
     at once; when the save is refused the list is read again, which brings
     the stored order back. */
  const showOrder = useCallback((ids: string[], sectionId: string | null) => {
    const place = new Map(ids.map((id, i) => [id, i + 1]));
    const write = <T extends ChatEntry>(rows: T[]) =>
      rows.map(c => (c.pinnedAt && (c.sectionId ?? null) === sectionId
        ? { ...c, pinPosition: place.get(c.id) ?? null }
        : c));
    setFetched(write);
  }, []);
  const saveOrder = useCallback(async (ids: string[], sectionId: string | null) => {
    const settled = beginWrite();
    try {
      await axios.put(`${API_BASE_URL}/api/chats/pin-order`, sectionId ? { chatIds: ids, sectionId } : { chatIds: ids });
      settled();
    } catch {
      onPinOrderError();
      void load();
    }
  }, [onPinOrderError, load, beginWrite]);
  const setPinnedOrder = useCallback(async (ids: string[], sectionId: string | null = null) => {
    showOrder(ids, sectionId);
    await saveOrder(ids, sectionId);
  }, [showOrder, saveOrder]);

  /* File a chat at a place in a section (a row dropped there): pin it in
     `sectionId` and give the section the order `ids`, which holds the chat.
     Both show at once; the order is saved once the pin is — the server only
     orders chats that are in the section. */
  const fileAt = useCallback(async (id: string, sectionId: string | null, ids: string[]) => {
    const pinning = setPinned(id, true, sectionId);
    showOrder(ids, sectionId);
    if (await pinning) await saveOrder(ids, sectionId);
  }, [setPinned, showOrder, saveOrder]);

  /* The user's own sections (/api/chat-sections). A write resolves true when
     the server took it; a refusal is reported through `onSectionError`. */
  const [sections, setSections] = useState<ChatSection[]>([]);
  useEffect(() => {
    let cancelled = false;
    axios.get<ChatSection[]>(`${API_BASE_URL}/api/chat-sections`)
      .then((res) => { if (!cancelled) setSections(res.data); })
      // No sections then; pinned chats and the history still show.
      .catch((err: unknown) => { console.error('Failed to fetch the chat sections:', err); });
    return () => { cancelled = true; };
  }, []);

  const createSection = useCallback(async (name: string) => {
    try {
      const res = await axios.post<ChatSection>(`${API_BASE_URL}/api/chat-sections`, { name });
      setSections(prev => [...prev, res.data]);
      return res.data;
    } catch {
      onSectionError('create');
      return null;
    }
  }, [onSectionError]);

  const renameSection = useCallback(async (id: string, name: string) => {
    try {
      await axios.patch(`${API_BASE_URL}/api/chat-sections/${id}`, { name });
      setSections(prev => prev.map(s => (s.id === id ? { ...s, name } : s)));
      return true;
    } catch {
      onSectionError('rename');
      return false;
    }
  }, [onSectionError]);

  /* Save the user's order of their sections (PUT /api/chat-sections/order):
     all ids, front to back. Shown at once; when the save is refused the
     sections are read again, which brings the stored order back. */
  const setSectionOrder = useCallback(async (ids: string[]) => {
    const place = new Map(ids.map((id, i) => [id, i]));
    const at = (s: ChatSection) => place.get(s.id) ?? ids.length;
    // A stable sort: sections not named keep their order, after the others.
    setSections(prev => [...prev].sort((a, b) => at(a) - at(b)));
    try {
      await axios.put(`${API_BASE_URL}/api/chat-sections/order`, { sectionIds: ids });
    } catch {
      onPinOrderError();
      try {
        const res = await axios.get<ChatSection[]>(`${API_BASE_URL}/api/chat-sections`);
        setSections(res.data);
      } catch (err: unknown) {
        console.error('Failed to fetch the chat sections:', err);
      }
    }
  }, [onPinOrderError]);

  /* Deleting a section lets its chats go back to the plain history. */
  const deleteSection = useCallback(async (id: string) => {
    try {
      await axios.delete(`${API_BASE_URL}/api/chat-sections/${id}`);
    } catch {
      onSectionError('delete');
      return false;
    }
    const release = <T extends ChatEntry>(rows: T[]) =>
      rows.map(c => (c.sectionId === id ? { ...c, pinnedAt: null, pinPosition: null, sectionId: null } : c));
    // Read before the delete, a list on its way would file the chats again.
    beginWrite()();
    setSections(prev => prev.filter(s => s.id !== id));
    setFetched(release);
    return true;
  }, [onSectionError, beginWrite]);

  return {
    chats, refresh: load, setPinned, setPinnedOrder, fileAt,
    sections, createSection, renameSection, deleteSection, setSectionOrder,
  };
}
