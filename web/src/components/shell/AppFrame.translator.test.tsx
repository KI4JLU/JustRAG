import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import type { AppShellLayoutProps } from '@ki4jlu/design-system';
import { AppFrame } from './AppChrome';
import { resetTranslatorConfig } from '../translator/translatorConfig';

/*
 * The translation extension's entry in the navigation. ORACLE: the contract
 * (docs/api-contracts/translator.md): the UI reads `config.enabled` of GET /api/translator/config
 * to show or hide the entry; a role without the permission gets 403 there and sees no entry. The
 * shell itself is the design system's (stubbed, as in AppFrame.topic.test.tsx); what is asserted
 * is the nav it is handed.
 */
vi.mock('axios');
vi.mock('../../api', () => ({ API_BASE_URL: '' }));

vi.mock('@ki4jlu/design-system', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    usePersistedWidth: () => [320, vi.fn()] as const,
    AppShellLayout: (props: AppShellLayoutProps) => (
      <div>
        <div data-testid="shell-nav">{props.nav}</div>
        <div data-testid="shell-main">{props.children}</div>
      </div>
    ),
  };
});
vi.mock('../history/HistoryPanel', () => ({
  HistoryPanel: ({ nav }: { nav: React.ReactNode }) => <div>{nav}</div>,
  NewChatButton: () => null,
}));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));
vi.mock('./HistoryControls', () => ({ HistoryControls: () => null }));
vi.mock('./DesktopMenuCommands', () => ({ DesktopMenuCommands: () => null }));
const onViewTranslator = vi.fn();
vi.mock('../../contexts/AppNavContext', () => ({
  useAppNav: () => ({
    onViewMyTopics: vi.fn(), onViewSharedTopics: vi.fn(), onViewDiscover: vi.fn(), onViewTranslator,
    onOpenTopic: vi.fn(), onOpenSource: vi.fn(), onOpenChat: vi.fn(),
  }),
}));
vi.mock('../../contexts/KbSearchContext', () => ({
  useKbSearch: () => ({
    query: '', setQuery: vi.fn(), applyCatalogQuery: vi.fn(),
    focusPendingFor: null, requestFocus: vi.fn(), consumeFocus: vi.fn(),
  }),
}));
vi.mock('../../hooks/useAccountSearchGroup', () => ({ useAccountSearchGroup: () => ({ heading: '', items: [] }) }));
vi.mock('../search/GlobalSearch', () => ({ GlobalSearch: () => null }));
vi.mock('./AppUserMenu', () => ({ AppUserMenu: () => null }));
vi.mock('../search/SearchPalette', () => ({ SearchNavRow: () => null, SearchPalette: () => null }));
vi.mock('../../hooks/useSidebarCollapse', () => ({ useSidebarCollapse: () => ({ collapsed: false, onCollapsedChange: vi.fn() }) }));
let userId = 'u1';
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: userId, role: 'user' }, siteConfigs: {} }) }));

function config(enabled: boolean) {
  vi.mocked(axios.get).mockResolvedValue({ data: { enabled, defaultTargetLanguage: 'en-gb', languages: [], glossaryLanguages: [], model: '', modelSource: '', limits: {} } });
}

beforeEach(() => {
  vi.clearAllMocks();
  userId = 'u1';
  resetTranslatorConfig();
});

const renderFrame = (active: 'my-topics' | 'translator' = 'my-topics') =>
  render(<AppFrame active={active}><div data-testid="page" /></AppFrame>);

describe('AppFrame — Übersetzung in the navigation', () => {
  it('shows the entry while the translator is switched on, and it opens the page', async () => {
    config(true);
    renderFrame();
    const entry = await screen.findByRole('button', { name: 'translatorNav' });
    await userEvent.click(entry);
    expect(onViewTranslator).toHaveBeenCalledTimes(1);
    expect(vi.mocked(axios.get)).toHaveBeenCalledWith('/api/translator/config', expect.anything());
  });

  it('marks the entry as the current page on the translator page', async () => {
    config(true);
    renderFrame('translator');
    expect(await screen.findByRole('button', { name: 'translatorNav' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'myTopics' })).not.toHaveAttribute('aria-current');
  });

  it('hides the entry while the translator is off', async () => {
    config(false);
    renderFrame();
    await waitFor(() => expect(axios.get).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'myTopics' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'translatorNav' })).toBeNull();
  });

  it('hides the entry for a role without the permission (the config answers 403)', async () => {
    vi.mocked(axios.get).mockRejectedValue(Object.assign(new Error('403'), { response: { status: 403 } }));
    renderFrame();
    await waitFor(() => expect(axios.get).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'translatorNav' })).toBeNull();
  });

  it('reads the config again when another user signs in', async () => {
    config(true);
    const { rerender } = renderFrame();
    await screen.findByRole('button', { name: 'translatorNav' });
    config(false);
    userId = 'u2';
    rerender(<AppFrame active="my-topics"><div data-testid="page" /></AppFrame>);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'translatorNav' })).toBeNull());
  });
});
