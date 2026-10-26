import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { stubViewport } from './test/viewport';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import App from './App';
import { translations } from './translations';
import { POST_LOGIN_PATH_KEY } from './routing/postLoginPath';
import { toShortId } from './routing/shortId';

const KB_ID = 'd0ddefd4-6ccd-49a5-a7f0-2f1eba3c8141';
const KB_GONE = '0f0f0f0f-0000-4000-8000-000000000001';
const C7 = 'bfe5f9d2-dba3-4d0f-af2d-f55fde1f33a8';
const C8 = '6f9619ff-8b86-4011-b42d-00c04fc964ff';
const C404 = '0f0f0f0f-0000-4000-8000-000000000404';
/** The URLs, written as the app writes them (short ids). */
const KB_URL = `/kb/${toShortId(KB_ID)}`;
const chatUrl = (id: string) => `/c/${toShortId(id)}`;

/* ---------------------------------------------------------------------------
 * Every view has a URL, and the browser's history moves between them.
 *
 * Rendered through the real <App />, so the router, the route tree and the
 * authenticated app's view switch are all the production ones; only the
 * network is stubbed.
 *
 * ORACLES: `window.location` for "the URL names the view" (the browser's own
 * state, which the router writes through `history`), translations.ts plus
 * WAI-ARIA's h1 mapping for "this view is on screen", and the recorded GET
 * URLs for "the topic was loaded by id".
 * ------------------------------------------------------------------------- */

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    isAxiosError: (e: unknown) => !!(e && typeof e === 'object' && 'isAxiosError' in e),
    defaults: { headers: { common: {} as Record<string, string> } },
    interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() } },
  },
}));

const mockedGet = axios.get as unknown as Mock;

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

const KB1 = {
  id: KB_ID, name: 'Prüfungsordnungen', description: null, userId: 'user-1',
  createdAt: '2026-01-01T00:00:00Z', isPro: false, isGlobal: false, myRole: 'owner',
  aiConfigId: null, chatModel: null, embeddingModel: null, rerankModel: null, ttsModel: null,
};

const CHAT = (id: string, title: string) => ({
  id, kbId: KB_ID, userId: 'user-1', title, type: 'chat',
  createdAt: '2026-09-20T09:00:00Z', updatedAt: '2026-09-20T10:00:00Z', teamId: null, agentId: null,
});
const CHATS = [CHAT(C7, 'Prüfungsdauer'), CHAT(C8, 'Pflichtmodule')];
/** chat id → the AI answer; each appears in exactly one response. */
const ANSWERS: Record<string, string> = {
  [C7]: 'Die mündliche Prüfung dauert 30 Minuten.',
  [C8]: 'Pflicht sind die Module A und B.',
};

const notFound = () => Promise.reject(Object.assign(new Error('not found'), {
  isAxiosError: true, response: { status: 404, data: { error: 'not found' } },
}));

function routeGets() {
  mockedGet.mockImplementation((url: string) => {
    const u = String(url);
    if (u.endsWith('/api/site-config')) return Promise.resolve({ data: {} });
    if (u.endsWith('/api/auth/providers')) {
      return Promise.resolve({ data: { providers: [{ id: 'p1', type: 'oidc', name: 'Uni-SSO' }], localAuthEnabled: true } });
    }
    if (u.endsWith(`/api/kb/${KB_ID}`)) return Promise.resolve({ data: KB1 });
    if (u.endsWith(`/api/kb/${KB_ID}/chats`)) return Promise.resolve({ data: CHATS });
    const one = u.match(/\/api\/chats\/([0-9a-f-]{36})$/);
    if (one) {
      const row = CHATS.find((c) => c.id === one[1]);
      return row ? Promise.resolve({ data: row }) : notFound();
    }
    const msg = u.match(/\/api\/chats\/([0-9a-f-]{36})\/messages$/);
    if (msg && ANSWERS[msg[1]]) {
      return Promise.resolve({ data: [
        { id: `${msg[1]}-u`, parentMessageId: null, role: 'user', content: `Frage ${msg[1]}` },
        { id: `${msg[1]}-a`, parentMessageId: `${msg[1]}-u`, role: 'ai', content: ANSWERS[msg[1]] },
      ] });
    }
    if (u.endsWith(`/api/kb/${KB_GONE}`)) return notFound();
    return Promise.resolve({ data: [] });
  });
}

function signIn(role = 'user') {
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({ id: 'user-1', username: 'grace', role }));
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  stubViewport();
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ text: () => Promise.resolve('<p>Document body</p>') })));
  window.history.replaceState(null, '', '/');
  localStorage.setItem('language', 'de');
  routeGets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The lazy AuthenticatedApp chunk is a real module load; see the sibling suites. */
const SLOW = { timeout: 15000 };

const heading = (key: keyof typeof translations) =>
  screen.findByRole('heading', { level: 1, name: translations[key].de }, SLOW);

const workspaceSearch = () => screen.findByRole(
  'combobox',
  { name: translations.workspaceSearchPlaceholder.de.replace('{topic}', KB1.name) },
  SLOW,
);

const path = () => window.location.pathname;

/** jsdom's history traversal is asynchronous (it fires popstate later). */
async function goBack() {
  await act(async () => { window.history.back(); });
}
async function goForward() {
  await act(async () => { window.history.forward(); });
}

describe('App routing — signed in', () => {
  beforeEach(() => signIn());

  it.each([
    ['/', 'myTopics'],
    ['/shared', 'sharedTopics'],
    ['/discover', 'discoverTopics'],
    ['/tools', 'tools'],
  ] as const)('opens %s directly on its view', async (url, key) => {
    window.history.replaceState(null, '', url);
    render(<App />);
    expect(await heading(key)).toBeInTheDocument();
    expect(path()).toBe(url);
  });

  it('writes the view into the URL and walks back and forward through it', async () => {
    render(<App />);
    await heading('myTopics');

    await userEvent.click(screen.getByRole('button', { name: translations.sharedTopics.de }));
    await heading('sharedTopics');
    expect(path()).toBe('/shared');

    await userEvent.click(screen.getByRole('button', { name: translations.discoverTopics.de }));
    await heading('discoverTopics');
    expect(path()).toBe('/discover');

    await goBack();
    await heading('sharedTopics');
    expect(path()).toBe('/shared');

    await goBack();
    await heading('myTopics');
    expect(path()).toBe('/');

    await goForward();
    await heading('sharedTopics');
    expect(path()).toBe('/shared');
  });

  it('opens a topic from its URL by loading it by id', async () => {
    window.history.replaceState(null, '', KB_URL);
    render(<App />);

    expect(await workspaceSearch()).toBeInTheDocument();
    expect(mockedGet.mock.calls.some(([u]) => String(u).endsWith(`/api/kb/${KB_ID}`))).toBe(true);
    expect(path()).toBe(KB_URL);
  });

  it('returns from a topic to the overview with the back button', async () => {
    render(<App />);
    await heading('myTopics');
    await act(async () => { window.history.pushState(null, '', KB_URL); window.dispatchEvent(new PopStateEvent('popstate')); });
    await workspaceSearch();

    await goBack();
    expect(await heading('myTopics')).toBeInTheDocument();
    expect(path()).toBe('/');
  });

  it('replaces the URL of a topic that cannot be opened with the overview', async () => {
    window.history.replaceState(null, '', `/kb/${toShortId(KB_GONE)}`);
    render(<App />);

    expect(await heading('myTopics')).toBeInTheDocument();
    await waitFor(() => expect(path()).toBe('/'));
  });

  it('replaces an unknown path with the overview', async () => {
    window.history.replaceState(null, '', '/no/such/page');
    render(<App />);

    expect(await heading('myTopics')).toBeInTheDocument();
    await waitFor(() => expect(path()).toBe('/'));
  });

  it('opens the legal pages from their URL', async () => {
    window.history.replaceState(null, '', '/privacy');
    render(<App />);
    expect(await heading('privacyPolicyTitle')).toBeInTheDocument();
  });
});

describe('App routing — chats', () => {
  beforeEach(() => signIn());

  const answer = (id: string) => screen.findByText(ANSWERS[id], {}, SLOW);

  it('opens a chat from its URL', async () => {
    window.history.replaceState(null, '', chatUrl(C7));
    render(<App />);
    expect(await answer(C7)).toBeInTheDocument();
    expect(path()).toBe(chatUrl(C7));
  });

  it('walks back and forward between chats and the new chat', async () => {
    window.history.replaceState(null, '', chatUrl(C7));
    render(<App />);
    await answer(C7);

    await act(async () => { window.history.pushState(null, '', chatUrl(C8)); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(await answer(C8)).toBeInTheDocument();
    expect(screen.queryByText(ANSWERS[C7])).not.toBeInTheDocument();

    await goBack();
    expect(await answer(C7)).toBeInTheDocument();
    expect(path()).toBe(chatUrl(C7));

    await act(async () => { window.history.pushState(null, '', KB_URL); window.dispatchEvent(new PopStateEvent('popstate')); });
    await waitFor(() => expect(screen.queryByText(ANSWERS[C7])).not.toBeInTheDocument());
  });

  it('writes a chat picked in the history into the URL, as a step back can undo', async () => {
    window.history.replaceState(null, '', KB_URL);
    render(<App />);
    await workspaceSearch();

    await userEvent.click(await screen.findByText('Pflichtmodule', {}, SLOW));
    expect(await answer(C8)).toBeInTheDocument();
    await waitFor(() => expect(path()).toBe(chatUrl(C8)));

    await goBack();
    await waitFor(() => expect(path()).toBe(KB_URL));
    await waitFor(() => expect(screen.queryByText(ANSWERS[C8])).not.toBeInTheDocument());
  });

  // Oracle: DOM node identity. A remount anywhere above the question replays
  // its entrance animation (the slide-in seen when the server confirmed it).
  it('keeps the question mounted when the server confirms it and the chat gets its URL', async () => {
    // A stream the test feeds frame by frame.
    const encoder = new TextEncoder();
    const queue: Uint8Array[] = [];
    let ended = false;
    let wake: (() => void) | null = null;
    const push = (frame: unknown) => {
      queue.push(encoder.encode(`data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`));
      wake?.();
    };
    const reader = {
      read: () => new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
        const next = () => {
          if (queue.length) resolve({ done: false, value: queue.shift()! });
          else if (ended) resolve({ done: true, value: undefined });
          else wake = () => { wake = null; next(); };
        };
        next();
      }),
      cancel: async () => {},
      releaseLock: () => {},
    };
    const fallback = vi.fn(() => Promise.resolve({ text: () => Promise.resolve('') }));
    vi.stubGlobal('fetch', vi.fn((url: string) => (String(url).includes('/chat?stream=true')
      ? Promise.resolve({ ok: true, status: 200, headers: new Headers(), body: { getReader: () => reader } })
      : fallback())));

    // The composer sends only in a topic with a source.
    const gets = mockedGet.getMockImplementation()!;
    mockedGet.mockImplementation((url: string) => (String(url).includes(`/api/kb/${KB_ID}/files`)
      ? Promise.resolve({ data: [{ id: '0f0f0f0f-0000-4000-8000-0000000f11e5', name: 'po.pdf', status: 'completed', kbId: KB_ID }] })
      : gets(url)));

    window.history.replaceState(null, '', KB_URL);
    render(<App />);
    const input = await screen.findByRole('textbox', { name: /./ }, SLOW);
    await waitFor(() => expect(input).toBeEnabled());
    await userEvent.type(input, 'Wie lange dauert es?{Enter}');
    const question = await screen.findByText('Wie lange dauert es?');

    await act(async () => {
      push({ chatId: C8, userMessageId: '0f0f0f0f-0000-4000-8000-00000000aaaa' });
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() => expect(path()).toBe(chatUrl(C8)));
    // The same DOM node: nothing above it remounted, so nothing replays its entrance.
    expect(question.isConnected).toBe(true);
    expect(screen.getByText('Wie lange dauert es?')).toBe(question);

    await act(async () => { push('[DONE]'); ended = true; wake?.(); });
  });

  it('sends a chat that is not the caller\'s (or gone) to the overview', async () => {
    window.history.replaceState(null, '', chatUrl(C404));
    render(<App />);
    expect(await heading('myTopics')).toBeInTheDocument();
    await waitFor(() => expect(path()).toBe('/'));
  });
});

describe('App routing — settings dialogs', () => {
  it('opens the user settings on the tab ?settings= names', async () => {
    signIn();
    window.history.replaceState(null, '', '/shared?settings=chat');
    render(<App />);
    const dialog = await screen.findByRole('dialog', { name: translations.settings.de }, SLOW);
    expect(within(dialog).getByRole('heading', { level: 2, name: translations.settingsChat.de })).toBeInTheDocument();
    // The page underneath stays the one the path names.
    expect(path()).toBe('/shared');
  });

  it('opens the admin console on the section ?admin= names, for an admin', async () => {
    signIn('admin');
    window.history.replaceState(null, '', '/?admin=users');
    render(<App />);
    const dialog = await screen.findByRole('dialog', { name: translations.adminDashboard.de }, SLOW);
    expect(within(dialog).getByRole('heading', { level: 2, name: translations.adminTabUsers.de })).toBeInTheDocument();
  });

  it('ignores and strips ?admin= for a user without a system admin role', async () => {
    signIn();
    window.history.replaceState(null, '', '/?admin=users');
    render(<App />);
    await heading('myTopics');
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(screen.queryByRole('dialog', { name: translations.adminDashboard.de })).not.toBeInTheDocument();
  });

  it('opens a topic\'s settings on the section ?topic= names', async () => {
    signIn();
    window.history.replaceState(null, '', `${KB_URL}?topic=roles`);
    render(<App />);
    const dialog = await screen.findByRole('dialog', { name: translations.kbSettingsTitle.de }, SLOW);
    expect(within(dialog).getByRole('heading', { level: 2, name: translations.kbSettingsTabRoles.de })).toBeInTheDocument();
  });
});

describe('App routing — agents', () => {
  it('opens the teams tab from its URL', async () => {
    signIn();
    window.history.replaceState(null, '', '/agents/teams');
    render(<App />);
    const teams = await screen.findByRole('button', { name: translations.agentsTabTeams.de }, SLOW);
    expect(teams).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('App routing — before sign-in', () => {
  it('opens a legal page from its URL without signing in', async () => {
    window.history.replaceState(null, '', '/terms');
    render(<App />);
    expect(await heading('termsOfUseTitle')).toBeInTheDocument();
  });

  it('puts the legal page in the URL when its footer link is used', async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: translations.accessibility.de }));
    await heading('accessibilityTitle');
    expect(path()).toBe('/accessibility');
  });

  it('returns to the requested page after single sign-on', async () => {
    // 1. A signed-out visitor opens a topic link and presses the SSO button.
    window.history.replaceState(null, '', KB_URL);
    const first = render(<App />);
    const sso = await screen.findByRole('link', { name: /Uni-SSO/ });
    // The navigation itself is the browser's; only the parking is ours.
    sso.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(sso);
    expect(sessionStorage.getItem(POST_LOGIN_PATH_KEY)).toBe(KB_URL);
    first.unmount();

    // 2. The identity provider sends them back to "/" with the token in the fragment.
    const payload = btoa(JSON.stringify({ token: 'sso-token', user: { id: 'user-1', username: 'grace', role: 'user' } }));
    window.history.replaceState(null, '', `/#oidc=${payload}`);
    render(<App />);

    // 3. They land on the topic they asked for, and the parked path is gone.
    expect(await workspaceSearch()).toBeInTheDocument();
    expect(path()).toBe(KB_URL);
    expect(window.location.hash).toBe('');
    expect(sessionStorage.getItem(POST_LOGIN_PATH_KEY)).toBeNull();
  });
});
