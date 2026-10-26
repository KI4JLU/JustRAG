import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import axios, { AxiosError, AxiosHeaders } from 'axios';
import { useFileManagement } from './useFileManagement';
import { useRssFeeds } from './useRssFeeds';
import { useConfluenceSources } from './useConfluenceSources';
import { useGitRepoSources } from './useGitRepoSources';
import type { KbCapabilities, KnowledgeBase } from '../types';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get: vi.fn() } };
});
const toastError = vi.fn();
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: toastError, warning: vi.fn(), info: vi.fn() }),
}));
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));
vi.mock('../contexts/ModalContext', () => ({ useModalContext: () => ({ showConfirm: vi.fn() }) }));

const kb = { id: 'kb-2', name: 'K' } as KnowledgeBase;
const failWith = (status: number) => new AxiosError('x', String(status), undefined, undefined, {
  status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: {},
});

beforeEach(() => { vi.mocked(axios.get).mockReset(); toastError.mockReset(); });

// ORACLE: API.md "Source permissions" — without seeSources the file list is a
// 403. The UI shows no list then (KbWorkspaceLayout), so that 403 is an empty
// list, not an error to report; any other failure still is one.
describe('useFileManagement.fetchFiles', () => {
  it('treats a 403 as an empty list, silently, and drops the previous KB\'s files', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 'old', name: 'old.pdf' }] });
    const { result, rerender } = renderHook(({ currentKb }) => useFileManagement({ currentKb }),
      { initialProps: { currentKb: { ...kb, id: 'kb-1' } } });
    await act(async () => { await result.current.fetchFiles('kb-1'); });
    expect(result.current.files).toHaveLength(1);

    rerender({ currentKb: kb });
    vi.mocked(axios.get).mockRejectedValueOnce(failWith(403));
    await act(async () => { await result.current.fetchFiles('kb-2'); });
    expect(result.current.files).toEqual([]);
    expect(result.current.filesLoaded).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('drops the previous KB\'s files on any other failure too, but keeps its own on a failed refresh', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ id: 'old', name: 'old.pdf' }] });
    const { result, rerender } = renderHook(({ currentKb }) => useFileManagement({ currentKb }),
      { initialProps: { currentKb: { ...kb, id: 'kb-1' } } });
    await act(async () => { await result.current.fetchFiles('kb-1'); });

    vi.mocked(axios.get).mockRejectedValueOnce(failWith(500));
    await act(async () => { await result.current.fetchFiles('kb-1'); });
    expect(result.current.files).toHaveLength(1);

    rerender({ currentKb: kb });
    vi.mocked(axios.get).mockRejectedValueOnce(failWith(500));
    await act(async () => { await result.current.fetchFiles('kb-2'); });
    expect(result.current.files).toEqual([]);
  });

  it('still reports any other failure', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(failWith(500));
    const { result } = renderHook(() => useFileManagement({ currentKb: kb }));
    await act(async () => { await result.current.fetchFiles('kb-2'); });
    expect(toastError).toHaveBeenCalledWith('filesFetchError');
  });
});

// ORACLE: API.md "Source permissions" — without seeSources every source list
// (files, RSS, Confluence, git) answers 403, and the UI shows no list there.
// So none of the four is requested at all; the lists read empty. Against a
// backend without capabilities all four are requested exactly as before.
describe('source lists without seeSources', () => {
  const caps = (seeSources: boolean): KbCapabilities => ({
    seeSources, addSources: false, downloadSources: false, seeCitations: true, manageSources: false,
  });
  const kbWith = (capabilities?: KbCapabilities) => ({ id: 'kb-9', name: 'K', capabilities }) as KnowledgeBase;

  // What useKbLifecycle and AuthenticatedApp do when a KB opens.
  const openKb = async (currentKb: KnowledgeBase) => {
    const { result } = renderHook(() => {
      const fileMgmt = useFileManagement({ currentKb });
      const fetchFiles = fileMgmt.fetchFiles;
      return {
        fileMgmt,
        rss: useRssFeeds({ currentKb, fetchFiles }),
        confluence: useConfluenceSources({ currentKb, fetchFiles }),
        git: useGitRepoSources({ currentKb, fetchFiles }),
      };
    });
    await act(async () => {
      await result.current.fileMgmt.fetchFiles(currentKb.id);
      await result.current.rss.fetchRssFeeds(currentKb.id);
      await result.current.confluence.fetchSources(currentKb.id);
      await result.current.git.fetchGitRepoSources(currentKb.id);
    });
    return result;
  };

  it('requests none of the four lists and holds them empty', async () => {
    const result = await openKb(kbWith(caps(false)));
    expect(axios.get).not.toHaveBeenCalled();
    expect(result.current.fileMgmt.files).toEqual([]);
    expect(result.current.fileMgmt.filesLoaded).toBe(true);
    expect(result.current.rss.rssFeeds).toEqual([]);
    expect(result.current.confluence.confluenceSources).toEqual([]);
    expect(result.current.git.gitRepoSources).toEqual([]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it.each([
    ['with seeSources', caps(true)],
    ['from a backend without capabilities', undefined],
  ])('requests all four %s', async (_name, capabilities) => {
    vi.mocked(axios.get).mockResolvedValue({ data: [] });
    await openKb(kbWith(capabilities));
    const urls = vi.mocked(axios.get).mock.calls.map(([u]) => String(u));
    expect(urls).toEqual([
      expect.stringContaining('/api/kb/kb-9/files'),
      expect.stringContaining('/api/kb/kb-9/rss'),
      expect.stringContaining('/api/kb/kb-9/confluence-sources'),
      expect.stringContaining('/api/kb/kb-9/git-repos'),
    ]);
  });
});
