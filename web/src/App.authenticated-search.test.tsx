import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { stubViewport } from './test/viewport';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import App from './App';
import { translations } from './translations';

/* ---------------------------------------------------------------------------
 * The header's global search, end to end on the real route (card KI-837).
 *
 * WHAT THIS FILE IS FOR: the navigation half, which no component test can
 * see. Choosing a chat hit has to open the chat's TOPIC and then THAT CHAT —
 * and opening a topic calls `useChat.handleNewChat` (`onKBSelected`), which
 * resets the chat state to a fresh, empty chat. Selected in the wrong order,
 * the chosen chat is overwritten and the user lands on an empty composer.
 * `useSearchNavigation` sequences it; this file proves the result on screen.
 *
 * ONLY the network is stubbed (axios and `fetch`), plus what jsdom cannot do:
 * pointer capture and `scrollIntoView`. No provider, context or app hook is
 * mocked.
 *
 * ORACLES, independent of the code under test:
 *  - the FIXTURE message bodies below. They reach the DOM only through
 *    `GET /api/chats/chat-7/messages` → `handleSelectChat` → the message tree
 *    → `ChatView`; nothing else in the app knows them. If `handleNewChat`
 *    ran after the selection, the tree would be empty and they would be
 *    absent.
 *  - translations.ts for every accessible name, and WAI-ARIA's roles
 *    (`combobox`, `option`) as @testing-library/dom maps them.
 *  - `document.activeElement` via `userEvent.keyboard`, which types into
 *    whatever the document says is focused.
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

const KB = {
  id: 'kb-1', name: 'Prüfungsordnungen', description: null, userId: 'user-1',
  createdAt: '2026-01-01T00:00:00Z', isPro: false, isGlobal: false, myRole: 'owner',
  aiConfigId: null, chatModel: null, embeddingModel: null, rerankModel: null, ttsModel: null,
};

const USER_TURN = 'Wie lange dauert die mündliche Prüfung?';
const AI_TURN = 'Die mündliche Prüfung dauert 30 Minuten.';

/** API.md `### Search` shape: one chat hit and one message hit, same chat. */
const SEARCH = {
  query: 'Prüf', kbId: null, topics: [], sources: [],
  chats: [{
    id: 'chat-7', title: 'Prüfungsfragen', type: 'chat', kbId: 'kb-1',
    kbName: 'Prüfungsordnungen', updatedAt: '2026-09-20T10:00:00Z', match: 'prefix',
  }],
  messages: [{
    id: 'm2', chatId: 'chat-7', chatTitle: 'Prüfungsfragen', chatType: 'chat', kbId: 'kb-1',
    kbName: 'Prüfungsordnungen', role: 'assistant',
    snippet: 'Die mündliche Prüfung dauert <30> Minuten',
    createdAt: '2026-09-20T10:00:00Z',
  }],
};

/**
 * GET router. `GET /api/kb/kb-1` answers LATE (80 ms) on purpose: the trap is
 * a chat selected before the topic has settled, and a topic that answers
 * instantly would hide a wrong order behind a lucky microtask.
 */
function routeGets() {
  mockedGet.mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes('/api/search')) return Promise.resolve({ data: SEARCH });
    if (/\/api\/kb\/kb-1$/.test(u)) {
      return new Promise((resolve) => setTimeout(() => resolve({ data: KB }), 80));
    }
    if (u.endsWith('/api/kb/kb-1/chats')) {
      return Promise.resolve({
        data: [{
          id: 'chat-7', kbId: 'kb-1', userId: 'user-1', title: 'Prüfungsfragen', type: 'chat',
          createdAt: '2026-09-20T09:00:00Z', updatedAt: '2026-09-20T10:00:00Z', teamId: null, agentId: null,
        }],
      });
    }
    if (u.endsWith('/api/chats/chat-7/messages')) {
      return Promise.resolve({
        data: [
          { id: 'm1', parentMessageId: null, role: 'user', content: USER_TURN },
          { id: 'm2', parentMessageId: 'm1', role: 'ai', content: AI_TURN },
        ],
      });
    }
    return Promise.resolve({ data: [] });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
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
  localStorage.setItem('onboardingCompleted', 'true');
  routeGets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openDropdown() {
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: translations.myTopics.de }, { timeout: 15000 });
  const field = screen.getByRole('combobox', { name: translations.globalSearchPlaceholder.de });
  await userEvent.type(field, 'Prüf');
  const listbox = await screen.findByRole('listbox', { name: translations.globalSearchResults.de }, { timeout: 2000 });
  return { field, listbox };
}

describe('App — the header global search on the authenticated route', () => {
  it('opens the chosen chat, not a fresh one, when a chat hit is selected with the keyboard', async () => {
    const { field, listbox } = await openDropdown();

    // Grouped, in the documented order, headed in the KI-799 vocabulary.
    const groups = within(listbox).getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent))
      .toEqual([translations.globalSearchGroupChats.de, translations.globalSearchGroupMessages.de]);

    // The caret never left the field while the list opened.
    expect(document.activeElement).toBe(field);

    // The first option (the chat hit) is highlighted; Enter selects it.
    await waitFor(() => {
      const id = field.getAttribute('aria-activedescendant');
      expect(id && document.getElementById(id)).toHaveTextContent('Prüfungsfragen');
    });
    await userEvent.keyboard('{Enter}');

    // ORACLE: the fixture's message bodies, on screen — the chosen chat
    // survived the topic's `handleNewChat`.
    expect(await screen.findByText(AI_TURN, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(USER_TURN)).toBeInTheDocument();

    // ...and the topic was opened BEFORE the chat's messages were requested.
    const urls = mockedGet.mock.calls.map(([u]) => String(u));
    const kbIdx = urls.findIndex((u) => /\/api\/kb\/kb-1$/.test(u));
    const msgIdx = urls.findIndex((u) => u.endsWith('/api/chats/chat-7/messages'));
    expect(kbIdx).toBeGreaterThanOrEqual(0);
    expect(msgIdx).toBeGreaterThan(kbIdx);
  }, 30000);

  it('opens the chat of a message hit too, and renders its snippet highlight as text', async () => {
    const { listbox } = await openDropdown();

    const messages = within(listbox).getByRole('group', { name: translations.globalSearchGroupMessages.de });
    const option = within(messages).getByRole('option');

    /* ORACLE: the fixture snippet. The U+E000/U+E001 pair became exactly one
       <mark> whose text is the marked word; the literal `<30>` stayed TEXT
       (a snippet inserted as HTML would have swallowed it as a tag); and no
       marker character survived into the DOM. */
    const marks = option.querySelectorAll('mark');
    expect(Array.from(marks).map((m) => m.textContent)).toEqual(['Prüfung']);
    expect(option).toHaveTextContent('Die mündliche Prüfung dauert <30> Minuten');
    expect(option.textContent).not.toMatch(/[]/);

    await userEvent.click(option);
    expect(await screen.findByText(AI_TURN, {}, { timeout: 5000 })).toBeInTheDocument();
  }, 30000);

  it('shows a calm inline state on 429 instead of a toast, and retries after Retry-After', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let rateLimited = true;
      const base = mockedGet.getMockImplementation()!;
      mockedGet.mockImplementation((url: string) => {
        if (String(url).includes('/api/search') && rateLimited) {
          return Promise.reject({ response: { status: 429, headers: { 'retry-after': '2' } } });
        }
        return base(url);
      });

      render(<App />);
      await screen.findByRole('heading', { level: 1, name: translations.myTopics.de }, { timeout: 15000 });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.type(screen.getByRole('combobox', { name: translations.globalSearchPlaceholder.de }), 'Prüf');

      // ORACLE: translations.ts — the inline line, as a status, in the
      // dropdown; and no toast (the app's toasts are `role="alert"`/`status`
      // items in the toast container, which must not carry this or an error).
      const line = await screen.findByText(translations.globalSearchRateLimited.de, {}, { timeout: 2000 });
      expect(line).toHaveAttribute('role', 'status');
      expect(screen.queryByText(translations.globalSearchError.de)).toBeNull();
      // The container is always mounted (ToastContainer.tsx), so an empty one
      // is a real observation, not an absent element.
      const toastRegion = document.querySelector('.toast-container');
      expect(toastRegion).not.toBeNull();
      expect(toastRegion!.textContent).toBe('');

      // The window passes; the SAME query is sent again without a keystroke.
      rateLimited = false;
      const before = mockedGet.mock.calls.filter(([u]) => String(u).includes('/api/search')).length;
      await vi.advanceTimersByTimeAsync(2100);
      await waitFor(() => {
        const after = mockedGet.mock.calls.filter(([u]) => String(u).includes('/api/search')).length;
        expect(after).toBe(before + 1);
      });
      // ...and its answer replaces the inline line with the results.
      expect(await screen.findAllByRole('option', { name: /Prüfungsfragen/ })).toHaveLength(2);
      expect(screen.queryByText(translations.globalSearchRateLimited.de)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  }, 30000);
});
