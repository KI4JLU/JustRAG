import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import Login from './Login';
import { withRouter } from '../test/withRouter';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get: vi.fn(), post: vi.fn() } };
});
vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
  getMotionProps: () => ({}),
}));
const theme = vi.hoisted(() => ({
  theme: 'light' as const,
  resolvedTheme: 'light' as const,
  setTheme: () => {},
  language: 'en' as const,
  setLanguage: () => {},
  t: (key: string) => key,
}));
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => theme }));

function refusal(status: number, error: string): AxiosError {
  const err = new AxiosError('Request failed');
  err.response = { data: { error }, status, statusText: '', headers: {}, config: { headers: {} } as unknown as InternalAxiosRequestConfig };
  return err;
}

async function submit() {
  const user = userEvent.setup();
  render(withRouter(<Login onLogin={vi.fn()} siteConfigs={{}} />));
  await user.type(await screen.findByLabelText('username'), 'alice');
  await user.type(screen.getByLabelText('password'), 'secret-pw');
  await user.click(screen.getByRole('button', { name: 'login' }));
}

beforeEach(() => {
  vi.mocked(axios.get).mockReset().mockResolvedValue({ data: { providers: [], localAuthEnabled: true } });
  vi.mocked(axios.post).mockReset();
  window.history.pushState({}, '', '/');
});

// Oracle: docs/user-error-messages.md A23–A29 — the login shows its own
// messages, told apart by status, never the backend's `error` text.
describe('Login errors', () => {
  it.each([
    [401, 'Invalid username or password', 'invalidCredentials'],
    [400, 'Username must be between 3 and 50 characters', 'invalidCredentials'],
    [404, 'not found', 'invalidCredentials'],
    [500, 'Internal server error', 'loginUnavailable'],
    [429, 'Too many login attempts', 'errorRateLimited'],
  ])('a %i shows %s, not the raw text', async (status, raw, key) => {
    vi.mocked(axios.post).mockRejectedValue(refusal(status, raw));
    await submit();
    expect(await screen.findByText(key)).toBeInTheDocument();
    expect(screen.queryByText(raw)).not.toBeInTheDocument();
  });

  it('no response shows loginUnavailable, not wrong credentials', async () => {
    vi.mocked(axios.post).mockRejectedValue(new AxiosError('Network Error'));
    await submit();
    expect(await screen.findByText('loginUnavailable')).toBeInTheDocument();
    expect(screen.queryByText('invalidCredentials')).not.toBeInTheDocument();
  });

  it('an OIDC callback error shows its message without the code', async () => {
    window.history.pushState({}, '', '/?oidc_error=state_mismatch');
    render(withRouter(<Login onLogin={vi.fn()} siteConfigs={{}} />));
    expect(await screen.findByText('oidcLoginExpired')).toBeInTheDocument();
    expect(screen.queryByText(/state_mismatch/)).not.toBeInTheDocument();
  });
});
