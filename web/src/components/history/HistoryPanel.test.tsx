import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HistoryPanel } from './HistoryPanel';

const setKbView = vi.fn();
const handleSelectChat = vi.fn();
const handleSelectContent = vi.fn();
const handleNewChat = vi.fn();
const handleDeleteChat = vi.fn();
const handleDeleteGeneratedContent = vi.fn();

let activeChatId: string | null = null;

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
        { id: 'r1', title: 'Zero-Trust', createdAt: '2026-08-14T00:00:00Z', type: 'research' },
        { id: 'a1', title: 'Paper', createdAt: '2026-08-12T00:00:00Z', type: 'academic_research' },
      ],
      activeChatId, handleSelectChat, handleDeleteChat, handleNewChat,
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
  collapsed = false;
});

describe('HistoryPanel', () => {
  it('zeigt alle vier Arten in einer Liste, chronologisch', () => {
    render(<HistoryPanel />);
    const titles = screen.getAllByTestId('history-item-title').map(e => e.textContent);
    expect(titles).toEqual(['Analyse: Budget', 'Zero-Trust', 'Paper', 'Budget?']);
  });

  it('öffnet ein Artefakt im Workspace-Reiter', async () => {
    render(<HistoryPanel />);
    await userEvent.click(screen.getByText('Analyse: Budget'));
    expect(handleSelectContent).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1' }));
    expect(setKbView).toHaveBeenCalledWith('workspace');
  });

  it('öffnet eine Recherche im Bericht-Reiter, nicht im Workspace', async () => {
    render(<HistoryPanel />);
    await userEvent.click(screen.getByText('Zero-Trust'));
    expect(handleSelectChat).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
    expect(setKbView).toHaveBeenCalledWith('research');
    expect(setKbView).not.toHaveBeenCalledWith('workspace');
  });

  it('öffnet eine Academic-Session im Academic-Reiter', async () => {
    render(<HistoryPanel />);
    await userEvent.click(screen.getByText('Paper'));
    expect(setKbView).toHaveBeenCalledWith('academic_research');
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

  it('löscht ein Artefakt über handleDeleteGeneratedContent, nicht über handleDeleteChat', async () => {
    render(<HistoryPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'deleteItem Analyse: Budget' }));
    expect(handleDeleteGeneratedContent).toHaveBeenCalledWith('g1', expect.anything());
    expect(handleDeleteChat).not.toHaveBeenCalled();
  });

  it('löscht einen Chat über handleDeleteChat, nicht über handleDeleteGeneratedContent', async () => {
    render(<HistoryPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'deleteItem Budget?' }));
    expect(handleDeleteChat).toHaveBeenCalledWith('c1', expect.anything());
    expect(handleDeleteGeneratedContent).not.toHaveBeenCalled();
  });

  /* Die eingeklappte 60px-Schiene.
   *
   * `AppShellLayout` rendert `nav` in BEIDEN Zuständen — ausgeklappt als
   * Spalteninhalt, eingeklappt als `collapsedPreview`. Ohne eigenen Zweig
   * landete deshalb das ganze Panel in 60px Breite, mit Überschrift,
   * Datumszeilen und Löschknöpfen. Genau das prüfen die Abwesenheits-
   * Assertionen unten; sie sind die Regression, nicht die Symbolzahl.
   */
  it('zeigt eingeklappt ein Symbol je Verlaufseintrag, sonst nichts', () => {
    collapsed = true;
    render(<HistoryPanel />);

    // Ein Knopf je Eintrag, benannt nach seinem Titel — in 60px ist kein Platz
    // für Text, ein Knopf ohne zugänglichen Namen wäre für Screenreader leer.
    // ORACLE: dieselben vier Titel, die der ausgeklappte Test oben in
    // derselben Reihenfolge erwartet.
    const names = screen.getAllByRole('button').map(b => b.getAttribute('aria-label'));
    expect(names).toEqual(['Analyse: Budget', 'Zero-Trust', 'Paper', 'Budget?']);

    // Und nichts von der ausgeklappten Ansicht.
    expect(screen.queryByText('history')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-item-title')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'newChat' })).not.toBeInTheDocument();
  });

  it('öffnet aus der Schiene denselben Eintrag wie aus der Liste', async () => {
    collapsed = true;
    render(<HistoryPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Analyse: Budget' }));
    expect(handleSelectContent).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1' }));
    expect(setKbView).toHaveBeenCalledWith('workspace');
  });

  it('markiert den offenen Chat in der Schiene', () => {
    collapsed = true;
    activeChatId = 'c1';
    render(<HistoryPanel />);
    expect(screen.getByRole('button', { name: 'Budget?' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Zero-Trust' })).not.toHaveAttribute('aria-current');
  });
});