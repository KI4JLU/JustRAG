import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserSettingsModal, type SettingsTab } from './UserSettingsModal';

// Translation keys stand in for the labels, so the assertions name the setting, not its wording.
const themeMock = { t: (k: string) => k, theme: 'light', setTheme: vi.fn(), language: 'de', setLanguage: vi.fn() };
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null, siteConfigs: {} }) }));

/** A real in-memory Storage, installed fresh per test (jsdom's is unreliable on Node 25). */
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

function renderTab(tab: SettingsTab) {
  return render(<UserSettingsModal open onOpenChange={() => {}} tab={tab} onTabChange={() => {}} />);
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});

describe('UserSettingsModal — Chat section', () => {
  // Oracle: the requested layout — suggestions, follow-ups and autoscroll live under "Chat".
  it('holds the suggestions, follow-ups and autoscroll switches', () => {
    renderTab('chat');
    expect(screen.getByRole('switch', { name: 'promptSuggestions' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'followUpsLabel' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'autoScrollLabel' })).toBeInTheDocument();
  });

  it('no longer shows the chat switches under General', () => {
    renderTab('general');
    expect(screen.queryByRole('switch', { name: 'promptSuggestions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'followUpsLabel' })).not.toBeInTheDocument();
  });

  // Oracle: the product decision that the transcript does not follow an answer unless asked to,
  // and the storage convention of useStoredFlag ('1'/'0' under a `justrag.` key).
  it('starts with autoscroll off and remembers turning it on', async () => {
    renderTab('chat');
    const toggle = screen.getByRole('switch', { name: 'autoScrollLabel' });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(localStorage.getItem('justrag.chat.autoScroll')).toBe('1');
  });

  it('reads a stored autoscroll choice', () => {
    localStorage.setItem('justrag.chat.autoScroll', '1');
    renderTab('chat');
    expect(screen.getByRole('switch', { name: 'autoScrollLabel' })).toBeChecked();
  });
});
