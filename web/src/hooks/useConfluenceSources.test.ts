import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import axios from 'axios';
import { useConfluenceSources } from './useConfluenceSources';
import type { KnowledgeBase } from '../types';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get: vi.fn(), post: vi.fn(), put: vi.fn() } };
});
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));
vi.mock('../contexts/ModalContext', () => ({ useModalContext: () => ({ showConfirm: vi.fn() }) }));

const kb = { id: 'kb-1', name: 'K' } as KnowledgeBase;
const conn = (id: string) => ({ id, displayName: 'me', status: 'active' });

beforeEach(() => {
  vi.mocked(axios.get).mockReset();
  vi.mocked(axios.post).mockReset();
  vi.mocked(axios.put).mockReset();
});

// ORACLE: go-backend/internal/confluence/http.go — GET /api/confluence/connections
// answers {connection, baseUrl, enabled}; POST and PUT answer the bare
// connection. Saving a token must keep the info's enabled/baseUrl, or
// ConfluenceModal falls into its "integration not enabled" branch.
describe('useConfluenceSources.saveConnection', () => {
  const load = async (connection: ReturnType<typeof conn> | null) => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { connection, baseUrl: 'https://wiki.example', enabled: true },
    });
    const hook = renderHook(() => useConfluenceSources({ currentKb: kb, fetchFiles: vi.fn() }));
    await act(async () => { await hook.result.current.fetchConnectionInfo(); });
    return hook;
  };

  it('keeps enabled and baseUrl on a first-time save (POST)', async () => {
    const { result } = await load(null);
    vi.mocked(axios.post).mockResolvedValueOnce({ data: conn('c-1') });
    await act(async () => { await result.current.saveConnection('tok'); });
    expect(axios.put).not.toHaveBeenCalled();
    expect(result.current.confluenceConnection).toEqual({
      connection: conn('c-1'), baseUrl: 'https://wiki.example', enabled: true,
    });
  });

  it('keeps enabled and baseUrl on a reconnect (PUT)', async () => {
    const { result } = await load(conn('c-1'));
    vi.mocked(axios.put).mockResolvedValueOnce({ data: conn('c-1') });
    await act(async () => { await result.current.saveConnection('tok'); });
    expect(axios.post).not.toHaveBeenCalled();
    expect(result.current.confluenceConnection).toEqual({
      connection: conn('c-1'), baseUrl: 'https://wiki.example', enabled: true,
    });
  });
});
