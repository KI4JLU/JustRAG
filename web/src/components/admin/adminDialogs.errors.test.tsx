import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { KbTransferOwnerDialog } from './KbTransferOwnerDialog';
import { AdminUnpublishDialog } from './AdminUnpublishDialog';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get: vi.fn() } };
});
const theme = vi.hoisted(() => ({ t: (k: string) => k }));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => theme }));

const RAW = 'sql: no rows in result set';

function refusal(status: number): AxiosError {
  const err = new AxiosError('Request failed');
  err.response = { data: { error: RAW }, status, statusText: '', headers: {}, config: { headers: {} } as unknown as InternalAxiosRequestConfig };
  return err;
}

beforeEach(() => { vi.mocked(axios.get).mockReset(); });

const common = { busy: false, error: null, onCancel: () => {}, onConfirm: () => {} };

// Oracle: docs/user-error-messages.md C16, C17 — a refused load shows the
// dialog's own message, never the backend's `error` text.
describe.each([400, 404])('admin dialogs on an uncoded %i', (status) => {
  it('KbTransferOwnerDialog shows kbTransferUsersLoadError', async () => {
    vi.mocked(axios.get).mockRejectedValue(refusal(status));
    render(<KbTransferOwnerDialog {...common} kbName="A" currentOwnerId={null} currentOwnerName={null} />);
    expect(await screen.findByText('kbTransferUsersLoadError')).toBeInTheDocument();
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();
  });

  it('AdminUnpublishDialog shows unpublishImpactLoadError', async () => {
    vi.mocked(axios.get).mockRejectedValue(refusal(status));
    render(<AdminUnpublishDialog {...common} kbId="kb-1" kbName="A" currentUserId="u1" />);
    expect(await screen.findByText('unpublishImpactLoadError')).toBeInTheDocument();
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();
  });
});
