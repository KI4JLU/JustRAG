import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { GlobalSearch, type GlobalSearchProps } from './GlobalSearch';
import { translations } from '../translations';
import type { SearchResponse } from '../types';

/* ---------------------------------------------------------------------------
 * `GlobalSearch` against a mocked `GET /api/search` (card KI-837).
 *
 * ORACLES, independent of the code under test:
 *  - the FIXTURES: every expected option text is a hit name written below,
 *    and every „which request won" assertion names the fixture only one of
 *    two competing responses carries;
 *  - translations.ts (German) for every label, looked up here rather than
 *    read off the component;
 *  - WAI-ARIA roles and states (`combobox`, `listbox`, `option`, `group`,
 *    `progressbar`, `aria-expanded`, `aria-activedescendant`) as
 *    @testing-library/dom maps them, plus `document.activeElement`;
 *  - the recorded axios calls, for the requests themselves.
 * Nothing asserts on the component's or the hook's state.
 * ------------------------------------------------------------------------- */

vi.mock('axios');
const mockedGet = vi.mocked(axios, true).get;

type Key = keyof typeof translations;
const de = (k: Key) => translations[k].de;
const themeMock = { t: (k: string) => (translations as Record<string, { de: string }>)[k]?.de ?? k };
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));

function response(over: Partial<SearchResponse> = {}): { data: SearchResponse } {
  return {
    data: { query: 'x', kbId: null, topics: [], sources: [], chats: [], messages: [], ...over },
  };
}

const TOPIC = { id: 'kb-1', name: 'Prüfungsordnungen', description: 'Alle Ordnungen', visibility: 'public', role: 'view', match: 'prefix' as const };
const SOURCE = { id: 'f-1', name: 'PO-2024.pdf', type: 'pdf', kbId: 'kb-1', kbName: 'Prüfungsordnungen', match: 'fuzzy' as const };
const CHAT = { id: 'c-1', title: 'Prüfungsfragen', type: 'research' as const, kbId: 'kb-1', kbName: 'Prüfungsordnungen', updatedAt: '2026-09-20T10:00:00Z', match: 'substring' as const };
const MESSAGE = { id: 'm-1', chatId: 'c-2', chatTitle: 'Modulwahl', chatType: 'chat' as const, kbId: 'kb-1', kbName: 'Prüfungsordnungen', role: 'assistant' as const, snippet: 'laut Prüfungsordnung', createdAt: '2026-09-20T10:00:00Z' };

/** A promise the test resolves by hand, to order competing responses. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** The real consumer shape: the caller holds the text, as AppChrome does. */
function Harness(props: Partial<GlobalSearchProps>) {
  const [query, setQuery] = useState('');
  return (
    <GlobalSearch
      query={query}
      onQueryChange={setQuery}
      onOpenTopic={vi.fn()}
      onOpenSource={vi.fn()}
      onOpenChat={vi.fn()}
      onOpenMessage={vi.fn()}
      {...props}
    />
  );
}

const field = () => screen.getByRole('combobox', { name: de('globalSearchPlaceholder') });
const searchCalls = () => mockedGet.mock.calls.filter(([u]) => String(u).includes('/api/search'));

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

describe('GlobalSearch', () => {
  it('stays closed and sends nothing below two characters', async () => {
    render(<Harness />);
    await userEvent.type(field(), 'P');
    // Past the debounce, deliberately: „nothing yet" is not „nothing".
    await new Promise((r) => setTimeout(r, 400));
    expect(searchCalls()).toHaveLength(0);
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows the loading state while the request runs, then the four groups in order', async () => {
    const pending = deferred<{ data: SearchResponse }>();
    mockedGet.mockReturnValueOnce(pending.promise);
    render(<Harness />);
    await userEvent.type(field(), 'Prüf');

    expect(await screen.findByRole('progressbar', { name: de('globalSearchLoading') })).toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(searchCalls()).toHaveLength(1));
    expect(String(searchCalls()[0][0])).toMatch(/\/api\/search\?q=Pr%C3%BCf$/);

    pending.resolve(response({ topics: [TOPIC], sources: [SOURCE], chats: [CHAT], messages: [MESSAGE] }));
    const listbox = await screen.findByRole('listbox', { name: de('globalSearchResults') });
    expect(screen.queryByRole('progressbar')).toBeNull();

    // ORACLE: translations.ts — headings in the documented order.
    const names = within(listbox).getAllByRole('group').map((g) =>
      document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent);
    expect(names).toEqual([
      de('globalSearchGroupTopics'), de('globalSearchGroupSources'),
      de('globalSearchGroupChats'), de('globalSearchGroupMessages'),
    ]);
    // Topics end with the Discover row when the caller offers one — here it does not.
    expect(within(listbox).queryByRole('option', { name: de('globalSearchShowAllInDiscover') })).toBeNull();
    expect(document.activeElement).toBe(field());
  });

  it('omits empty groups', async () => {
    mockedGet.mockResolvedValueOnce(response({ sources: [SOURCE] }));
    render(<Harness />);
    await userEvent.type(field(), 'PO');
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getAllByRole('group')).toHaveLength(1);
    expect(within(listbox).getByRole('group', { name: de('globalSearchGroupSources') })).toBeInTheDocument();
  });

  it('drops a slow answer to an older query instead of overwriting the newer one', async () => {
    const older = deferred<{ data: SearchResponse }>();
    const newer = deferred<{ data: SearchResponse }>();
    mockedGet.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    render(<Harness />);

    await userEvent.type(field(), 'Pr');
    await waitFor(() => expect(searchCalls()).toHaveLength(1)); // „Pr" is in flight
    await userEvent.type(field(), 'üf');
    await waitFor(() => expect(searchCalls()).toHaveLength(2)); // „Prüf" too

    newer.resolve(response({ topics: [{ ...TOPIC, name: 'Antwort auf Prüf' }] }));
    await screen.findByRole('option', { name: /Antwort auf Prüf/ });
    // The older request resolves LAST, with a result only it carries.
    older.resolve(response({ topics: [{ ...TOPIC, id: 'kb-old', name: 'Antwort auf Pr' }] }));
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByRole('option', { name: /Antwort auf Pr$/ })).toBeNull();
    expect(screen.getByRole('option', { name: /Antwort auf Prüf/ })).toBeInTheDocument();
  });

  it('says so when nothing matched', async () => {
    mockedGet.mockResolvedValueOnce(response());
    render(<Harness />);
    await userEvent.type(field(), '  Zzz ');
    expect(await screen.findByText(de('globalSearchNoResults').replace('{query}', 'Zzz'))).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('shows the rate-limited line on 429 and the error line on anything else', async () => {
    mockedGet.mockRejectedValueOnce({ response: { status: 429, headers: { 'retry-after': '30' } } });
    const { unmount } = render(<Harness />);
    await userEvent.type(field(), 'Prüf');
    expect(await screen.findByRole('status')).toHaveTextContent(de('globalSearchRateLimited'));
    expect(screen.queryByText(de('globalSearchError'))).toBeNull();
    unmount();

    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedGet.mockRejectedValueOnce({ response: { status: 500 } });
    render(<Harness />);
    await userEvent.type(field(), 'Prüf');
    expect(await screen.findByRole('status')).toHaveTextContent(de('globalSearchError'));
  });

  it('keeps the caret in the field on ↓, and Escape closes the list', async () => {
    mockedGet.mockResolvedValueOnce(response({ topics: [TOPIC], sources: [SOURCE] }));
    render(<Harness />);
    await userEvent.type(field(), 'Prüf');
    const options = await screen.findAllByRole('option');
    const active = () => document.getElementById(field().getAttribute('aria-activedescendant') ?? '');

    await waitFor(() => expect(active()).toBe(options[0]));
    await userEvent.keyboard('{ArrowDown}');
    expect(active()).toBe(options[1]);
    expect(document.activeElement).toBe(field());

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(field());
  });

  it('hands each kind of hit to its own callback, and clears the field on the way out', async () => {
    const onOpenTopic = vi.fn();
    const onOpenSource = vi.fn();
    const onOpenChat = vi.fn();
    const onOpenMessage = vi.fn();
    mockedGet.mockResolvedValue(response({ topics: [TOPIC], sources: [SOURCE], chats: [CHAT], messages: [MESSAGE] }));
    render(<Harness onOpenTopic={onOpenTopic} onOpenSource={onOpenSource} onOpenChat={onOpenChat} onOpenMessage={onOpenMessage} />);

    const pick = async (name: RegExp) => {
      await userEvent.type(field(), 'Prüf');
      await userEvent.click(await screen.findByRole('option', { name }));
      expect(field()).toHaveValue('');
    };
    await pick(/^Prüfungsordnungen/);
    expect(onOpenTopic).toHaveBeenCalledWith(TOPIC);
    await pick(/PO-2024\.pdf/);
    expect(onOpenSource).toHaveBeenCalledWith(SOURCE);
    await pick(/Prüfungsfragen/);
    expect(onOpenChat).toHaveBeenCalledWith(CHAT);
    await pick(/Modulwahl/);
    expect(onOpenMessage).toHaveBeenCalledWith(MESSAGE);
  });

  it('offers „show all in Discover" at the end of Topics, with the trimmed query, keeping the text', async () => {
    const onShowAllTopics = vi.fn();
    mockedGet.mockResolvedValueOnce(response({ topics: [TOPIC], sources: [SOURCE] }));
    render(<Harness onShowAllTopics={onShowAllTopics} />);
    await userEvent.type(field(), ' Prüf ');

    const topics = await screen.findByRole('group', { name: de('globalSearchGroupTopics') });
    const rows = within(topics).getAllByRole('option');
    expect(rows[rows.length - 1]).toHaveAccessibleName(de('globalSearchShowAllInDiscover'));

    await userEvent.click(rows[rows.length - 1]);
    expect(onShowAllTopics).toHaveBeenCalledWith('Prüf');
    expect(field()).toHaveValue(' Prüf ');
  });

  /* The chrome is rebuilt after the Discover row, so a FRESH instance can
     hold text it never searched for. ↓ must then fetch rather than open onto
     an empty list. ORACLE: the request log and the options in the DOM. */
  it('searches for remembered text when ↓ opens a freshly mounted field', async () => {
    mockedGet.mockResolvedValueOnce(response({ topics: [TOPIC] }));
    function Remembered() {
      const [query, setQuery] = useState('Prüf');
      return (
        <GlobalSearch query={query} onQueryChange={setQuery}
          onOpenTopic={vi.fn()} onOpenSource={vi.fn()} onOpenChat={vi.fn()} onOpenMessage={vi.fn()} />
      );
    }
    render(<Remembered />);
    field().focus();
    expect(searchCalls()).toHaveLength(0);
    await userEvent.keyboard('{ArrowDown}');
    expect(await screen.findByRole('option', { name: /^Prüfungsordnungen/ })).toBeInTheDocument();
    expect(searchCalls()).toHaveLength(1);
    expect(document.activeElement).toBe(field());
  });

  /* KI-838. ORACLE: the recorded request URLs, in order. */
  it('searches scoped again on the next keystroke after widening', async () => {
    mockedGet.mockResolvedValue(response({ chats: [CHAT] }));
    render(<Harness scopeKbId="kb-42" scopeLabel="Statistik" />);
    const scoped = screen.getByRole('combobox', {
      name: de('workspaceSearchPlaceholder').replace('{topic}', 'Statistik'),
    });
    await userEvent.type(scoped, 'Prüf');
    await userEvent.click(await screen.findByRole('option', { name: de('workspaceSearchAllTopics') }));
    await waitFor(() => expect(searchCalls().map(([u]) => String(u)).at(-1)).toMatch(/q=Pr%C3%BCf$/));
    await userEvent.type(scoped, 'u');
    await waitFor(() => expect(searchCalls().map(([u]) => String(u)).at(-1)).toMatch(/q=Pr%C3%BCfu&kb_id=kb-42$/));
    expect(scoped).toHaveAccessibleName(de('workspaceSearchPlaceholder').replace('{topic}', 'Statistik'));
  });

  it('keeps an unscoped 404 as the generic error line', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedGet.mockRejectedValueOnce({ response: { status: 404 } });
    render(<Harness />);
    await userEvent.type(field(), 'Prüf');
    expect(await screen.findByRole('status')).toHaveTextContent(de('globalSearchError'));
    expect(screen.queryByText(de('workspaceSearchTopicUnavailable'))).toBeNull();
  });

  it('scopes the request to one topic when scopeKbId is set', async () => {
    mockedGet.mockResolvedValueOnce(response());
    render(<Harness scopeKbId="kb-42" />);
    await userEvent.type(field(), 'Prüf');
    await waitFor(() => expect(searchCalls()).toHaveLength(1));
    expect(String(searchCalls()[0][0])).toContain('kb_id=kb-42');
  });
});
