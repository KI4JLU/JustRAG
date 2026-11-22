import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Button } from '@ki4jlu/design-system';
import { HistoryPanel } from './HistoryPanel';

const handleSelectChat = vi.fn();
const handleNewChat = vi.fn();
const handleNewTopic = vi.fn();
const handlePinChat = vi.fn();
const handleReorderPinned = vi.fn();
const handleCreateSection = vi.fn();
const handleRenameSection = vi.fn();
const handleDeleteSection = vi.fn();
const handleReorderSections = vi.fn();
// The user's own sections of the history.
let userSections: { id: string; name: string; createdAt: string }[] = [];
const handleDeleteChat = vi.fn();
const handleRenameChat = vi.fn();
const handleDeleteChats = vi.fn(async () => true);

let activeChatId: string | null = null;
let extraChats: Record<string, string>[] = [];
// A topic is open: only then is there a chat to start.
let hasTopic = true;
// A chat URL whose topic is still being looked up.
let topicPending = false;

// Der Einklapp-Zustand kommt vom `SidePanel` des Design-Systems, nicht aus dem
// App-Zustand. Nur diesen einen Export ersetzen — `Button` und alles andere
// bleiben die ausgelieferten Komponenten (`importOriginal`).
let collapsed = false;
vi.mock('@ki4jlu/design-system', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSidebarCollapsed: () => collapsed,
}));

vi.mock('../../contexts/MobileContext', () => ({ useIsMobileContext: () => false }));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));
// The history's own context (AuthenticatedApp builds the real value): the
// user's chats across topics. c1 lives in an owned topic, s1 in a shared one.
const sectionOf = (c: { kbRole?: string }) => (c.kbRole === 'owner' ? 'my-topics' : 'shared-topics');
vi.mock('../../contexts/ChatHistoryContext', () => ({
  useChatHistory: () => ({
    chats: [
      { id: 'c1', kbId: 'kb1', kbName: 'Haushalt', kbVisibility: 'private', kbRole: 'owner', title: 'Budget?', createdAt: '2026-08-10T00:00:00Z' },
      ...extraChats,
      { id: 'r1', kbId: 'kb1', title: 'Zero-Trust', createdAt: '2026-08-14T00:00:00Z', type: 'research' },
      { id: 'a1', kbId: 'kb1', title: 'Paper', createdAt: '2026-08-12T00:00:00Z', type: 'academic_research' },
    ],
    activeChatId,
    openTopicId: hasTopic ? 'kb1' : null,
    openTopicPending: topicPending,
    sectionOf,
    openChat: handleSelectChat,
    deleteChats: handleDeleteChats,
    renameChat: handleRenameChat,
    pinChat: handlePinChat,
    reorderPinned: handleReorderPinned,
    sections: userSections,
    createSection: handleCreateSection,
    renameSection: handleRenameSection,
    deleteSection: handleDeleteSection,
    reorderSections: handleReorderSections,
    newChat: hasTopic ? handleNewChat : null,
    newTopic: handleNewTopic,
  }),
}));

// The filters are remembered in localStorage; each test starts without any.
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

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  // Radix menus capture pointers and scroll; jsdom implements neither.
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  activeChatId = null;
  extraChats = [];
  userSections = [];
  hasTopic = true;
  topicPending = false;
  collapsed = false;
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('HistoryPanel', () => {
  it('zeigt nur Chats — keine Artefakte, Recherchen oder Academic-Sitzungen (22.09.2026)', () => {
    // Der Mock enthält drei Arten (r1 Recherche, a1 Academic, c1 Chat). Nur
    // der Chat erscheint: die anderen öffneten Ansichten, die nicht mehr
    // erreichbar sind.
    render(<HistoryPanel />);
    const titles = screen.getAllByTestId('history-item-title').map(e => e.textContent);
    expect(titles).toEqual(['Budget?']);
    for (const hidden of ['Zero-Trust', 'Paper']) {
      expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    }
  });

  it('gruppiert die Chats nach Tag statt je Zeile ein Datum zu zeigen', () => {
    render(<HistoryPanel />);
    // Fixture chats are all from August 2026 (see mock): one group per day,
    // labelled with the long date, and no per-row date text.
    const labels = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);
    expect(labels).toEqual(['August 10, 2026']);
    expect(screen.queryByText(/8\/10\/2026|10\.8\.2026/)).not.toBeInTheDocument();
  });

  it('öffnet einen Chat mit seinem Thema', async () => {
    render(<HistoryPanel />);
    await userEvent.click(screen.getByText('Budget?'));
    // The row hands over the whole entry: its topic is what the opener needs.
    expect(handleSelectChat).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'c1', kbId: 'kb1' }));
  });

  // ORACLE: the fixture (c1 is in the owned topic „Haushalt") and the hover
  // preview's contract: it opens once the pointer rests on its trigger.
  it('names the chat, its overview and its topic in the collapsed rail\'s hover preview', async () => {
    collapsed = true;
    render(<HistoryPanel />);
    expect(screen.queryByTestId('history-preview')).toBeNull();
    await userEvent.hover(screen.getByRole('button', { name: 'Budget?' }));
    const preview = await screen.findByTestId('history-preview', {}, { timeout: 3000 });
    expect(preview).toHaveTextContent('Budget?');
    expect(preview).toHaveTextContent('myTopics · Haushalt');
  });

  it('shows the same preview on an expanded row', async () => {
    render(<HistoryPanel />);
    expect(screen.queryByTestId('history-preview')).toBeNull();
    await userEvent.hover(screen.getByText('Budget?'));
    const preview = await screen.findByTestId('history-preview', {}, { timeout: 3000 });
    expect(preview).toHaveTextContent('myTopics · Haushalt');
  });

  // ORACLE: the fixture — p1 carries pinnedAt, c1 does not — and the menu's
  // own labels: a chat offers the opposite of its state.
  describe('pinned chats', () => {
    const pinned = { id: 'p1', kbId: 'kb2', kbName: 'Statistik', kbVisibility: 'private', kbRole: 'view', title: 'Median?', createdAt: '2026-08-09T00:00:00Z', pinnedAt: '2026-08-15T00:00:00Z' };
    const headings = () => screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);
    const titles = () => screen.queryAllByTestId('history-item-title').map(e => e.textContent);

    // ORACLE: the sidebar's order — „Angepinnt" is its own section above
    // „Verlauf", each under a heading of the same level; days are below that.
    it('lists them in their own section above the history, not among the days', () => {
      extraChats = [pinned];
      render(<HistoryPanel />);
      expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['pinnedChats', 'history']);
      expect(headings()).toEqual(['August 10, 2026']);
      expect(titles()).toEqual(['Median?', 'Budget?']);
    });

    it('shows no pinned section while nothing is pinned', () => {
      render(<HistoryPanel />);
      expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['history']);
      expect(headings()).toEqual(['August 10, 2026']);
    });

    it('pins from a chat\'s menu and unpins from a pinned chat\'s', async () => {
      extraChats = [pinned];
      render(<HistoryPanel />);
      await userEvent.click(screen.getByRole('button', { name: 'chatActions Budget?' }));
      expect(screen.queryByRole('menuitem', { name: 'unpinChat' })).toBeNull();
      await userEvent.click(screen.getByRole('menuitem', { name: 'pinChat' }));
      expect(handlePinChat).toHaveBeenCalledExactlyOnceWith('c1', true, null);

      await userEvent.click(screen.getByRole('button', { name: 'chatActions Median?' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'unpinChat' }));
      expect(handlePinChat).toHaveBeenLastCalledWith('p1', false);
    });

    // ORACLE: the stored order — pinPosition 1 is first — and a chat pinned
    // since (no place yet) ahead of the ordered ones.
    const second = { ...pinned, id: 'p2', title: 'Varianz?', pinnedAt: '2026-08-16T00:00:00Z', pinPosition: '1' };
    const third = { ...pinned, id: 'p3', title: 'Quantil?', pinnedAt: '2026-08-14T00:00:00Z', pinPosition: '2' };
    const pinnedTitles = () => titles().slice(0, -1);

    it('shows them in the user\'s own order, a newly pinned chat first', () => {
      extraChats = [third, second, pinned];
      render(<HistoryPanel />);
      expect(pinnedTitles()).toEqual(['Median?', 'Varianz?', 'Quantil?']);
    });

    it('moves a pinned chat down and up from its menu, and saves the whole order', async () => {
      extraChats = [third, second];
      render(<HistoryPanel />);
      expect(pinnedTitles()).toEqual(['Varianz?', 'Quantil?']);

      await userEvent.click(screen.getByRole('button', { name: 'chatActions Varianz?' }));
      // The first cannot go further up.
      expect(await screen.findByRole('menuitem', { name: 'movePinUp' })).toHaveAttribute('aria-disabled', 'true');
      await userEvent.click(screen.getByRole('menuitem', { name: 'movePinDown' }));
      expect(handleReorderPinned).toHaveBeenCalledExactlyOnceWith(['p3', 'p2'], null);

      await userEvent.click(screen.getByRole('button', { name: 'chatActions Quantil?' }));
      expect(await screen.findByRole('menuitem', { name: 'movePinDown' })).toHaveAttribute('aria-disabled', 'true');
      await userEvent.click(screen.getByRole('menuitem', { name: 'movePinUp' }));
      expect(handleReorderPinned).toHaveBeenLastCalledWith(['p3', 'p2'], null);
    });

    it('offers no moving for a single pinned chat or an unpinned one', async () => {
      extraChats = [pinned];
      render(<HistoryPanel />);
      await userEvent.click(screen.getByRole('button', { name: 'chatActions Median?' }));
      await screen.findByRole('menuitem', { name: 'unpinChat' });
      expect(screen.queryByRole('menuitem', { name: 'movePinUp' })).toBeNull();
    });

    it('still opens a pinned chat on a click', async () => {
      extraChats = [third, second];
      render(<HistoryPanel />);
      await userEvent.click(screen.getByText('Varianz?'));
      expect(handleSelectChat).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'p2' }));
      expect(handleReorderPinned).not.toHaveBeenCalled();
    });

    it('folds the section away and remembers it', async () => {
      extraChats = [pinned];
      const first = render(<HistoryPanel />);
      const toggle = screen.getByRole('button', { name: 'pinnedChats' });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await userEvent.click(toggle);
      expect(titles()).toEqual(['Budget?']);
      first.unmount();
      render(<HistoryPanel />);
      expect(screen.getByRole('button', { name: 'pinnedChats' })).toHaveAttribute('aria-expanded', 'false');
      expect(titles()).toEqual(['Budget?']);
    });

    it('keeps a pinned chat at hand when the filter hides its overview', async () => {
      extraChats = [pinned];
      render(<HistoryPanel />);
      await userEvent.click(screen.getByRole('button', { name: /^historyFilter/ }));
      await userEvent.click(await screen.findByRole('menuitem', { name: /^historyFilterSection/ }));
      await userEvent.click(await screen.findByRole('menuitemradio', { name: 'myTopics' }));
      await userEvent.keyboard('{Escape}{Escape}');
      expect(titles()).toEqual(['Median?', 'Budget?']);
    });

    // ORACLE: the fixture — c1 lives in kb1, the open topic; outside a
    // topic „only the open topic" matches no chat, pinned ones stay.
    it('lists only the open topic\'s chats, and none while no topic is open', async () => {
      extraChats = [pinned, { id: 's1', kbId: 'kb3', kbName: 'Lehre', kbVisibility: 'private', kbRole: 'view', title: 'Klausur?', createdAt: '2026-08-11T00:00:00Z' }];
      const { unmount } = render(<HistoryPanel />);
      await userEvent.click(screen.getByRole('button', { name: /^historyFilter/ }));
      await userEvent.click(await screen.findByRole('menuitem', { name: /^historyFilterTopic/ }));
      await userEvent.click(await screen.findByRole('menuitemradio', { name: 'historyFilterTopicOpen' }));
      await userEvent.keyboard('{Escape}{Escape}');
      expect(titles()).toEqual(['Median?', 'Budget?']);
      // The filter is remembered: a view without a topic opens with it set.
      unmount();
      hasTopic = false;
      render(<HistoryPanel />);
      expect(titles()).toEqual(['Median?']);
      expect(screen.getByText('historyFilterEmpty')).toBeInTheDocument();
    });

    // ORACLE: a topic not known yet is no empty filter result — no line until it is.
    it('says nothing about the filter while the open topic is still being looked up', async () => {
      const { unmount } = render(<HistoryPanel />);
      await userEvent.click(screen.getByRole('button', { name: /^historyFilter/ }));
      await userEvent.click(await screen.findByRole('menuitem', { name: /^historyFilterTopic/ }));
      await userEvent.click(await screen.findByRole('menuitemradio', { name: 'historyFilterTopicOpen' }));
      await userEvent.keyboard('{Escape}{Escape}');
      unmount();
      hasTopic = false;
      topicPending = true;
      render(<HistoryPanel />);
      expect(titles()).toEqual([]);
      expect(screen.queryByText('historyFilterEmpty')).toBeNull();
    });

    it('puts pinned chats first in the collapsed rail', () => {
      extraChats = [pinned];
      collapsed = true;
      hasTopic = false;
      render(<HistoryPanel />);
      const names = screen.getAllByRole('button').map(b => b.getAttribute('aria-label'));
      expect(names).toEqual(['newTopic', 'Median?', 'Budget?']);
    });
  });

  // ORACLE: the disclosure pattern (WAI-ARIA): the heading's button carries
  // aria-expanded and hides what it controls; the pinned section is its own.
  it('folds the history away and remembers it, leaving the pinned chats', async () => {
    extraChats = [{ id: 'p1', kbId: 'kb2', kbName: 'Statistik', kbVisibility: 'private', kbRole: 'view', title: 'Median?', createdAt: '2026-08-09T00:00:00Z', pinnedAt: '2026-08-15T00:00:00Z' }];
    const titles = () => screen.queryAllByTestId('history-item-title').map(e => e.textContent);
    const first = render(<HistoryPanel />);
    const toggle = screen.getByRole('button', { name: 'history' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(titles()).toEqual(['Median?', 'Budget?']);

    await userEvent.click(toggle);

    expect(titles()).toEqual(['Median?']);
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
    // The filter stays beside the heading.
    expect(screen.getByRole('button', { name: 'historyFilter' })).toBeInTheDocument();
    first.unmount();
    render(<HistoryPanel />);
    expect(screen.getByRole('button', { name: 'history' })).toHaveAttribute('aria-expanded', 'false');
    expect(titles()).toEqual(['Median?']);
  });

  // ORACLE: the fixture — the section „Arbeit" holds w1, „Privat" is empty —
  // and the menus' own labels.
  describe('the user\'s own sections', () => {
    const work = { id: 'sec-work', name: 'Arbeit', createdAt: '2026-08-01T00:00:00Z' };
    const home = { id: 'sec-home', name: 'Privat', createdAt: '2026-08-02T00:00:00Z' };
    const filed = { id: 'w1', kbId: 'kb2', kbName: 'Statistik', kbVisibility: 'private', kbRole: 'view', title: 'Median?', createdAt: '2026-08-09T00:00:00Z', pinnedAt: '2026-08-15T00:00:00Z', sectionId: 'sec-work' };
    const sectionHeadings = () => screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent);
    const titles = () => screen.queryAllByTestId('history-item-title').map(e => e.textContent);

    it('lists them above the history in their order, an empty one with a line saying so', () => {
      userSections = [work, home];
      extraChats = [filed];
      render(<HistoryPanel />);
      // No „Angepinnt": nothing is pinned there.
      expect(sectionHeadings()).toEqual(['Arbeit', 'Privat', 'history']);
      expect(titles()).toEqual(['Median?', 'Budget?']);
      expect(screen.getByText('sectionEmpty')).toBeInTheDocument();
    });

    it('files a chat in a section from its menu, and ticks where a filed chat is', async () => {
      userSections = [work, home];
      extraChats = [filed];
      render(<HistoryPanel />);
      await userEvent.click(screen.getByRole('button', { name: 'chatActions Budget?' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'sectionMoveTo' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Privat' }));
      expect(handlePinChat).toHaveBeenCalledExactlyOnceWith('c1', true, 'sec-home');
      await userEvent.keyboard('{Escape}{Escape}');

      await userEvent.click(screen.getByRole('button', { name: 'chatActions Median?' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'sectionMoveTo' }));
      // The DS marks the chosen option of a menu with its `selected` style and a check.
      const current = await screen.findByRole('menuitem', { name: 'Arbeit' });
      expect(current.querySelector('svg')).not.toBeNull();
      expect(screen.getByRole('menuitem', { name: 'Privat' }).querySelector('svg')).toBeNull();
      await userEvent.click(screen.getByRole('menuitem', { name: 'pinnedChats' }));
      expect(handlePinChat).toHaveBeenLastCalledWith('w1', true, null);
    });

    // ORACLE: the request — „pinned" means the built-in section only. A chat
    // filed in a section of the user's own can still be pinned, and leaves
    // its section by its own entry.
    it('offers pinning and leaving the section for a filed chat, not unpinning', async () => {
      userSections = [work];
      extraChats = [filed];
      render(<HistoryPanel />);
      await userEvent.click(screen.getByRole('button', { name: 'chatActions Median?' }));
      await screen.findByRole('menuitem', { name: 'pinChat' });
      expect(screen.queryByRole('menuitem', { name: 'unpinChat' })).toBeNull();
      await userEvent.click(screen.getByRole('menuitem', { name: 'sectionRemoveFrom' }));
      expect(handlePinChat).toHaveBeenCalledExactlyOnceWith('w1', false);
    });

    it('offers no section to move to while the user has none', async () => {
      render(<HistoryPanel />);
      await userEvent.click(screen.getByRole('button', { name: 'chatActions Budget?' }));
      await screen.findByRole('menuitem', { name: 'pinChat' });
      expect(screen.queryByRole('menuitem', { name: 'sectionMoveTo' })).toBeNull();
    });

    it('saves a section\'s order for that section', async () => {
      userSections = [work];
      extraChats = [
        { ...filed, pinPosition: '1' },
        { ...filed, id: 'w2', title: 'Varianz?', pinPosition: '2' },
      ];
      render(<HistoryPanel />);
      await userEvent.click(screen.getByRole('button', { name: 'chatActions Median?' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'movePinDown' }));
      expect(handleReorderPinned).toHaveBeenCalledExactlyOnceWith(['w2', 'w1'], 'sec-work');
    });

    it('creates, renames and deletes from a section\'s own menu', async () => {
      userSections = [work];
      render(<HistoryPanel />);
      const open = () => userEvent.click(screen.getByRole('button', { name: 'sectionActions Arbeit' }));
      await open();
      // ORACLE: the menu as specified — four entries in this order, each set off by a separator.
      await screen.findByRole('menuitem', { name: 'sectionNew' });
      expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(['sectionNew', 'sectionRename', 'sectionCollapseOthers', 'sectionDelete']);
      expect(screen.getAllByRole('separator')).toHaveLength(3);
      await userEvent.click(screen.getByRole('menuitem', { name: 'sectionNew' }));
      await waitFor(() => expect(handleCreateSection).toHaveBeenCalledTimes(1));
      await open();
      await userEvent.click(await screen.findByRole('menuitem', { name: 'sectionDelete' }));
      await waitFor(() => expect(handleDeleteSection).toHaveBeenCalledExactlyOnceWith(work));
    });

    // ORACLE: the request — a section moves from its menu; only a move that
    // is possible is offered, and „Angepinnt" (always first) offers none.
    describe('moving a section from its menu', () => {
      const third = { id: 'sec-uni', name: 'Uni', createdAt: '2026-08-03T00:00:00Z' };
      const entries = async (name: string) => {
        await userEvent.click(screen.getByRole('button', { name: `sectionActions ${name}` }));
        await screen.findByRole('menuitem', { name: 'sectionNew' });
        return screen.getAllByRole('menuitem').map(i => i.textContent);
      };

      it('offers up and down in the middle, and saves the new order of all sections', async () => {
        userSections = [work, home, third];
        render(<HistoryPanel />);
        expect(await entries('Privat')).toEqual(['sectionNew', 'sectionRename', 'sectionMoveUp', 'sectionMoveDown', 'sectionCollapseOthers', 'sectionDelete']);
        await userEvent.click(screen.getByRole('menuitem', { name: 'sectionMoveUp' }));
        expect(handleReorderSections).toHaveBeenCalledExactlyOnceWith(['sec-home', 'sec-work', 'sec-uni']);
      });

      it('offers only down on the first and only up on the last', async () => {
        userSections = [work, home, third];
        render(<HistoryPanel />);
        expect(await entries('Arbeit')).toEqual(['sectionNew', 'sectionRename', 'sectionMoveDown', 'sectionCollapseOthers', 'sectionDelete']);
        await userEvent.click(screen.getByRole('menuitem', { name: 'sectionMoveDown' }));
        expect(handleReorderSections).toHaveBeenCalledExactlyOnceWith(['sec-home', 'sec-work', 'sec-uni']);
        expect(await entries('Uni')).toEqual(['sectionNew', 'sectionRename', 'sectionMoveUp', 'sectionCollapseOthers', 'sectionDelete']);
      });

      it('offers no move for a lone section', async () => {
        userSections = [work];
        render(<HistoryPanel />);
        expect(await entries('Arbeit')).toEqual(['sectionNew', 'sectionRename', 'sectionCollapseOthers', 'sectionDelete']);
      });
    });

    // ORACLE: the request — a section is named in its heading, not in a dialog.
    describe('naming a section in its heading', () => {
      const startRename = async () => {
        userSections = [work];
        render(<HistoryPanel />);
        await userEvent.click(screen.getByRole('button', { name: 'sectionActions Arbeit' }));
        await userEvent.click(await screen.findByRole('menuitem', { name: 'sectionRename' }));
        const field = await screen.findByRole('textbox', { name: 'sectionNamePrompt' });
        // The closing menu hands the focus to its trigger once; the field
        // takes it back (and selects the name again). Typing starts after that.
        await waitFor(() => expect(field).toHaveFocus());
        await act(() => new Promise(resolve => setTimeout(resolve, 20)));
        return field;
      };

      it('turns the heading into a field holding the name, selected and focused', async () => {
        const field = await startRename() as HTMLInputElement;
        expect(field).toHaveValue('Arbeit');
        await waitFor(() => expect(field).toHaveFocus());
        expect([field.selectionStart, field.selectionEnd]).toEqual([0, 'Arbeit'.length]);
        expect(screen.queryByRole('dialog')).toBeNull();
      });

      it('saves the trimmed name on Enter and shows the heading again', async () => {
        const field = await startRename();
        await userEvent.clear(field);
        await userEvent.type(field, '  Beruf {Enter}');
        expect(handleRenameSection).toHaveBeenCalledExactlyOnceWith(work, 'Beruf');
        expect(screen.queryByRole('textbox', { name: 'sectionNamePrompt' })).toBeNull();
      });

      it('saves when the field is left', async () => {
        const field = await startRename();
        await userEvent.clear(field);
        await userEvent.type(field, 'Beruf');
        await userEvent.tab();
        expect(handleRenameSection).toHaveBeenCalledExactlyOnceWith(work, 'Beruf');
      });

      it('keeps the old name on Escape, for an empty name and for an unchanged one', async () => {
        const field = await startRename();
        await userEvent.clear(field);
        await userEvent.type(field, 'Beruf{Escape}');
        expect(screen.queryByRole('textbox', { name: 'sectionNamePrompt' })).toBeNull();
        expect(sectionHeadings()).toEqual(['Arbeit', 'history']);

        await userEvent.click(screen.getByRole('button', { name: 'sectionActions Arbeit' }));
        await userEvent.click(await screen.findByRole('menuitem', { name: 'sectionRename' }));
        await userEvent.clear(await screen.findByRole('textbox', { name: 'sectionNamePrompt' }));
        await userEvent.keyboard('{Enter}');

        await userEvent.click(screen.getByRole('button', { name: 'sectionActions Arbeit' }));
        await userEvent.click(await screen.findByRole('menuitem', { name: 'sectionRename' }));
        await screen.findByRole('textbox', { name: 'sectionNamePrompt' });
        await userEvent.keyboard('{Enter}');
        expect(handleRenameSection).not.toHaveBeenCalled();
      });

      it('opens a new section\'s name for typing right after creating it', async () => {
        userSections = [work, home];
        handleCreateSection.mockResolvedValueOnce(home);
        render(<HistoryPanel />);
        await userEvent.click(screen.getByRole('button', { name: 'sectionActions Arbeit' }));
        await userEvent.click(await screen.findByRole('menuitem', { name: 'sectionNew' }));
        const field = await screen.findByRole('textbox', { name: 'sectionNamePrompt' });
        expect(field).toHaveValue('Privat');
        await waitFor(() => expect(field).toHaveFocus());
      });
    });

    it('offers no rename or delete for the built-in pinned section', async () => {
      extraChats = [{ ...filed, sectionId: '' }];
      render(<HistoryPanel />);
      await userEvent.click(screen.getByRole('button', { name: 'sectionActions pinnedChats' }));
      await screen.findByRole('menuitem', { name: 'sectionNew' });
      expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(['sectionNew', 'sectionCollapseOthers']);
    });

    it('folds every other section away from a section\'s menu', async () => {
      userSections = [work, home];
      extraChats = [filed];
      render(<HistoryPanel />);
      await userEvent.click(screen.getByRole('button', { name: 'sectionActions Arbeit' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'sectionCollapseOthers' }));
      expect(screen.getByRole('button', { name: 'Arbeit' })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: 'Privat' })).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByRole('button', { name: 'history' })).toHaveAttribute('aria-expanded', 'false');
      expect(titles()).toEqual(['Median?']);
    });

    it('creates a section from the filter menu too', async () => {
      render(<HistoryPanel />);
      await userEvent.click(screen.getByRole('button', { name: 'historyFilter' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'sectionCreate' }));
      await waitFor(() => expect(handleCreateSection).toHaveBeenCalledTimes(1));
    });

    it('shows a chat whose section is gone under the pinned heading', () => {
      extraChats = [filed];
      render(<HistoryPanel />);
      expect(sectionHeadings()).toEqual(['pinnedChats', 'history']);
    });
  });

  // ORACLE: a chat needs a topic. Without one the same place offers a new
  // topic, so the rows below it do not move.
  it('offers a new topic in place of the new chat while no topic is open', async () => {
    hasTopic = false;
    render(<HistoryPanel />);
    expect(screen.queryByRole('button', { name: 'newChat' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'newTopic' }));
    expect(handleNewTopic).toHaveBeenCalledTimes(1);
    expect(handleNewChat).not.toHaveBeenCalled();
    expect(screen.getByText('Budget?')).toBeInTheDocument();
  });

  it('offers the new chat, not the new topic, inside a topic', () => {
    render(<HistoryPanel />);
    expect(screen.getByRole('button', { name: 'newChat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'newTopic' })).toBeNull();
  });

  it('legt über den Plus-Knopf einen neuen Chat an', async () => {
    render(<HistoryPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'newChat' }));
    expect(handleNewChat).toHaveBeenCalled();
  });

  it('bringt keinen eigenen Rahmen mehr mit — die Spalte gehört der Shell', () => {
    // Bis zum Umzug auf `AppShellLayout` brachte dieses Panel seinen eigenen
    // `SidebarShell` mit: ein <aside> mit eigener Breite, eigenem Einklapp-
    // Knopf und eigenem Zustand. Die Shell stellt jetzt genau diesen Rahmen
    // (ihr `SidePanel`), und zwei ineinander steckende Rahmen hießen zwei
    // Knöpfe und zwei Breiten für eine Spalte.
    //
    // Der Oracle ist NICHT die Ausgabe dieser Komponente, sondern die
    // Zuständigkeit: `AppFrame` hängt das Panel in `nav` ein und
    // führt links `isLeftSidebarOpen` — geprüft in AppFrame.topic.test.tsx.
    // Hier bleibt die Gegenprobe: das Panel selbst führt nichts davon.
    const { container } = render(<HistoryPanel />);
    expect(container.querySelector('aside')).toBeNull();
    expect(screen.getByText('history')).toBeInTheDocument();
  });

  // Wie in der Quellenliste: „Löschen" im Aktionsmenü löscht nicht sofort,
  // sondern startet den Löschmodus mit diesem Chat angehakt.
  it('startet über „Löschen" im Aktionsmenü den Löschmodus, ohne sofort zu löschen', async () => {
    render(<HistoryPanel />);
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'chatActions Budget?' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /deleteItem/ }));
    expect(handleDeleteChat).not.toHaveBeenCalled();
    expect(handleDeleteChats).not.toHaveBeenCalled();
    expect(screen.getByRole('toolbar', { name: 'deleteChats' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'selectChat Budget?' })).toHaveAttribute('aria-checked', 'true');
    // Was gelöscht werden soll, ist rot markiert (DS selectionTone="destructive"):
    // seit dem Sidebar-Redesign eine rot getönte Fläche statt eines roten Rahmens.
    expect(screen.getByTestId('history-item-title').closest('[data-slot=sidebar-card]')).toHaveClass('bg-error/10');
  });

  it('bietet keinen eigenen „Auswählen"-Eintrag mehr an — Auswahl gibt es nur zum Löschen', async () => {
    render(<HistoryPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'chatActions Budget?' }));
    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(['pinChat', 'renameChat', 'deleteItem']);
  });

  it('öffnet den Chat beim Klick auf die Kartenfläche, nicht aber über das Aktionsmenü', async () => {
    render(<HistoryPanel />);
    await userEvent.click(screen.getByText('August 10, 2026').nextElementSibling!.querySelector('li')!);
    expect(handleSelectChat).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'chatActions Budget?' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /renameChat/ }));
    expect(handleSelectChat).toHaveBeenCalledTimes(1);
  });

  it('zeigt keine Checkbox, bis über „Löschen" eine Mehrfachauswahl beginnt', async () => {
    render(<HistoryPanel />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'chatActions Budget?' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /deleteItem/ }));

    const box = screen.getByRole('checkbox', { name: 'selectChat Budget?' });
    expect(box).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('selectedCount')).toBeInTheDocument();
    // In selection mode the card toggles instead of opening the chat.
    await userEvent.click(screen.getByTestId('history-item-title'));
    expect(handleSelectChat).not.toHaveBeenCalled();
    expect(box).toHaveAttribute('aria-checked', 'false');
  });

  it('löscht die Auswahl gesammelt und beendet danach den Auswahlmodus', async () => {
    render(<HistoryPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'chatActions Budget?' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /deleteItem/ }));
    await userEvent.click(screen.getByRole('button', { name: 'deleteSelected' }));
    expect(handleDeleteChats).toHaveBeenCalledWith(['c1']);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('benennt einen Chat aus dem Aktionsmenü um', async () => {
    render(<HistoryPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'chatActions Budget?' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /renameChat/ }));
    expect(handleRenameChat).toHaveBeenCalledWith('c1', 'Budget?');
  });

  // ORACLE: the sidebar's order — the app's primary navigation above the
  // topic's chats, in one column (AppChrome.tsx hands the rows in as `nav`).
  it('shows the primary navigation it is handed above the chat list', () => {
    render(<HistoryPanel nav={<Button type="button">navRow</Button>} />);
    const navRow = screen.getByRole('button', { name: 'navRow' });
    const firstChat = screen.getByText('Budget?');
    expect(navRow.compareDocumentPosition(firstChat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /* Die eingeklappte 60px-Schiene.
   *
   * `AppShellLayout` rendert `nav` in BEIDEN Zuständen — ausgeklappt als
   * Spalteninhalt, eingeklappt als `collapsedPreview`. Ohne eigenen Zweig
   * landete deshalb das ganze Panel in 60px Breite, mit Überschrift,
   * Datumszeilen und Löschknöpfen. Genau das prüfen die Abwesenheits-
   * Assertionen unten; sie sind die Regression, nicht die Symbolzahl.
   */
  it('zeigt eingeklappt „Neuer Chat" und ein Symbol je Verlaufseintrag, sonst nichts', async () => {
    collapsed = true;
    render(<HistoryPanel nav={<Button type="button" aria-label="navRow" />} />);

    // „Neuer Chat" zuerst, dann ein Knopf je Eintrag, benannt nach seinem
    // Titel — in 60px ist kein Platz für Text, ein Knopf ohne zugänglichen
    // Namen wäre für Screenreader leer.
    // ORACLE: dieselben vier Titel, die der ausgeklappte Test oben in
    // derselben Reihenfolge erwartet.
    const names = screen.getAllByRole('button').map(b => b.getAttribute('aria-label'));
    // The app's primary navigation (the frame's `nav`) follows „Neuer Chat".
    expect(names).toEqual(['newChat', 'navRow', 'Budget?']);
    await userEvent.click(screen.getByRole('button', { name: 'newChat' }));
    expect(handleNewChat).toHaveBeenCalled();

    // Und nichts von der ausgeklappten Ansicht.
    expect(screen.queryByText('history')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-item-title')).not.toBeInTheDocument();
  });

  it('zeigt das führende Emoji als Symbol, ausgeklappt wie in der Schiene', () => {
    extraChats = [{ id: 'c2', title: '🧪 Labor', createdAt: '2026-08-10T00:00:00Z' }];
    const { unmount } = render(<HistoryPanel />);
    expect(screen.getByText('Labor')).toBeInTheDocument();
    expect(screen.getByText('🧪')).toBeInTheDocument();
    unmount();
    collapsed = true;
    render(<HistoryPanel />);
    expect(screen.getByRole('button', { name: '🧪 Labor' })).toHaveTextContent('🧪');
  });

  it('öffnet aus der Schiene denselben Eintrag wie aus der Liste', async () => {
    collapsed = true;
    render(<HistoryPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Budget?' }));
    expect(handleSelectChat).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
  });

  it('markiert den offenen Chat in der Schiene', () => {
    collapsed = true;
    activeChatId = 'c1';
    render(<HistoryPanel />);
    expect(screen.getByRole('button', { name: 'Budget?' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'newChat' })).not.toHaveAttribute('aria-current');
  });
});