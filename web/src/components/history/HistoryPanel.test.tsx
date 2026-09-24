import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HistoryPanel } from './HistoryPanel';

const setKbView = vi.fn();
const handleSelectChat = vi.fn();
const handleSelectContent = vi.fn();
const handleNewChat = vi.fn();
const handleDeleteChat = vi.fn();
const handleRenameChat = vi.fn();
const handleDeleteChats = vi.fn(async () => true);
const handleDeleteGeneratedContent = vi.fn();

let activeChatId: string | null = null;
let extraChats: { id: string; title: string; createdAt: string }[] = [];

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
vi.mock('../../contexts/KbCoreContext', () => ({
  useKbCore: () => ({ currentKb: { id: 'kb1' }, setKbView, handleGoHome: vi.fn() }),
}));
vi.mock('../../contexts/KbChatContext', () => ({
  useKbChat: () => ({
    chat: {
      chats: [
        { id: 'c1', title: 'Budget?', createdAt: '2026-08-10T00:00:00Z' },
        ...extraChats,
        { id: 'r1', title: 'Zero-Trust', createdAt: '2026-08-14T00:00:00Z', type: 'research' },
        { id: 'a1', title: 'Paper', createdAt: '2026-08-12T00:00:00Z', type: 'academic_research' },
      ],
      activeChatId, handleSelectChat, handleDeleteChat, handleDeleteChats, handleRenameChat, handleNewChat,
    },
  }),
}));
vi.mock('../../contexts/KbDataContext', () => ({
  useKbData: () => ({
    content: {
      generatedContent: [{ id: 'g1', title: 'Analyse: Budget', createdAt: '2026-08-16T00:00:00Z', type: 'analysis', content: { text: '' } }],
      generating: false, handleDeleteGeneratedContent, podcastProgress: null,
    },
    handleSelectContent,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  activeChatId = null;
  extraChats = [];
  collapsed = false;
});

describe('HistoryPanel', () => {
  it('zeigt nur Chats — keine Artefakte, Recherchen oder Academic-Sitzungen (22.09.2026)', () => {
    // Der Mock enthält alle vier Arten (g1 Artefakt, r1 Recherche, a1
    // Academic, c1 Chat). Nur der Chat erscheint: die drei anderen öffneten
    // Ansichten, die nicht mehr erreichbar sind, und `handleSelectChat`
    // würde eine Recherche ohnehin nicht als Chat laden.
    render(<HistoryPanel />);
    const titles = screen.getAllByTestId('history-item-title').map(e => e.textContent);
    expect(titles).toEqual(['Budget?']);
    for (const hidden of ['Analyse: Budget', 'Zero-Trust', 'Paper']) {
      expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    }
    expect(handleSelectContent).not.toHaveBeenCalled();
  });

  it('gruppiert die Chats nach Tag statt je Zeile ein Datum zu zeigen', () => {
    render(<HistoryPanel />);
    // Fixture chats are all from August 2026 (see mock): one group per day,
    // labelled with the long date, and no per-row date text.
    const labels = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);
    expect(labels).toEqual(['August 10, 2026']);
    expect(screen.queryByText(/8\/10\/2026|10\.8\.2026/)).not.toBeInTheDocument();
  });

  it('öffnet einen Chat im Chat-Reiter', async () => {
    render(<HistoryPanel />);
    await userEvent.click(screen.getByText('Budget?'));
    expect(handleSelectChat).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
    expect(setKbView).toHaveBeenCalledWith('chat');
  });

  it('legt über den Plus-Knopf einen neuen Chat an', async () => {
    render(<HistoryPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'newChat' }));
    expect(handleNewChat).toHaveBeenCalled();
  });

  it('lädt den bereits offenen Chat nicht neu, wechselt aber trotzdem den Reiter', async () => {
    activeChatId = 'c1';
    render(<HistoryPanel />);
    await userEvent.click(screen.getByText('Budget?'));
    expect(handleSelectChat).not.toHaveBeenCalled();
    expect(setKbView).toHaveBeenCalledWith('chat');
  });

  it('bringt keinen eigenen Rahmen mehr mit — die Spalte gehört der Shell', () => {
    // Bis zum Umzug auf `AppShellLayout` brachte dieses Panel seinen eigenen
    // `SidebarShell` mit: ein <aside> mit eigener Breite, eigenem Einklapp-
    // Knopf und eigenem Zustand. Die Shell stellt jetzt genau diesen Rahmen
    // (ihr `SidePanel`), und zwei ineinander steckende Rahmen hießen zwei
    // Knöpfe und zwei Breiten für eine Spalte.
    //
    // Der Oracle ist NICHT die Ausgabe dieser Komponente, sondern die
    // Zuständigkeit: `KbWorkspaceLayout` hängt das Panel in `nav` ein und
    // führt links `isLeftSidebarOpen` — geprüft in KbWorkspaceLayout.test.tsx.
    // Hier bleibt die Gegenprobe: das Panel selbst führt nichts davon.
    const { container } = render(<HistoryPanel />);
    expect(container.querySelector('aside')).toBeNull();
    expect(screen.getByText('history')).toBeInTheDocument();
  });

  it('löscht einen Chat aus dem Aktionsmenü über handleDeleteChat, nicht über handleDeleteGeneratedContent', async () => {
    render(<HistoryPanel />);
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'chatActions Budget?' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /deleteItem/ }));
    expect(handleDeleteChat).toHaveBeenCalledWith('c1', expect.anything());
    expect(handleDeleteGeneratedContent).not.toHaveBeenCalled();
  });

  it('öffnet den Chat beim Klick auf die Kartenfläche, nicht aber über das Aktionsmenü', async () => {
    render(<HistoryPanel />);
    await userEvent.click(screen.getByText('August 10, 2026').nextElementSibling!.querySelector('li')!);
    expect(handleSelectChat).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'chatActions Budget?' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /renameChat/ }));
    expect(handleSelectChat).toHaveBeenCalledTimes(1);
  });

  it('zeigt keine Checkbox, bis über „Auswählen" eine Mehrfachauswahl beginnt', async () => {
    render(<HistoryPanel />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'chatActions Budget?' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /selectChats/ }));

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
    await userEvent.click(screen.getByRole('menuitem', { name: /selectChats/ }));
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
    render(<HistoryPanel />);

    // „Neuer Chat" zuerst, dann ein Knopf je Eintrag, benannt nach seinem
    // Titel — in 60px ist kein Platz für Text, ein Knopf ohne zugänglichen
    // Namen wäre für Screenreader leer.
    // ORACLE: dieselben vier Titel, die der ausgeklappte Test oben in
    // derselben Reihenfolge erwartet.
    const names = screen.getAllByRole('button').map(b => b.getAttribute('aria-label'));
    expect(names).toEqual(['newChat', 'Budget?']);
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
    expect(setKbView).toHaveBeenCalledWith('chat');
  });

  it('markiert den offenen Chat in der Schiene', () => {
    collapsed = true;
    activeChatId = 'c1';
    render(<HistoryPanel />);
    expect(screen.getByRole('button', { name: 'Budget?' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'newChat' })).not.toHaveAttribute('aria-current');
  });
});