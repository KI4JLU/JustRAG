import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../contexts/ThemeContext';
import { AuthProvider } from '../contexts/AuthContext';
import type { User } from '../types';
import { SYSTEM_NOTICE_DISMISSED_KEY, useSystemNoticeBanner } from './useSystemNoticeBanner';

// jsdom's localStorage is unusable on Node 25: an in-memory Storage per test.
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

function Banner() {
  const { notice, status, statusPosition } = useSystemNoticeBanner();
  return (
    <>
      {notice && <div data-testid="notice-slot">{notice}</div>}
      {status && <div data-testid="status-slot" data-position={statusPosition}>{status}</div>}
    </>
  );
}

const USER = { id: 'u1', username: 'jamie', role: 'user' } as User;

function renderBanner(siteConfigs: Record<string, string>) {
  const tree = (configs: Record<string, string>) => (
    <ThemeProvider>
      <AuthProvider user={USER} token="t" logout={() => {}} updateUser={() => {}} siteConfigs={configs}>
        <Banner />
      </AuthProvider>
    </ThemeProvider>
  );
  const result = render(tree(siteConfigs));
  return { ...result, rerenderWith: (configs: Record<string, string>) => result.rerender(tree(configs)) };
}

const NOTICE = {
  system_notice_enabled: 'true',
  system_notice_text: 'Das Feature befindet sich gerade noch im Testbetrieb.',
  system_notice_tone: 'warning',
  system_notice_dismissible: 'true',
};

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSystemNoticeBanner', () => {
  it('renders nothing while the notice is off', () => {
    const { container } = renderBanner({ ...NOTICE, system_notice_enabled: 'false' });
    expect(container).toBeEmptyDOMElement();
  });

  // A system state is announced: politely when degraded, assertively only
  // for an outage (error tone).
  it('announces a warning as a status and an outage as an alert', () => {
    const { rerenderWith } = renderBanner(NOTICE);
    expect(screen.getByRole('status')).toHaveTextContent(NOTICE.system_notice_text);
    expect(screen.queryByRole('alert')).toBeNull();

    rerenderWith({ ...NOTICE, system_notice_tone: 'error' });
    expect(screen.getByRole('alert')).toHaveTextContent(NOTICE.system_notice_text);
    expect(screen.queryByRole('status')).toBeNull();
  });

  // Placement by severity: an outage is the full-width banner, everything
  // else the floating pill.
  it('puts an outage in the banner slot and other tones in the status slot', () => {
    const { rerenderWith } = renderBanner(NOTICE);
    expect(screen.getByTestId('status-slot')).toHaveTextContent(NOTICE.system_notice_text);
    expect(screen.queryByTestId('notice-slot')).toBeNull();

    rerenderWith({ ...NOTICE, system_notice_tone: 'error' });
    expect(screen.getByTestId('notice-slot')).toHaveTextContent(NOTICE.system_notice_text);
    expect(screen.queryByTestId('status-slot')).toBeNull();
  });

  // The admin's placement wins over the tone: any tone can be the banner,
  // an outage can be a toast. Oracle: the slot the alert lands in, its
  // position, and the DS layout it is drawn with.
  it('puts the notice where the admin placed it, whatever its tone', () => {
    const { rerenderWith } = renderBanner({ ...NOTICE, system_notice_placement: 'banner' });
    expect(screen.getByTestId('notice-slot')).toHaveTextContent(NOTICE.system_notice_text);
    expect(screen.getByRole('status')).toHaveAttribute('data-layout', 'banner');
    expect(screen.queryByTestId('status-slot')).toBeNull();

    rerenderWith({ ...NOTICE, system_notice_placement: 'toast' });
    expect(screen.getByTestId('status-slot')).toHaveAttribute('data-position', 'bottom-end');
    expect(screen.getByRole('status')).toHaveAttribute('data-layout', 'toast');
    expect(screen.queryByTestId('notice-slot')).toBeNull();

    rerenderWith({ ...NOTICE, system_notice_tone: 'error', system_notice_placement: 'inline' });
    expect(screen.getByTestId('status-slot')).toHaveAttribute('data-position', 'top');
    // Still announced as an outage: the role follows the tone, not the place.
    expect(screen.getByRole('alert')).toHaveAttribute('data-layout', 'pill');
  });

  it('shows the title before the text', () => {
    renderBanner({ ...NOTICE, system_notice_title: 'Hohe Auslastung' });
    expect(screen.getByRole('status')).toHaveTextContent(`Hohe Auslastung${NOTICE.system_notice_text}`);
  });

  it('comes back when the admin edits the title', async () => {
    const { rerenderWith } = renderBanner({ ...NOTICE, system_notice_title: 'A' });
    await userEvent.click(screen.getByRole('button', { name: /schließen|close/i }));
    rerenderWith({ ...NOTICE, system_notice_title: 'B' });
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('stays closed after a dismiss, also on the next mount', async () => {
    const { unmount } = renderBanner(NOTICE);
    await userEvent.click(screen.getByRole('button', { name: /schließen|close/i }));
    expect(screen.queryByText(NOTICE.system_notice_text)).toBeNull();
    expect(localStorage.getItem(SYSTEM_NOTICE_DISMISSED_KEY)).not.toBeNull();
    unmount();

    renderBanner(NOTICE);
    expect(screen.queryByText(NOTICE.system_notice_text)).toBeNull();
  });

  it('comes back when the admin edits the message', async () => {
    const { rerenderWith } = renderBanner(NOTICE);
    await userEvent.click(screen.getByRole('button', { name: /schließen|close/i }));
    rerenderWith({ ...NOTICE, system_notice_text: 'Wartung am Freitag ab 18 Uhr.' });
    expect(screen.getByText('Wartung am Freitag ab 18 Uhr.')).toBeInTheDocument();
  });

  it('has no close button when the notice is not dismissible', () => {
    renderBanner({ ...NOTICE, system_notice_dismissible: 'false' });
    expect(screen.getByText(NOTICE.system_notice_text)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens an external link in a new tab and keeps an app path in place', () => {
    const { rerenderWith } = renderBanner({ ...NOTICE, system_notice_link_url: 'https://www.uni-giessen.de/wartung', system_notice_link_label: 'Details' });
    const external = screen.getByRole('link', { name: 'Details' });
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noopener noreferrer');

    rerenderWith({ ...NOTICE, system_notice_link_url: '/kb/abc', system_notice_link_label: '' });
    const internal = screen.getByRole('link');
    expect(internal).toHaveAttribute('href', '/kb/abc');
    expect(internal).not.toHaveAttribute('target');
    expect(internal.textContent).not.toBe('');
  });
});
