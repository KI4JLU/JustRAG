import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import axios, { AxiosError, AxiosHeaders } from 'axios';
import { useGitRepoLookup, LOOKUP_DEBOUNCE_MS } from './useGitRepoLookup';

const ok = { data: { repoUrl: 'https://github.com/o/r', urlBranch: '', defaultBranch: 'main', branches: ['main', 'dev'], truncated: false } };

function rejection(status: number, code?: string) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('x', 'ERR', config, null, { status, statusText: '', headers: {}, config, data: code ? { error: 'x', code } : { error: 'x' } });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS); });
}

// Oracle: POST /api/kb/{id}/git-repos/lookup in API.md.
describe('useGitRepoLookup', () => {
  it('stays idle and sends nothing for an incomplete URL', async () => {
    const post = vi.spyOn(axios, 'post');
    const { result } = renderHook(() => useGitRepoLookup('kb1', 'https://github.com/o', '', false, true));
    await settle();
    expect(result.current).toEqual({ status: 'idle' });
    expect(post).not.toHaveBeenCalled();
  });

  it('waits for the token of a private repository', async () => {
    const post = vi.spyOn(axios, 'post');
    renderHook(() => useGitRepoLookup('kb1', 'https://github.com/o/r', '', true, true));
    await settle();
    expect(post).not.toHaveBeenCalled();
  });

  it('posts the normalised URL once the input settles and reports the branches', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue(ok);
    const { result } = renderHook(() => useGitRepoLookup('kb1', 'https://github.com/o/r/pulls', '', false, true));
    expect(result.current.status).toBe('checking');
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toMatch(/\/api\/kb\/kb1\/git-repos\/lookup$/);
    expect(post.mock.calls[0][1]).toEqual({ repoUrl: 'https://github.com/o/r', accessToken: undefined });
    expect(result.current).toEqual({ status: 'ok', repoUrl: 'https://github.com/o/r', defaultBranch: 'main', branches: ['main', 'dev'], truncated: false });
  });

  it('debounces typing into one request', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue(ok);
    const { rerender } = renderHook(({ url }) => useGitRepoLookup('kb1', url, '', false, true), { initialProps: { url: 'https://github.com/o/r' } });
    rerender({ url: 'https://github.com/o/re' });
    rerender({ url: 'https://github.com/o/rep' });
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toEqual({ repoUrl: 'https://github.com/o/rep', accessToken: undefined });
  });

  it.each([
    ['not_found', 'not_found'],
    ['auth_failed', 'auth_failed'],
    [undefined, 'check_failed'],
  ])('maps a refusal with code %s to %s', async (code, reason) => {
    vi.spyOn(axios, 'post').mockRejectedValue(rejection(code ? 422 : 429, code));
    const { result } = renderHook(() => useGitRepoLookup('kb1', 'https://github.com/o/r', '', false, true));
    await settle();
    expect(result.current).toEqual({ status: 'error', reason });
  });
});
