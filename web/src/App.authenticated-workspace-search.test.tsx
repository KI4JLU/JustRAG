import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { stubViewport } from './test/viewport';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import App from './App';
import { translations } from './translations';

/* ---------------------------------------------------------------------------
 * The workspace header's topic-scoped search, on the real route (KI-838).
 *
 * The route into the workspace is the header search itself (a chat hit,
 * KI-837), so every test starts inside topic kb-1 with chat-7 on screen. From
 * there it exercises what only the workspace does:
 *  - the request carries `kb_id=kb-1` and the field NAMES the topic;
 *  - a hit in the SAME topic swaps the chat or opens the preview WITHOUT
 *    reopening the topic (reopening runs `handleNewChat`, which would replace
 *    the chat on screen with an empty one);
 *  - „search all topics" repeats the SAME text without `kb_id`, keeps the
 *    caret, and a hit in ANOTHER topic then navigates there;
 *  - widening lasts one query: reopening the list searches scoped again;
 *  - a 404 on the scoped request is an inline state, not an error toast.
 *
 * ONLY the network is stubbed (axios and `fetch`), plus what jsdom cannot do:
 * pointer capture and `scrollIntoView`. No provider, context or app hook is
 * mocked.
 *
 * ORACLES, independent of the code under test:
 *  - the recorded request URLs — with or without `kb_id`, and how often
 *    `GET /api/kb/kb-1` (the topic open) was requested;
 *  - fixture text that reaches the DOM through exactly one response each
 *    (message bodies, the preview file's body);
 *  - translations.ts for every accessible name, WAI-ARIA's combobox roles,
 *    and `document.activeElement`.
 * ------------------------------------------------------------------------- */

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
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

/* -- Fixtures ------------------------------------------------------------- */

const kb = (id: string, name: string) => ({
  id, name, description: null, userId: 'user-1',
  createdAt: '2026-01-01T00:00:00Z', isPro: false, isGlobal: false, myRole: 'owner',
  aiConfigId: null, chatModel: null, embeddingModel: null, rerankModel: null, ttsModel: null,
});
const KB1 = kb('11111111-1111-4111-8111-111111111111', 'Prüfungsordnungen');
const KB2 = kb('22222222-2222-4222-8222-222222222222', 'Statistik');

const chatEntry = (id: string, kbId: string, title: string) => ({
  id, kbId, userId: 'user-1', title, type: 'chat',
  createdAt: '2026-09-20T09:00:00Z', updatedAt: '2026-09-20T10:00:00Z', teamId: null, agentId: null,
});
const chatHit = (id: string, kbId: string, kbName: string, title: string) => ({
  id, title, type: 'chat', kbId, kbName, updatedAt: '2026-09-20T10:00:00Z', match: 'prefix',
});

/** chat id → [user turn, AI turn]; each body appears in exactly one response. */
const MESSAGES: Record<string, [string, string]> = {
  '77777777-7777-4777-8777-777777777777': ['Wie lange dauert die mündliche Prüfung?', 'Die mündliche Prüfung dauert 30 Minuten.'],
  '88888888-8888-4888-8888-888888888888': ['Welche Module sind Pflicht?', 'Pflicht sind die Module A und B.'],
  '99999999-9999-4999-8999-999999999999': ['Was ist ein Median?', 'Der Median ist der mittlere Wert.'],
};
const PREVIEW_BODY = 'Paragraph 12 regelt die Wiederholung von Prüfungen.';

const empty = { topics: [], sources: [], chats: [], messages: [] };
/** Header search (no kb_id), used to enter the workspace. */
const ENTRY_SEARCH = { query: 'Prüf', kbId: null, ...empty, chats: [chatHit('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', 'Prüfungsordnungen', 'Prüfungsfragen')] };
/** Scoped to kb-1: a second chat and a markdown source of the same topic. */
const SCOPED_SEARCH = {
  query: 'x', kbId: '11111111-1111-4111-8111-111111111111', ...empty,
  // A topic hit for kb-1 too: scoped mode must not render it.
  topics: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Prüfungsordnungen', description: null, visibility: 'private', role: 'owner', match: 'prefix' }],
  sources: [{ id: 'f-1', name: 'Wiederholung.md', type: 'md', kbId: '11111111-1111-4111-8111-111111111111', kbName: 'Prüfungsordnungen', match: 'prefix' }],
  chats: [chatHit('88888888-8888-4888-8888-888888888888', '11111111-1111-4111-8111-111111111111', 'Prüfungsordnungen', 'Modulwahl')],
};
/** Widened (no kb_id, q=Stat): a topic and a chat in ANOTHER topic. */
const WIDE_SEARCH = {
  query: 'Stat', kbId: null, ...empty,
  topics: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Statistik', description: null, visibility: 'private', role: 'owner', match: 'prefix' }],
  chats: [chatHit('99999999-9999-4999-8999-999999999999', '22222222-2222-4222-8222-222222222222', 'Statistik', 'Statistik-Grundlagen')],
};

let scopedSearch: () => Promise<unknown> = () => Promise.resolve({ data: SCOPED_SEARCH });

function routeGets() {
  mockedGet.mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes('/api/search?')) {
      const params = new URLSearchParams(u.slice(u.indexOf('?') + 1));
      if (params.get('kb_id') === '11111111-1111-4111-8111-111111111111') return scopedSearch();
      return Promise.resolve({ data: params.get('q') === 'Stat' ? WIDE_SEARCH : ENTRY_SEARCH });
    }
    if (/\/api\/kb\/11111111-1111-4111-8111-111111111111$/.test(u)) return Promise.resolve({ data: KB1 });
    if (/\/api\/kb\/22222222-2222-4222-8222-222222222222$/.test(u)) return Promise.resolve({ data: KB2 });
    if (u.endsWith('/api/kb/11111111-1111-4111-8111-111111111111/chats')) {
      return Promise.resolve({ data: [chatEntry('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', 'Prüfungsfragen'), chatEntry('88888888-8888-4888-8888-888888888888', '11111111-1111-4111-8111-111111111111', 'Modulwahl')] });
    }
    if (u.endsWith('/api/kb/22222222-2222-4222-8222-222222222222/chats')) return Promise.resolve({ data: [chatEntry('99999999-9999-4999-8999-999999999999', '22222222-2222-4222-8222-222222222222', 'Statistik-Grundlagen')] });
    // A chat hit is re-read through GET /api/chats/{id} (its sticky team/agent).
    const one = u.match(/\/api\/chats\/([0-9a-f-]{36})$/);
    if (one) {
      const rows = [
        chatEntry('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', 'Prüfungsfragen'),
        chatEntry('88888888-8888-4888-8888-888888888888', '11111111-1111-4111-8111-111111111111', 'Modulwahl'),
        chatEntry('99999999-9999-4999-8999-999999999999', '22222222-2222-4222-8222-222222222222', 'Statistik-Grundlagen'),
      ];
      const row = rows.find((c) => c.id === one[1]);
      if (row) return Promise.resolve({ data: row });
    }
    const msg = u.match(/\/api\/chats\/([0-9a-f-]{36})\/messages$/);
    if (msg && MESSAGES[msg[1]]) {
      const [user, ai] = MESSAGES[msg[1]];
      return Promise.resolve({
        data: [
          { id: `${msg[1]}-u`, parentMessageId: null, role: 'user', content: user },
          { id: `${msg[1]}-a`, parentMessageId: `${msg[1]}-u`, role: 'ai', content: ai },
        ],
      });
    }
    if (u.endsWith('/api/files/f-1/download')) return Promise.resolve({ data: PREVIEW_BODY });
    return Promise.resolve({ data: [] });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  scopedSearch = () => Promise.resolve({ data: SCOPED_SEARCH });
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  stubViewport();
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  window.history.replaceState(null, '', '/');
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({ id: 'user-1', username: 'grace', role: 'user' }));
  localStorage.setItem('language', 'de');
  routeGets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -- Helpers -------------------------------------------------------------- */

const urls = () => mockedGet.mock.calls.map(([u]) => String(u));
const count = (re: RegExp) => urls().filter((u) => re.test(u)).length;
const searchUrls = () => urls().filter((u) => u.includes('/api/search?'));
const scopedName = translations.workspaceSearchPlaceholder.de.replace('{topic}', 'Prüfungsordnungen');

/** Boots the app and enters topic kb-1 with chat-7 on screen, via the header search. */
async function enterWorkspace() {
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: translations.myTopics.de }, { timeout: 15000 });
  await userEvent.type(screen.getByRole('combobox', { name: translations.globalSearchPlaceholder.de }), 'Prüf');
  await userEvent.click(await screen.findByRole('option', { name: /Prüfungsfragen/ }, { timeout: 2000 }));
  await screen.findByText(MESSAGES['77777777-7777-4777-8777-777777777777'][1], {}, { timeout: 5000 });
  return screen.getByRole('combobox', { name: scopedName });
}

const activeOption = (field: HTMLElement) => document.getElementById(field.getAttribute('aria-activedescendant') ?? '');

describe('App — the workspace header search, scoped to the open topic', () => {
  it('names the topic, sends kb_id, and omits the Topics group', async () => {
    const field = await enterWorkspace();
    // ORACLE: translations.ts with the fixture's topic name — the scope is in
    // the accessible name, i.e. audible, and in the placeholder.
    expect(field).toHaveAttribute('placeholder', scopedName);

    await userEvent.type(field, 'Modul');
    const listbox = await screen.findByRole('listbox', { name: translations.globalSearchResults.de });
    await within(listbox).findByRole('option', { name: /Modulwahl/ });

    // ORACLE: the recorded URL. One scoped request, for the final text.
    expect(searchUrls().filter((u) => u.includes('kb_id='))).toEqual([
      expect.stringMatching(/\/api\/search\?q=Modul&kb_id=11111111-1111-4111-8111-111111111111$/),
    ]);
    // The fixture carries a topic hit; scoped mode shows no Topics group.
    expect(within(listbox).queryByRole('group', { name: translations.globalSearchGroupTopics.de })).toBeNull();
    expect(within(listbox).getByRole('option', { name: translations.workspaceSearchAllTopics.de })).toBeInTheDocument();
  }, 30000);

  it('swaps to a chat of the SAME topic without reopening the topic', async () => {
    const field = await enterWorkspace();
    const topicOpens = count(/\/api\/kb\/11111111-1111-4111-8111-111111111111$/);
    expect(topicOpens).toBe(1);

    await userEvent.type(field, 'Modul');
    await screen.findByRole('option', { name: /Modulwahl/ });
    await waitFor(() => expect(activeOption(field)).toHaveTextContent('Wiederholung.md'));
    await userEvent.keyboard('{ArrowDown}');
    expect(activeOption(field)).toHaveTextContent('Modulwahl');
    await userEvent.keyboard('{Enter}');

    // ORACLE: chat-8's bodies replace chat-7's — the chosen chat, not an
    // empty new one — and the topic was NOT requested a second time, i.e.
    // `handleOpenKbById` (and with it `handleNewChat`) did not run.
    expect(await screen.findByText(MESSAGES['88888888-8888-4888-8888-888888888888'][1], {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText(MESSAGES['77777777-7777-4777-8777-777777777777'][1])).toBeNull();
    expect(count(/\/api\/kb\/11111111-1111-4111-8111-111111111111$/)).toBe(topicOpens);
  }, 30000);

  it('opens a source of the SAME topic in the preview and keeps the chat on screen', async () => {
    const field = await enterWorkspace();
    const topicOpens = count(/\/api\/kb\/11111111-1111-4111-8111-111111111111$/);

    await userEvent.type(field, 'Wied');
    await userEvent.click(await screen.findByRole('option', { name: /Wiederholung\.md/ }));

    // ORACLE: the file body, which only `GET /api/files/f-1/download` carries…
    expect(await screen.findByText(PREVIEW_BODY, {}, { timeout: 5000 })).toBeInTheDocument();
    // …while chat-7 is still the chat (a reopen would have emptied it)…
    expect(screen.getByText(MESSAGES['77777777-7777-4777-8777-777777777777'][1])).toBeInTheDocument();
    // …and the topic was not requested again.
    expect(count(/\/api\/kb\/11111111-1111-4111-8111-111111111111$/)).toBe(topicOpens);
  }, 30000);

  it('widens the same text to all topics with the caret kept, and a hit elsewhere navigates there', async () => {
    const field = await enterWorkspace();
    await userEvent.type(field, 'Stat');
    await screen.findByRole('option', { name: translations.workspaceSearchAllTopics.de });

    // The widen row is the LAST option; the list loops, so ↑ from the first
    // lands on it. Keyboard-reachable, and announced as the active option.
    await waitFor(() => expect(activeOption(field)).not.toBeNull());
    await userEvent.keyboard('{ArrowUp}');
    expect(activeOption(field)).toHaveAccessibleName(translations.workspaceSearchAllTopics.de);
    await userEvent.keyboard('{Enter}');

    // ORACLE: the recorded URL — the same q, now WITHOUT kb_id.
    await waitFor(() => expect(searchUrls()).toContainEqual(expect.stringMatching(/\/api\/search\?q=Stat$/)));
    const widened = await screen.findByRole('option', { name: /Statistik-Grundlagen/ });
    // Text and caret intact; the field's name says it is no longer scoped.
    expect(document.activeElement).toBe(field);
    expect(field).toHaveValue('Stat');
    expect(field).toHaveAccessibleName(translations.globalSearchPlaceholder.de);
    // Widened results have a Topics group, and no second widen row.
    expect(screen.getByRole('group', { name: translations.globalSearchGroupTopics.de })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: translations.workspaceSearchAllTopics.de })).toBeNull();

    // A hit in ANOTHER topic navigates like the header: topic, then chat.
    await userEvent.click(widened);
    expect(await screen.findByText(MESSAGES['99999999-9999-4999-8999-999999999999'][1], {}, { timeout: 5000 })).toBeInTheDocument();
    expect(count(/\/api\/kb\/22222222-2222-4222-8222-222222222222$/)).toBe(1);
    // …and the field now names the new topic.
    expect(screen.getByRole('combobox', {
      name: translations.workspaceSearchPlaceholder.de.replace('{topic}', 'Statistik'),
    })).toBeInTheDocument();
  }, 30000);

  it('starts scoped again when the list is reopened after widening', async () => {
    const field = await enterWorkspace();
    await userEvent.type(field, 'Stat');
    await userEvent.click(await screen.findByRole('option', { name: translations.workspaceSearchAllTopics.de }));
    await screen.findByRole('option', { name: /Statistik-Grundlagen/ });

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    const before = searchUrls().length;
    await userEvent.keyboard('{ArrowDown}');

    // ORACLE: the next request is scoped again, for the same text.
    await waitFor(() => expect(searchUrls().length).toBe(before + 1));
    expect(searchUrls().at(-1)).toMatch(/\/api\/search\?q=Stat&kb_id=11111111-1111-4111-8111-111111111111$/);
    expect(field).toHaveAccessibleName(scopedName);
    expect(document.activeElement).toBe(field);
  }, 30000);

  it('says the topic is unavailable on a 404, offers all topics, and raises no toast', async () => {
    scopedSearch = () => Promise.reject({ response: { status: 404 } });
    const field = await enterWorkspace();
    await userEvent.type(field, 'Modul');

    const line = await screen.findByText(translations.workspaceSearchTopicUnavailable.de, {}, { timeout: 2000 });
    expect(line).toHaveAttribute('role', 'status');
    expect(screen.queryByText(translations.globalSearchError.de)).toBeNull();
    // The combobox registers its items after mount; on a slow runner the
    // option can land a tick after the status line.
    expect(await screen.findByRole('option', { name: translations.workspaceSearchAllTopics.de }, { timeout: 2000 })).toBeInTheDocument();
    const toasts = document.querySelector('.toast-container');
    expect(toasts).not.toBeNull();
    expect(toasts!.textContent).toBe('');
    expect(document.activeElement).toBe(field);
  }, 30000);
});
