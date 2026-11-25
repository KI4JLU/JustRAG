import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { stubViewport } from '../test/viewport';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import App from './App';
import { translations } from '../i18n/translations';
import { goToSsoLogin, reloadPage } from '../routing/sessionExpiry';
import { POST_LOGIN_PATH_KEY } from '../routing/postLoginPath';
import { SESSION_KEY } from '../components/translator/translatorSessionStorage';

/* What a 401 does to a signed-in app: the session ended, the user did not log
 * out. Renders the real App and Login; the signed-in half is a stub, since
 * only its presence matters here. The network is stubbed, and the one step
 * jsdom cannot take — leaving the page for the SSO login.
 *
 * Oracles: translations.ts for the hint, and the two endpoints' paths from
 * API.md (`/auth/oidc/login` starts a login, `/auth/logout` and
 * `/auth/oidc/logout` end a session). */

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    defaults: { headers: { common: {} as Record<string, string> } },
    interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() }, request: { use: vi.fn(() => 2), eject: vi.fn() } },
  },
}));

/** The signed-in app's `toast.error`, as a request's catch handler holds it after the app is gone. */
let reportError: (message: string) => void = () => {};

// A caller whose request failed with the session reports its own error.
vi.mock('./AuthenticatedApp', async () => {
  const { useToast } = await import('../contexts/ToastContext');
  const { useAuth } = await import('../contexts/AuthContext');
  const { Button } = await import('@ki4jlu/design-system');
  return {
    default: function SignedInApp() {
      const toast = useToast();
      const { logout } = useAuth();
      reportError = toast.error;
      return (
        <>
          <Button>signed-in app</Button>
          <Button onClick={() => void logout()}>log out</Button>
        </>
      );
    },
  };
});

vi.mock('../routing/sessionExpiry', async (importActual) => ({
  ...(await importActual<typeof import('../routing/sessionExpiry')>()),
  goToSsoLogin: vi.fn(),
  reloadPage: vi.fn(),
}));

const mockedGet = axios.get as unknown as Mock;
const mockedPost = axios.post as unknown as Mock;

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    setItem: (k: string, v: string) => { data.set(k, v); },
  } as Storage;
}

let fetchMock: Mock;

function signIn(authMethod: 'oidc' | 'local') {
  localStorage.setItem('token', 'old-token');
  localStorage.setItem('user', JSON.stringify({ id: 'u1', username: 'alice', role: 'user', authMethod }));
}

beforeEach(() => {
  vi.clearAllMocks();
  stubViewport();
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve('') }));
  vi.stubGlobal('fetch', fetchMock);
  localStorage.setItem('language', 'en');
  window.history.replaceState(null, '', '/shared?x=1');
  mockedGet.mockImplementation((url: string) => {
    if (url.endsWith('/api/site-config')) return Promise.resolve({ data: {} });
    if (url.endsWith('/api/auth/providers')) {
      return Promise.resolve({ data: { providers: [{ id: 'p1', type: 'oidc', name: 'SSO' }], localAuthEnabled: true } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A request made through authFetch (api.ts) answered 401; `token` is the one it was sent with. */
function expire(token: string | null = 'old-token') {
  act(() => { window.dispatchEvent(new CustomEvent('auth:unauthorized', { detail: { token } })); });
}

/** A request made through axios answered 401: runs the interceptor AppRoot registered. */
function expireThroughAxios(token = 'old-token', registration = -1) {
  const use = axios.interceptors.response.use as unknown as Mock;
  const onRejected = use.mock.calls.at(registration)![1] as (error: unknown) => Promise<never>;
  let rejection: Promise<never>;
  act(() => {
    rejection = onRejected({ response: { status: 401 }, config: { headers: { Authorization: `Bearer ${token}` } } });
  });
  return rejection!;
}

/** The translator's text, stored in the tab by the user who is signed in. */
function storeTranslatorSession() {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: 'u1', translate: { source: 'Vertraulich' } }));
}

describe('App — the translator’s text when the session ends', () => {
  it('is forgotten on logout', async () => {
    signIn('local');
    storeTranslatorSession();
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'log out' }));

    expect(await screen.findByLabelText(translations.username.en)).toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('is forgotten when a 401 ends the session, for a password user', async () => {
    signIn('local');
    storeTranslatorSession();
    render(<App />);
    await screen.findByText('signed-in app');

    expire();

    expect(await screen.findByText(translations.sessionExpired.en)).toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('is forgotten when a 401 sends an SSO user to sign in again', async () => {
    signIn('oidc');
    storeTranslatorSession();
    render(<App />);
    await screen.findByText('signed-in app');

    expire();

    expect(goToSsoLogin).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('stays when a late 401 for an earlier session is ignored', async () => {
    localStorage.setItem('token', 'new-token');
    localStorage.setItem('user', JSON.stringify({ id: 'u1', username: 'alice', role: 'user', authMethod: 'local' }));
    storeTranslatorSession();
    render(<App />);
    await screen.findByText('signed-in app');

    expire('old-token');

    expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull();
  });
});

describe('App — an expired session', () => {
  it('sends an SSO user through the SSO login again, back to the same page, and logs out nowhere', async () => {
    signIn('oidc');
    render(<App />);
    await screen.findByText('signed-in app');

    expire();
    expire(); // several requests fail together: one re-login

    expect(goToSsoLogin).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(POST_LOGIN_PATH_KEY)).toBe('/shared?x=1');
    expect(localStorage.getItem('token')).toBeNull();
    // Neither the app's logout nor the provider's.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the login page with a hint when the SSO re-login just ran', async () => {
    signIn('oidc');
    sessionStorage.setItem('ssoReauthAt', String(Date.now()));
    render(<App />);
    await screen.findByText('signed-in app');

    expire();

    expect(await screen.findByText(translations.sessionExpired.en)).toBeInTheDocument();
    expect(goToSsoLogin).not.toHaveBeenCalled();
  });

  it('shows a password user the login page with the hint, on the same URL', async () => {
    signIn('local');
    render(<App />);
    await screen.findByText('signed-in app');

    expire();

    expect(await screen.findByText(translations.sessionExpired.en)).toBeInTheDocument();
    expect(goToSsoLogin).not.toHaveBeenCalled();
    expect(window.location.pathname + window.location.search).toBe('/shared?x=1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ends the session for a 401 on an axios request too, and passes the error on', async () => {
    signIn('local');
    render(<App />);
    await screen.findByText('signed-in app');

    await expect(expireThroughAxios()).rejects.toMatchObject({ response: { status: 401 } });

    expect(await screen.findByText(translations.sessionExpired.en)).toBeInTheDocument();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('ignores a late 401 for the token of the session before this one', async () => {
    localStorage.setItem('token', 'new-token');
    localStorage.setItem('user', JSON.stringify({ id: 'u1', username: 'alice', role: 'user', authMethod: 'local' }));
    render(<App />);
    await screen.findByText('signed-in app');

    expire('old-token');
    await expireThroughAxios('old-token').catch(() => {});

    expect(localStorage.getItem('token')).toBe('new-token');
    expect(screen.getByText('signed-in app')).toBeInTheDocument();
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('starts over when another tab has signed in since', async () => {
    signIn('local');
    render(<App />);
    await screen.findByText('signed-in app');
    // The shared storage holds the other tab's session, possibly another user's.
    localStorage.setItem('token', 'new-token');

    expire('old-token');
    expire('old-token');

    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('token')).toBe('new-token');
    expect(screen.queryByText(translations.sessionExpired.en)).not.toBeInTheDocument();
  });

  it('starts over, and keeps the stored session, when the 401 is for the other tab\'s token', async () => {
    signIn('local');
    render(<App />);
    await screen.findByText('signed-in app');
    localStorage.setItem('token', 'new-token');

    // authFetch reads the shared storage: the request went out with the other tab's token.
    expire('new-token');

    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('token')).toBe('new-token');
  });

  it('ignores a late 401 for an older token after another tab cleared the storage', async () => {
    signIn('local');
    render(<App />);
    await screen.findByText('signed-in app');
    localStorage.removeItem('token');

    expire('older-token');

    expect(screen.getByText('signed-in app')).toBeInTheDocument();
    expect(screen.queryByText(translations.sessionExpired.en)).not.toBeInTheDocument();
  });

  it('lets the SSO login in the URL win over a session another tab stored meanwhile', async () => {
    signIn('local');
    const payload = { token: 'sso-token', user: { id: 'u2', username: 'bob', role: 'user', authMethod: 'oidc' } };
    window.history.replaceState(null, '', `/#oidc=${btoa(JSON.stringify(payload))}`);

    render(<App />);

    await screen.findByText('signed-in app');
    expect(localStorage.getItem('token')).toBe('sso-token');
    expect(JSON.parse(localStorage.getItem('user')!).username).toBe('bob');
    expect(window.location.hash).toBe('');
  });

  it('ends the session for a tokenless 401 once another tab has ended the shared one', async () => {
    signIn('local');
    render(<App />);
    await screen.findByText('signed-in app');
    localStorage.removeItem('token'); // authFetch then has no token to send

    expire(null);

    expect(await screen.findByText(translations.sessionExpired.en)).toBeInTheDocument();
  });

  it('ends a session whose first request is answered through the handler registered before the login', async () => {
    mockedPost.mockResolvedValue({ data: { token: 'fresh-token', user: { id: 'u1', username: 'alice', role: 'user', authMethod: 'local' } } });
    render(<App />);
    await userEvent.type(await screen.findByLabelText(translations.username.en), 'alice');
    await userEvent.type(screen.getByLabelText(translations.password.en), 'secret');
    await userEvent.click(screen.getByRole('button', { name: translations.login.en }));
    await screen.findByText('signed-in app');

    // The interceptor of the logged-out app: the one a child's first request still goes through.
    await expireThroughAxios('fresh-token', 0).catch(() => {});

    expect(await screen.findByText(translations.sessionExpired.en)).toBeInTheDocument();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('sends an SSO user to the SSO login when that first request is the one that fails', async () => {
    const payload = { token: 'sso-token', user: { id: 'u2', username: 'bob', role: 'user', authMethod: 'oidc' } };
    window.history.replaceState(null, '', `/#oidc=${btoa(JSON.stringify(payload))}`);
    render(<App />);
    await screen.findByText('signed-in app');

    await expireThroughAxios('sso-token', 0).catch(() => {});

    expect(goToSsoLogin).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(translations.sessionExpired.en)).not.toBeInTheDocument();
  });

  it('leaves the session alone for a 401 on a request sent without a token', async () => {
    signIn('local');
    render(<App />);
    await screen.findByText('signed-in app');

    expire(null);

    expect(localStorage.getItem('token')).toBe('old-token');
    expect(screen.getByText('signed-in app')).toBeInTheDocument();
  });

  it('shows the login page when the SSO login was not reached', async () => {
    signIn('oidc');
    render(<App />);
    await screen.findByText('signed-in app');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      expire();
      expect(goToSsoLogin).toHaveBeenCalledTimes(1);
      expect(axios.defaults.headers.common['Authorization']).toBeUndefined();
      expect(screen.getByText('signed-in app')).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(10_000); });
    } finally {
      vi.useRealTimers();
    }

    expect(await screen.findByText(translations.sessionExpired.en)).toBeInTheDocument();
  });

  it('drops the error toasts of the requests that failed with the session', async () => {
    signIn('local');
    render(<App />);
    await screen.findByText('signed-in app');

    act(() => { reportError('load failed 1'); });
    expect(await screen.findByText('load failed 1')).toBeInTheDocument(); // the oracle: it shows otherwise

    act(() => {
      window.dispatchEvent(new CustomEvent('auth:unauthorized', { detail: { token: 'old-token' } }));
      reportError('load failed 2'); // before the next render, as a catch handler runs
    });

    await screen.findByText(translations.sessionExpired.en);
    expect(screen.queryByText('load failed 2')).not.toBeInTheDocument();
  });
});
