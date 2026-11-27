import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import axios from 'axios';
import { installKbPreviewInterceptor, setKbPreview } from '../preview/kbPreview';
import { Loader2 } from 'lucide-react';
import type { User as UserType } from '../types';
import { API_BASE_URL } from '../api';
import { SITE_CONFIG_UPDATED_EVENT } from '../utils/siteConfigEvents';
import { appNameFrom, applyAppNameToDocument, rememberAppName, siteConfigSeed } from '../utils/appName';
import { ThemeProvider } from '../contexts/ThemeContext';
import { AuthProvider } from '../contexts/AuthContext';
import { MobileProvider } from '../contexts/MobileContext';
import { ToastProvider } from '../contexts/ToastContext';
import { viewportHeight } from '../utils/viewport';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { ToastStack } from '../components/ui/ToastStack';
import { AppUpdateProvider } from '../contexts/AppUpdateContext';
import { useVersionCheck } from '../hooks/useVersionCheck';
import { goToSsoLogin, reloadPage, startSsoReauth } from '../routing/sessionExpiry';
import { clearStoredSession } from '../components/translator/translatorSessionStorage';
// Lazy load
const Login = lazy(() => import('../pages/Login'));
const AuthenticatedApp = lazy(() => import('./AuthenticatedApp'));

const LoadingFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: viewportHeight('100dvh', '100vh'), width: '100%' }}>
    <Loader2 className="animate-spin" size={32} color="var(--accent-primary)" />
  </div>
);

/** How often an open, visible tab re-reads the site config (system notice). */
const SITE_CONFIG_REFRESH_MS = 120_000;

/** How long error toasts stay muted after the session ended. */
const ERROR_TOAST_MUTE_MS = 5_000;

/** How long the app waits for the navigation to the SSO login before it shows its own login page. */
const SSO_LEAVE_TIMEOUT_MS = 10_000;

/** The URL carries the result of an SSO login (Login.tsx reads it). That login
 * is the one the user just made, so it starts the app — not a session another
 * tab stored in the meantime, which would leave the fragment unread. */
function returningFromSso(): boolean {
  return window.location.hash.startsWith('#oidc=');
}

/** The token of an `Authorization: Bearer …` header value, or null. */
function bearerToken(header: unknown): string | null {
  const value = typeof header === 'string' ? header : '';
  return value.startsWith('Bearer ') ? value.slice('Bearer '.length) : null;
}


function sameConfigs(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => a[k] === b[k]);
}

/** The app shell: global providers, then the login screen or the signed-in app. Rendered by the root route (routing/routes.ts). */
export function AppRoot() {
  // Detect server restarts and reload to pick up new assets
  useVersionCheck();

  // Auth state
  const [user, setUser] = useState<UserType | null>(() => {
    if (returningFromSso()) return null;
    const saved = localStorage.getItem('user');
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      return null;
    }
  });
  // The login page is showing because the session ended (see handleSessionExpired).
  const [sessionExpired, setSessionExpired] = useState(false);
  const [token, setToken] = useState<string | null>(() => {
    const saved = returningFromSso() ? null : localStorage.getItem('token');
    // Set axios auth header immediately so it's available before any child effects fire
    if (saved) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${saved}`;
    }
    return saved;
  });
  // This tab's token and user for code that must not wait for a render: the
  // 401 handlers are registered in an effect, and a request a child sends
  // right after a login is answered through the ones registered before it.
  const tokenRef = useRef(token);
  const applyToken = useCallback((next: string | null) => {
    tokenRef.current = next;
    setToken(next);
  }, []);
  const userRef = useRef(user);
  const applyUser = useCallback((next: UserType | null) => {
    // A preview belongs to the session that started it: logout, an expired
    // session or another account ends it before the next session's requests.
    if (next?.id !== userRef.current?.id) setKbPreview(null);
    userRef.current = next;
    setUser(next);
  }, []);

  // Config state (needed for Login too). It starts with the app name the
  // server wrote into the page (or, on a page the service worker serves, the
  // one this browser saw last), so neither the wordmark nor the tab title
  // shows the default while /api/site-config is in flight.
  const [siteConfigs, setSiteConfigs] = useState<Record<string, string>>(() => siteConfigSeed());
  // The browser tab shows the app name (institution_name + system_name, else
  // APP_NAME_PREFIX / APP_NAME_PRODUCT), on the login page too.
  const { prefix: appNamePrefix, product: appNameProduct } = appNameFrom(siteConfigs);
  useEffect(() => {
    const name = { prefix: appNamePrefix, product: appNameProduct };
    applyAppNameToDocument(name);
    rememberAppName(name);
    // The desktop app draws its icon from the system's name (its first letter).
    window.nativeShell?.setAppName?.(appNameProduct);
  }, [appNamePrefix, appNameProduct]);

  // Auth handlers
  // SECURITY (tracked follow-up): the JWT lives in localStorage, which is
  // readable by any script on the page. The hardened design is an
  // HttpOnly;Secure;SameSite cookie set by the backend, which would also
  // require CSRF tokens and reworking the Bearer-header axios/SSE/OIDC flows.
  // Deferred as a deliberate decision; CSP + a short token TTL are the interim
  // mitigations. See the security review (2026-05-26).
  const handleLogout = useCallback(async () => {
    const currentToken = token;
    const wasOidc = user?.authMethod === 'oidc';

    // Best-effort server-side JWT blacklist. Uses fetch (not axios) so the
    // global 401-auto-logout interceptor can't recurse if the token is
    // already expired. Browsers also don't send Authorization on top-level
    // navigation, so the blacklist has to happen here before we hand off
    // to /api/auth/oidc/logout.
    if (currentToken) {
      try {
        await fetch(`${API_BASE_URL}/api/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${currentToken}` },
        });
      } catch {
        // ignore — local state still gets cleared
      }
    }

    localStorage.removeItem('token');
    localStorage.removeItem('user');
    // The translator's text is the signed-in user's: the next one in this tab must not find it.
    clearStoredSession();

    if (wasOidc) {
      // Top-level nav to the OIDC logout endpoint — it discovers the IdP's
      // end_session_endpoint and redirects through the IdP so the SSO session
      // is killed too. Don't touch React state; the page is going away.
      window.location.href = `${API_BASE_URL}/api/auth/oidc/logout`;
      return;
    }

    applyToken(null);
    applyUser(null);
  }, [token, user, applyToken, applyUser]);

  // The token stopped being accepted (a 401): expired after its lifetime, or
  // revoked. That is not the user logging out, so the single-sign-on session
  // is left alone — an SSO user is sent through the SSO login again and comes
  // back to this page, without a prompt while the provider's session lives.
  // Everyone else, and an SSO re-login that just failed, gets the login page
  // on the current URL. Several requests fail together; only the first acts.
  // Requests in flight fail with the session; their error toasts would only
  // repeat what the login page says (ToastProvider's muteErrors).
  const errorToastsMuted = useRef(false);
  const areErrorToastsMuted = useCallback(() => errorToastsMuted.current, []);
  const unmuteTimer = useRef<number | undefined>(undefined);
  const leaveTimer = useRef<number | undefined>(undefined);
  const expiring = useRef(false);

  // The login page, on the current URL, saying why it is there.
  const showSessionExpiredLogin = useCallback(() => {
    delete axios.defaults.headers.common['Authorization'];
    setSessionExpired(true);
    applyToken(null);
    applyUser(null);
    expiring.current = false;
    // The failed requests have all reported by then; later errors on the
    // login page (a legal document that does not load) show again.
    window.clearTimeout(unmuteTimer.current);
    unmuteTimer.current = window.setTimeout(() => { errorToastsMuted.current = false; }, ERROR_TOAST_MUTE_MS);
  }, [applyToken, applyUser]);

  // A timer that outlives the app would act on whatever runs after it.
  useEffect(() => () => {
    window.clearTimeout(unmuteTimer.current);
    window.clearTimeout(leaveTimer.current);
  }, []);

  // `rejected` is the token the failed request was sent with, null when it
  // went out without one. This tab's session is its own token; the stored
  // one is shared with every other tab.
  const handleSessionExpired = useCallback((rejected: string | null) => {
    const current = tokenRef.current;
    if (expiring.current || !current) return;

    // Another tab has signed in since — possibly as someone else. This tab
    // starts over with that session instead of carrying its state across,
    // and leaves the stored credentials alone: they are not its own.
    const stored = localStorage.getItem('token');
    if (stored && stored !== current) {
      expiring.current = true;
      reloadPage();
      return;
    }

    if (rejected) {
      // A late answer for the token of an earlier session.
      if (rejected !== current) return;
    } else if (stored) {
      // A request sent without a token says nothing about the session —
      // unless it had none to send because another tab ended the shared one
      // (api.ts reads the stored token).
      return;
    }

    expiring.current = true;
    errorToastsMuted.current = true;
    window.clearTimeout(unmuteTimer.current);

    localStorage.removeItem('token');
    localStorage.removeItem('user');
    clearStoredSession();

    if (userRef.current?.authMethod === 'oidc'
      && startSsoReauth(window.location.pathname + window.location.search)) {
      // The page is going away. Should it still be here after
      // SSO_LEAVE_TIMEOUT_MS — the navigation did not happen, or the browser
      // brought this page back from its history — it shows the login page.
      delete axios.defaults.headers.common['Authorization'];
      goToSsoLogin();
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = window.setTimeout(showSessionExpiredLogin, SSO_LEAVE_TIMEOUT_MS);
      return;
    }

    showSessionExpiredLogin();
  }, [showSessionExpiredLogin]);

  // Keep the site config fresh while the app is open, so the system notice
  // follows its setting — switched on or off in the admin dialog or through
  // the API (a monitoring job) — without a reload. On focus, and every
  // SITE_CONFIG_REFRESH_MS while the tab is visible; an unchanged answer keeps
  // the old object, so nothing below re-renders.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      axios.get<Record<string, string>>(`${API_BASE_URL}/api/site-config`)
        .then(res => setSiteConfigs(prev => (sameConfigs(prev, res.data) ? prev : res.data)))
        .catch(() => { /* the next tick tries again */ });
    };
    const timer = window.setInterval(refresh, SITE_CONFIG_REFRESH_MS);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  // Auth/config setup + auto-logout on 401
  useEffect(() => {
    // Fetch site configs (react.dev fetch-then-set pattern: the state write
    // happens in the async callback, not synchronously in the effect body)
    axios.get(`${API_BASE_URL}/api/site-config`)
      .then(res => setSiteConfigs(res.data))
      .catch((err: unknown) => console.error('Failed to fetch site configs:', err));

    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }

    // A 401 means the token is expired or invalidated: the session is over
    const interceptor = axios.interceptors.response.use(
      response => response,
      error => {
        if (error.response?.status === 401) {
          handleSessionExpired(bearerToken(error.config?.headers?.Authorization));
        }
        return Promise.reject(error);
      }
    );

    // Every axios request for a previewed topic carries X-KB-Preview-Role.
    const removePreviewHeader = installKbPreviewInterceptor();

    // Also handle 401 from direct fetch() calls via authFetch
    // (api.ts names the token it sent).
    const onUnauthorized = (e: Event) => {
      handleSessionExpired((e as CustomEvent<{ token?: string | null } | null>).detail?.token ?? null);
    };
    window.addEventListener('auth:unauthorized', onUnauthorized);

    // An admin saved site-config keys (AdminUI): merge them in, so what the
    // shell renders from them (the system notice, the app name in logo and
    // tab title) changes at once.
    const onSiteConfigUpdated = (e: Event) => {
      const saved = (e as CustomEvent<Record<string, string>>).detail;
      setSiteConfigs(prev => ({ ...prev, ...saved }));
    };
    window.addEventListener(SITE_CONFIG_UPDATED_EVENT, onSiteConfigUpdated);

    return () => {
      axios.interceptors.response.eject(interceptor);
      removePreviewHeader();
      window.removeEventListener('auth:unauthorized', onUnauthorized);
      window.removeEventListener(SITE_CONFIG_UPDATED_EVENT, onSiteConfigUpdated);
    };
  }, [token, handleSessionExpired]);

  const handleLogin = (newToken: string, newUser: UserType) => {
    // Set axios auth header synchronously BEFORE state updates trigger re-render.
    // React runs child effects before parent effects, so AuthenticatedApp's
    // fetchKBs() would fire before App's useEffect sets the header.
    axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
    window.clearTimeout(unmuteTimer.current);
    window.clearTimeout(leaveTimer.current);
    errorToastsMuted.current = false;
    expiring.current = false;
    setSessionExpired(false);
    applyToken(newToken);
    applyUser(newUser);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
  };

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AppUpdateProvider>
        <MobileProvider>
          {/* -----------------------------------------------------------------
            * The app's ONE toast provider and ONE toast container (card
            * KI-740). Both used to sit in AuthenticatedApp, i.e. on the
            * authenticated half of the tree only — so `LegalPage`, which
            * calls `useToast()` unconditionally and which `Login` renders on
            * the unauthenticated route, threw `useToast must be used within
            * ToastProvider`. The terms, privacy and accessibility documents
            * are exactly the pages people open BEFORE signing in.
            *
            * There must stay exactly one of each in the tree. A second,
            * nested `ToastProvider` would give the authenticated subtree its
            * own store while a container mounted against the outer one
            * renders a permanently empty stack — toasts would appear on some
            * routes and vanish on others. Adding the provider here therefore
            * means REMOVING it from AuthenticatedApp, never duplicating it.
            *
            * Deliberately OUTSIDE `<Suspense>`, not inside it. `Login` and
            * `AuthenticatedApp` are both `lazy`, so every route switch makes
            * this boundary suspend, and React MAY discard a suspended
            * subtree's state — whether it does is a React implementation
            * detail, not a documented guarantee in either direction. Probed
            * on React 19 for card KI-740, a `useReducer` provider inside the
            * boundary KEPT its state across the lazy-sibling swap; that is a
            * measurement of this version's behaviour, not a promise about
            * the next one, and it is not what the placement rests on.
            * Outside the boundary the question does not arise at all: the
            * provider's lifetime is the app's, so no pending toast can
            * depend on how React treats suspended subtrees.
            * TODO: whether a suspended subtree keeps provider state is not
            * confirmed as stable across React versions — moving the provider
            * inside this boundary would make the toast queue's survival
            * depend on it, so don't.
            *
            * The stack is outside for a reason that IS established: it has to
            * survive the very route switch that raised the toast, which it
            * cannot do from inside the subtree being swapped. With nothing to
            * show it is an empty box that lets every click through (the
            * design system's toast stack), so mounting it on the login screen
            * costs nothing.
            * --------------------------------------------------------------- */}
          <ToastProvider muteErrors={areErrorToastsMuted}>
            <Suspense fallback={<LoadingFallback />}>
              {(!token || !user) ? (
                <Login
                  onLogin={handleLogin}
                  siteConfigs={siteConfigs}
                  sessionExpired={sessionExpired}
                />
              ) : (
                <AuthProvider
                  user={user}
                  token={token}
                  siteConfigs={siteConfigs}
                  logout={handleLogout}
                >
                  <ErrorBoundary>
                    <AuthenticatedApp />
                  </ErrorBoundary>
                </AuthProvider>
              )}
            </Suspense>
            <ToastStack />
          </ToastProvider>
        </MobileProvider>
        </AppUpdateProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
