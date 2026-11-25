import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useRssFeeds } from './useRssFeeds';
import { useGitRepoSources } from './useGitRepoSources';
import { useConfluenceSources } from './useConfluenceSources';
import type { KnowledgeBase } from '../types';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: { ...actual.default, get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));

const kb = { id: 'kb-1', name: 'K' } as KnowledgeBase;
const RAW = 'pq: duplicate key value violates unique constraint';

/** An axios refusal with the backend's English text and no `code`. */
function refusal(status: number): AxiosError {
  const err = new AxiosError('Request failed');
  err.response = {
    data: { error: RAW },
    status,
    statusText: '',
    headers: {},
    config: { headers: {} } as unknown as InternalAxiosRequestConfig,
  };
  return err;
}

function refuseEverything(status: number) {
  const err = refusal(status);
  vi.mocked(axios.post).mockRejectedValue(err);
  vi.mocked(axios.put).mockRejectedValue(err);
  vi.mocked(axios.patch).mockRejectedValue(err);
  vi.mocked(axios.delete).mockRejectedValue(err);
}

beforeEach(() => {
  vi.mocked(axios.get).mockReset().mockResolvedValue({ data: [] });
  vi.mocked(axios.post).mockReset();
  vi.mocked(axios.put).mockReset();
  vi.mocked(axios.patch).mockReset();
  vi.mocked(axios.delete).mockReset();
  for (const fn of Object.values(toast)) fn.mockReset();
});

/** The toast shown for the action, which must be the key and never RAW. */
function expectFallback(key: string) {
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith(key);
  expect(JSON.stringify(toast.error.mock.calls)).not.toContain(RAW);
}

// Oracle: docs/user-error-messages.md B11–B17 — an uncoded 400/404 shows the
// action's own message (userErrorMessage's fallbackKey), never `error`.
describe.each([400, 404])('synced-source hooks on an uncoded %i', (status) => {
  const fetchFiles = vi.fn().mockResolvedValue(undefined);

  it.each([
    ['add', 'rssFeedAddFailed', (h: ReturnType<typeof useRssFeeds>) => h.addRssFeed('https://x/feed', 'manual', false)],
    ['update', 'rssFeedUpdateFailed', (h: ReturnType<typeof useRssFeeds>) => h.updateRssFeed('f1', { status: 'paused' })],
    ['delete', 'rssFeedDeleteFailed', (h: ReturnType<typeof useRssFeeds>) => h.deleteRssFeeds(['f1'])],
    ['poll', 'rssPollFailed', (h: ReturnType<typeof useRssFeeds>) => h.pollFeedNow('f1')],
  ])('RSS %s shows %s', async (_action, key, run) => {
    refuseEverything(status);
    const { result } = renderHook(() => useRssFeeds({ currentKb: kb, fetchFiles }));
    await act(async () => { await run(result.current); });
    expectFallback(key);
  });

  it.each([
    ['add', 'gitRepoAddFailed', (h: ReturnType<typeof useGitRepoSources>) => h.addGitRepoSource({ repoUrl: 'https://x/r.git', isPrivate: false })],
    ['update', 'gitRepoUpdateFailed', (h: ReturnType<typeof useGitRepoSources>) => h.updateGitRepoSource('g1', { status: 'paused' })],
    ['delete', 'gitRepoDeleteFailed', (h: ReturnType<typeof useGitRepoSources>) => h.deleteGitRepoSources(['g1'])],
    ['sync', 'gitRepoSyncFailed', (h: ReturnType<typeof useGitRepoSources>) => h.syncGitRepoNow('g1')],
  ])('Git %s shows %s', async (_action, key, run) => {
    refuseEverything(status);
    const { result } = renderHook(() => useGitRepoSources({ currentKb: kb, fetchFiles }));
    await act(async () => { await run(result.current); });
    expectFallback(key);
  });

  it.each([
    ['save connection', 'confluenceProfileSaveError', (h: ReturnType<typeof useConfluenceSources>) => h.saveConnection('tok').catch(() => undefined)],
    ['add', 'confluenceSourceAddFailed', (h: ReturnType<typeof useConfluenceSources>) => h.addSource({ spaceKey: 'ENG' })],
    ['update', 'confluenceSourceUpdateFailed', (h: ReturnType<typeof useConfluenceSources>) => h.updateSource('c1', { status: 'paused' })],
    ['delete', 'confluenceSourceDeleteFailed', (h: ReturnType<typeof useConfluenceSources>) => h.deleteSources(['c1'])],
    ['sync', 'confluenceSyncFailed', (h: ReturnType<typeof useConfluenceSources>) => h.syncNow('c1')],
    ['page children', 'confluencePagesLoadError', (h: ReturnType<typeof useConfluenceSources>) => h.fetchPageChildren('p1')],
    ['all pages', 'confluencePagesLoadError', (h: ReturnType<typeof useConfluenceSources>) => h.fetchAllSpacePages('ENG')],
  ])('Confluence %s shows %s', async (_action, key, run) => {
    // A connection is loaded first: addSource needs its id.
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { connection: { id: 'conn-1', status: 'active' }, baseUrl: 'https://wiki', enabled: true },
    });
    const { result } = renderHook(() => useConfluenceSources({ currentKb: kb, fetchFiles }));
    await act(async () => { await result.current.fetchConnectionInfo(); });
    refuseEverything(status);
    vi.mocked(axios.get).mockRejectedValue(refusal(status));
    await act(async () => { await run(result.current); });
    expectFallback(key);
  });
});
