import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useWebTools } from './useWebTools';
import { authFetch } from '../api';
import type { KnowledgeBase } from '../types';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get: vi.fn(), post: vi.fn() } };
});
vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  authFetch: vi.fn(),
}));
vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({ t: (k: string) => k, language: 'de' }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => toast }));

const kb = { id: 'kb-1', name: 'K' } as KnowledgeBase;
const RAW = 'upstream: tavily returned 432';

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

beforeEach(() => {
  vi.mocked(axios.get).mockReset();
  vi.mocked(axios.post).mockReset();
  vi.mocked(authFetch).mockReset();
  for (const fn of Object.values(toast)) fn.mockReset();
});

const setup = () => renderHook(() => useWebTools({ currentKb: kb, fetchFiles: vi.fn().mockResolvedValue(undefined) }));

// Oracle: docs/user-error-messages.md B21–B23 — an uncoded 400/404 shows the
// action's own message, never the backend's `error` text or an SSE frame's.
describe.each([400, 404])('useWebTools on an uncoded %i', (status) => {
  it('web search shows taskFailed', async () => {
    vi.mocked(axios.post).mockRejectedValue(refusal(status));
    const { result } = setup();
    await act(async () => { await result.current.handleToolSubmit('websearch', 'query'); });
    expect(toast.error).toHaveBeenCalledWith('taskFailed');
    expect(JSON.stringify(toast.error.mock.calls)).not.toContain(RAW);
  });

  it('adding selected pages shows addSourcesFailed', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ data: { results: [{ title: 'T', url: 'https://x', snippet: 's', content: 'c' }] } });
    const { result } = setup();
    await act(async () => { await result.current.handleToolSubmit('websearch', 'query'); });
    vi.mocked(axios.post).mockRejectedValue(refusal(status));
    await act(async () => { await result.current.handleAddSources(); });
    expect(toast.error).toHaveBeenCalledWith('addSourcesFailed');
    expect(JSON.stringify(toast.error.mock.calls)).not.toContain(RAW);
  });

  it('web research shows webResearchFailed in the toast and the status line', async () => {
    vi.mocked(authFetch).mockResolvedValue(new Response(JSON.stringify({ error: RAW }), { status }));
    const { result } = setup();
    act(() => result.current.setToolInput('topic'));
    await act(async () => { await result.current.handleWebResearch(); });
    expect(toast.error).toHaveBeenCalledWith('webResearchFailed');
    expect(result.current.webResearchStatus).toBe('webResearchFailed');
    expect(JSON.stringify(toast.error.mock.calls)).not.toContain(RAW);
  });
});

describe('useWebTools web research', () => {
  it('shows webResearchFailed for an SSE error frame, not its message', async () => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', message: RAW })}\n\n`));
        c.close();
      },
    });
    vi.mocked(authFetch).mockResolvedValue(new Response(body, { status: 200 }));
    const { result } = setup();
    act(() => result.current.setToolInput('topic'));
    await act(async () => { await result.current.handleWebResearch(); });
    expect(result.current.webResearchStatus).toBe('webResearchFailed');
  });

  it('shows the service message when no response arrives', async () => {
    vi.mocked(authFetch).mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = setup();
    act(() => result.current.setToolInput('topic'));
    await act(async () => { await result.current.handleWebResearch(); });
    expect(toast.error).toHaveBeenCalledWith('errorServiceUnavailable');
  });
});
