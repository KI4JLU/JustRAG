import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import { useFileManagement } from './useFileManagement';
import type { FileEntry, KnowledgeBase } from '../types';

vi.mock('axios');
vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({ t: (k: string) => k, language: 'de' }),
}));
vi.mock('../contexts/ModalContext', () => ({
  useModalContext: () => ({ showConfirm: vi.fn() }),
}));
const toast = { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() };
vi.mock('../contexts/ToastContext', () => ({ useToast: () => toast }));

const kb = { id: 'kb-1', name: 'KB', isGlobal: false } as KnowledgeBase;
const row = (id: string, name: string, status: FileEntry['status'] = 'pending'): FileEntry =>
  ({ id, name, type: 'application/pdf', status, progress: 0, origin: 'upload', createdAt: '2026-10-26T00:00:00Z' });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

// Oracle: the upload contract — a dropped file is listed before its upload
// finishes, its server row replaces it as soon as its own POST returns, and a
// list response older than that row cannot drop it again.
describe('useFileManagement.uploadFiles', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists dropped files at once and swaps each for its server row on return', async () => {
    const posts = [deferred<{ data: FileEntry }>(), deferred<{ data: FileEntry }>()];
    let post = 0;
    vi.mocked(axios.post).mockImplementation(() => posts[post++].promise);
    const staleList = deferred<{ data: FileEntry[] }>();
    vi.mocked(axios.get).mockResolvedValueOnce({ data: [] }).mockImplementationOnce(() => staleList.promise);

    const { result, unmount } = renderHook(() => useFileManagement({ currentKb: kb }));
    await act(() => result.current.fetchFiles(kb.id));
    // A list request in flight before any upload returns (e.g. the poll).
    act(() => { void result.current.fetchFiles(kb.id); });

    let done!: Promise<void>;
    act(() => {
      done = result.current.uploadFiles([
        new File(['a'], 'a.pdf', { type: 'application/pdf' }),
        new File(['b'], 'b.pdf', { type: 'application/pdf' }),
      ]);
    });
    expect(result.current.uploads.map(u => u.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(result.current.files).toEqual([]);

    await act(async () => posts[0].resolve({ data: row('f-a', 'a.pdf') }));
    expect(result.current.uploads.map(u => u.name)).toEqual(['b.pdf']);
    expect(result.current.files.map(f => f.id)).toEqual(['f-a']);
    expect(result.current.files[0].selected).toBe(true);

    // The older list response does not drop the new row.
    await act(async () => staleList.resolve({ data: [] }));
    expect(result.current.files.map(f => f.id)).toEqual(['f-a']);

    vi.mocked(axios.get).mockResolvedValue({ data: [row('f-b', 'b.pdf'), row('f-a', 'a.pdf')] });
    await act(async () => { posts[1].resolve({ data: row('f-b', 'b.pdf') }); await done; });
    expect(result.current.uploads).toEqual([]);
    await waitFor(() => expect(result.current.files.map(f => f.id)).toEqual(['f-b', 'f-a']));
    unmount();
  });

  it('drops the row of a failed upload and reports it', async () => {
    vi.mocked(axios.post).mockRejectedValue(new Error('network'));
    vi.mocked(axios.get).mockResolvedValue({ data: [] });

    const { result } = renderHook(() => useFileManagement({ currentKb: kb }));
    await act(() => result.current.fetchFiles(kb.id));
    await act(() => result.current.uploadFiles([new File(['a'], 'a.pdf')]));

    expect(result.current.uploads).toEqual([]);
    expect(result.current.files).toEqual([]);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('keeps an upload that returns after a KB switch out of the new KB', async () => {
    const pending = deferred<{ data: FileEntry }>();
    vi.mocked(axios.post).mockImplementation(() => pending.promise);
    vi.mocked(axios.get).mockResolvedValueOnce({ data: [] });
    const other = { ...kb, id: 'kb-2' } as KnowledgeBase;

    const { result, rerender } = renderHook(({ currentKb }) => useFileManagement({ currentKb }), { initialProps: { currentKb: kb } });
    await act(() => result.current.fetchFiles(kb.id));
    let done!: Promise<void>;
    act(() => { done = result.current.uploadFiles([new File(['a'], 'a.pdf')]); });

    rerender({ currentKb: other });
    expect(result.current.uploads).toEqual([]);
    vi.mocked(axios.get).mockResolvedValueOnce({ data: [row('f-x', 'x.pdf', 'completed')] });
    await act(() => result.current.fetchFiles(other.id));
    await act(async () => { pending.resolve({ data: row('f-a', 'a.pdf') }); await done; });

    expect(result.current.files.map(f => f.id)).toEqual(['f-x']);
    expect(result.current.filesLoaded).toBe(true);
  });

  it('does not add an upload to the previous KB\'s list before the open KB\'s list loaded', async () => {
    const pending = deferred<{ data: FileEntry }>();
    vi.mocked(axios.post).mockImplementation(() => pending.promise);
    vi.mocked(axios.get).mockResolvedValueOnce({ data: [row('f-x', 'x.pdf', 'completed')] });
    const other = { ...kb, id: 'kb-2' } as KnowledgeBase;

    const { result, rerender } = renderHook(({ currentKb }) => useFileManagement({ currentKb }), { initialProps: { currentKb: kb } });
    await act(() => result.current.fetchFiles(kb.id));
    rerender({ currentKb: other });
    act(() => { void result.current.uploadFiles([new File(['b'], 'b.pdf')]); });
    vi.mocked(axios.get).mockImplementation(() => new Promise(() => {}));
    await act(async () => pending.resolve({ data: row('f-b', 'b.pdf') }));

    expect(result.current.files.map(f => f.id)).toEqual(['f-x']);
    expect(result.current.filesLoaded).toBe(false);
  });

  it('drops a list response for a KB that is no longer open', async () => {
    const late = deferred<{ data: FileEntry[] }>();
    vi.mocked(axios.get).mockImplementationOnce(() => late.promise);
    const other = { ...kb, id: 'kb-2' } as KnowledgeBase;

    const { result, rerender } = renderHook(({ currentKb }) => useFileManagement({ currentKb }), { initialProps: { currentKb: kb } });
    act(() => { void result.current.fetchFiles(kb.id); });
    rerender({ currentKb: other });
    vi.mocked(axios.get).mockResolvedValueOnce({ data: [row('f-x', 'x.pdf', 'completed')] });
    await act(() => result.current.fetchFiles(other.id));
    await act(async () => late.resolve({ data: [row('f-a', 'a.pdf', 'completed')] }));

    expect(result.current.files.map(f => f.id)).toEqual(['f-x']);
    expect(result.current.filesLoaded).toBe(true);
  });

  it('does not bring back a file deleted before its upload response arrived', async () => {
    const pending = deferred<{ data: FileEntry }>();
    vi.mocked(axios.post).mockImplementation(() => pending.promise);
    vi.mocked(axios.delete).mockResolvedValue({});
    // The poll already sees the new row while the POST response is on its way.
    vi.mocked(axios.get).mockResolvedValueOnce({ data: [row('f-a', 'a.pdf')] });

    const { result, unmount } = renderHook(() => useFileManagement({ currentKb: kb }));
    let done!: Promise<void>;
    act(() => { done = result.current.uploadFiles([new File(['a'], 'a.pdf')]); });
    await act(() => result.current.fetchFiles(kb.id));
    await act(() => result.current.deleteFiles(['f-a']));
    // The batch's closing list request stays open: only the POST response counts.
    vi.mocked(axios.get).mockImplementation(() => new Promise(() => {}));
    await act(async () => pending.resolve({ data: row('f-a', 'a.pdf') }));

    expect(result.current.uploads).toEqual([]);
    expect(result.current.files).toEqual([]);
    void done;
    unmount();
  });
});
