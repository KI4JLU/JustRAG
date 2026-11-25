import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import ApiKeyManager from './ApiKeyManager';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});
// Stable across renders, like the real context: fetchKeys depends on t.
const theme = vi.hoisted(() => ({ t: (k: string) => k, language: 'de' }));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => theme }));
const modal = vi.hoisted(() => ({ showConfirm: () => Promise.resolve(true) }));
vi.mock('../../contexts/ModalContext', () => ({ useModalContext: () => modal }));

const RAW = 'maximum of 10 API keys per user reached';

beforeEach(() => {
  vi.mocked(axios.get).mockReset().mockResolvedValue({ data: [] });
  vi.mocked(axios.post).mockReset();
});

// Oracle: docs/user-error-messages.md A43 — a refused create shows
// apiKeyCreateError, never the backend's `error` text.
describe('ApiKeyManager create errors', () => {
  it.each([400, 404])('an uncoded %i shows apiKeyCreateError', async (status) => {
    const err = new AxiosError('Request failed');
    err.response = { data: { error: RAW }, status, statusText: '', headers: {}, config: { headers: {} } as unknown as InternalAxiosRequestConfig };
    vi.mocked(axios.post).mockRejectedValue(err);
    const user = userEvent.setup();
    render(<ApiKeyManager />);
    await user.type(await screen.findByPlaceholderText('apiKeyNamePlaceholder'), 'ci{Enter}');
    expect(await screen.findByText('apiKeyCreateError')).toBeInTheDocument();
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();
  });
});
