import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { errorInfo } from '../utils/userErrors';
import { normalizeRepoUrl } from '../utils/repoUrl';

/** Delay after the last keystroke before the repository is looked up. */
export const LOOKUP_DEBOUNCE_MS = 500;

/** Why a lookup said no: the backend's 422 codes, or `check_failed` when the check itself failed (rate limit, network). */
export type GitRepoLookupFailure = 'not_found' | 'auth_failed' | 'empty' | 'unreachable' | 'check_failed';

export type GitRepoLookup =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; repoUrl: string; defaultBranch: string; branches: string[]; truncated: boolean }
  | { status: 'error'; reason: GitRepoLookupFailure };

const IDLE: GitRepoLookup = { status: 'idle' };
const CHECKING: GitRepoLookup = { status: 'checking' };

const VERDICTS = new Set<GitRepoLookupFailure>(['not_found', 'auth_failed', 'empty', 'unreachable']);

interface LookupResponse {
  repoUrl: string;
  urlBranch: string;
  defaultBranch: string;
  branches: string[];
  truncated: boolean;
}

/**
 * Checks a repository URL against the forge while the add dialog is open
 * (`POST /api/kb/{id}/git-repos/lookup`, an ls-remote without a clone): is it
 * a repository, and which branches does it have. Runs once the URL is
 * well-formed and, for a private repository, a token is present; a newer
 * input aborts the request still in flight.
 */
export function useGitRepoLookup(kbId: string, repoUrl: string, accessToken: string, isPrivate: boolean, enabled: boolean): GitRepoLookup {
  const normalized = normalizeRepoUrl(repoUrl)?.url ?? null;
  const token = isPrivate ? accessToken.trim() : '';
  const ready = enabled && normalized !== null && (!isPrivate || token !== '');
  // The answer is stored with the input it belongs to; until the answer for
  // the current input arrives the lookup reads as "checking" — derived
  // during render, so the effect only sets state from the async callback.
  const key = ready ? JSON.stringify([kbId, normalized, token]) : '';
  const [answer, setAnswer] = useState<{ key: string; result: GitRepoLookup } | null>(null);

  useEffect(() => {
    if (key === '' || normalized === null) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await axios.post<LookupResponse>(
          `${API_BASE_URL}/api/kb/${kbId}/git-repos/lookup`,
          { repoUrl: normalized, accessToken: token || undefined },
          { signal: controller.signal },
        );
        setAnswer({ key, result: {
          status: 'ok',
          repoUrl: res.data.repoUrl,
          defaultBranch: res.data.defaultBranch,
          branches: res.data.branches,
          truncated: res.data.truncated,
        } });
      } catch (err) {
        if (axios.isCancel(err)) return;
        const code = errorInfo(err).code as GitRepoLookupFailure | undefined;
        setAnswer({ key, result: { status: 'error', reason: code && VERDICTS.has(code) ? code : 'check_failed' } });
      }
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, kbId, normalized, token]);

  if (key === '') return IDLE;
  return answer?.key === key ? answer.result : CHECKING;
}
