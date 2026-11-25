import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import ConfluenceTokenManager from './ConfluenceTokenManager';
import type { ConfluenceConnectionInfo } from '../../types';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});
// Stable across renders, like the real context: fetchConnection depends on t.
const theme = vi.hoisted(() => ({ t: (k: string) => k }));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => theme }));
const modal = vi.hoisted(() => ({ showConfirm: () => Promise.resolve(true) }));
vi.mock('../../contexts/ModalContext', () => ({ useModalContext: () => modal }));

const RAW = 'confluence: 401 Unauthorized from https://wiki.internal';

function refusal(status: number): AxiosError {
  const err = new AxiosError('Request failed');
  err.response = {
    data: { error: RAW },
    status,
    statusText: '',
    headers: {},
    config: { headers: {} } as unknown as InternalAxiosRequestConfig,
  };
  return err;
}

const info = (over: Partial<NonNullable<ConfluenceConnectionInfo['connection']>> = {}): ConfluenceConnectionInfo => ({
  enabled: true,
  baseUrl: 'https://wiki',
  connection: {
    id: 'conn-1', userId: 'u', displayName: 'me', token: '••••1234', status: 'active',
    errorMessage: null, lastVerifiedAt: null, createdAt: '2026-01-01T00:00:00Z', ...over,
  },
});

beforeEach(() => {
  for (const fn of [axios.get, axios.post, axios.put, axios.delete]) vi.mocked(fn).mockReset();
});

// Oracle: docs/user-error-messages.md A38–A42 — every Confluence-connection
// error is the feature's own message; the backend's or Confluence's text is
// never shown.
describe('ConfluenceTokenManager errors', () => {
  it.each([400, 404])('saving a token refused with an uncoded %i shows confluenceProfileSaveError', async (status) => {
    vi.mocked(axios.get).mockResolvedValue({ data: { enabled: true, baseUrl: 'https://wiki', connection: null } });
    vi.mocked(axios.post).mockRejectedValue(refusal(status));
    const user = userEvent.setup();
    render(<ConfluenceTokenManager />);
    await user.type(await screen.findByPlaceholderText('confluencePatLabel'), 'tok{Enter}');
    expect(await screen.findByText('confluenceProfileSaveError')).toBeInTheDocument();
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();
  });

  it.each([400, 404])('verify refused with an uncoded %i shows confluenceProfileVerifyFailed', async (status) => {
    vi.mocked(axios.get).mockResolvedValue({ data: info() });
    vi.mocked(axios.post).mockRejectedValue(refusal(status));
    const user = userEvent.setup();
    render(<ConfluenceTokenManager />);
    await user.click(await screen.findByText('confluenceProfileVerify'));
    expect(await screen.findByText('confluenceProfileVerifyFailed')).toBeInTheDocument();
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();
  });

  it('verify answering ok:false shows confluenceProfileVerifyFailed, not its error', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: info() });
    vi.mocked(axios.post).mockResolvedValue({ data: { ok: false, error: RAW } });
    const user = userEvent.setup();
    render(<ConfluenceTokenManager />);
    await user.click(await screen.findByText('confluenceProfileVerify'));
    expect(await screen.findByText('confluenceProfileVerifyFailed')).toBeInTheDocument();
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();
  });

  it.each([400, 404])('removing refused with an uncoded %i shows confluenceProfileDeleteError', async (status) => {
    vi.mocked(axios.get).mockResolvedValue({ data: info() });
    vi.mocked(axios.delete).mockRejectedValue(refusal(status));
    const user = userEvent.setup();
    render(<ConfluenceTokenManager />);
    await user.click(await screen.findByText('delete'));
    expect(await screen.findByText('confluenceProfileDeleteError')).toBeInTheDocument();
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();
  });

  it('a stored connection error shows confluenceProfileConnectionFailed, not the stored text', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: info({ status: 'error', errorMessage: RAW }) });
    render(<ConfluenceTokenManager />);
    expect(await screen.findByText('confluenceProfileConnectionFailed')).toBeInTheDocument();
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();
  });

  it('a token that cannot be decrypted shows confluenceProfileTokenUnreadable', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: info({ status: 'error', errorMessage: 'token could not be decrypted' }) });
    render(<ConfluenceTokenManager />);
    expect(await screen.findByText('confluenceProfileTokenUnreadable')).toBeInTheDocument();
    expect(screen.queryByText(/could not be decrypted/)).not.toBeInTheDocument();
  });
});
