import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { GlobalKbSettings } from './GlobalKbSettings';
import type { KnowledgeBase } from '../types';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: 'admin' }, siteConfigs: {} }) }));
const theme = vi.hoisted(() => ({ t: (k: string) => k, language: 'de' }));
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => theme }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => toast }));

const kb = { id: 'kb-g', name: 'Global', isGlobal: true } as KnowledgeBase;
const RAW = 'dial tcp 10.0.0.7:443: connect: connection refused';

function refusal(status: number): AxiosError {
  const err = new AxiosError('Request failed');
  err.response = { data: { error: RAW }, status, statusText: '', headers: {}, config: { headers: {} } as unknown as InternalAxiosRequestConfig };
  return err;
}

beforeEach(() => {
  vi.mocked(axios.get).mockReset().mockResolvedValue({ data: [] });
  vi.mocked(axios.post).mockReset();
  for (const fn of Object.values(toast)) fn.mockReset();
});

function enter(placeholder: string, value: string) {
  const input = screen.getByPlaceholderText(placeholder);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

async function expectToast(key: string) {
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(key));
  expect(JSON.stringify(toast.error.mock.calls)).not.toContain(RAW);
}

// Oracle: docs/user-error-messages.md B08–B11 — the public-topic editor shows
// each action's own message, never the backend's `error` text.
describe('GlobalKbSettings source errors', () => {
  it.each([
    [400, 'urlInvalid'],
    [502, 'urlFetchFailed'],
    [404, 'urlFetchFailed'],
  ])('a URL fetch refused with %i shows %s', async (status, key) => {
    vi.mocked(axios.post).mockRejectedValue(refusal(status));
    render(<GlobalKbSettings kb={kb} onBack={vi.fn()} onOpenKb={vi.fn()} onUpdate={vi.fn()} />);
    enter('https://example.com/page', 'https://x.test/a');
    await expectToast(key);
  });

  it.each([400, 404])('adding an RSS feed refused with an uncoded %i shows rssFeedAddFailed', async (status) => {
    vi.mocked(axios.post).mockRejectedValue(refusal(status));
    render(<GlobalKbSettings kb={kb} onBack={vi.fn()} onOpenKb={vi.fn()} onUpdate={vi.fn()} />);
    enter('enterFeedUrl', 'https://x.test/feed');
    await expectToast('rssFeedAddFailed');
  });

  it.each([400, 404])('a crawl refused with an uncoded %i shows addSourcesFailed', async (status) => {
    vi.mocked(axios.post).mockRejectedValue(refusal(status));
    render(<GlobalKbSettings kb={kb} onBack={vi.fn()} onOpenKb={vi.fn()} onUpdate={vi.fn()} />);
    enter('https://example.com', 'https://x.test');
    await expectToast('addSourcesFailed');
  });

  it('a crawl job that fails shows addSourcesFailed, not the job error', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { jobId: 'j1' } });
    vi.mocked(axios.get).mockImplementation(async (url: string) => (
      url.includes('/crawl/status/') ? { data: { state: 'failed', error: RAW } } : { data: [] }
    ));
    render(<GlobalKbSettings kb={kb} onBack={vi.fn()} onOpenKb={vi.fn()} onUpdate={vi.fn()} />);
    enter('https://example.com', 'https://x.test');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('addSourcesFailed'), { timeout: 4000 });
    expect(JSON.stringify(toast.error.mock.calls)).not.toContain(RAW);
  });
});
