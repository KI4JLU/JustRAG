import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FileEntry } from '../../types';
import { SourcesHeader } from './SourcesHeader';

vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));

const retryAllFailed = vi.fn();
let files: FileEntry[] = [];

vi.mock('../../contexts/KbDataContext', () => ({
  useKbData: () => ({ fileMgmt: { files, retryAllFailed } }),
}));

const makeFile = (over: Partial<FileEntry>): FileEntry => ({
  id: 'f-1', name: 'a.pdf', status: 'ready', origin: 'upload', selected: true, ...over,
} as FileEntry);

beforeEach(() => {
  files = [];
  vi.clearAllMocks();
});

describe('SourcesHeader', () => {
  it('zählt nur die fehlgeschlagenen Dateien', async () => {
    // Der Oracle ist von Hand ausgezählt und weicht bewusst von der Gesamtzahl
    // ab: drei Dateien, zwei davon mit status 'error'. Eine Zählung, die
    // versehentlich `files.length` nimmt, käme auf 3 und wird daran rot.
    files = [
      makeFile({ id: 'f-1', status: 'error' }),
      makeFile({ id: 'f-2', name: 'b.pdf', status: 'error' }),
      makeFile({ id: 'f-3', name: 'c.pdf' }),
    ];
    render(<SourcesHeader />);

    // Keine Überschrift: die Spalte trägt „Quellen" bereits als
    // `AppShellPanel.label`, also als Namen ihres complementary-Landmarks.
    // Ein <h2> daneben schriebe denselben Namen ein zweites Mal auf.
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /retryAllFailedShort \(2\)/ });
    await userEvent.click(btn);
    expect(retryAllFailed).toHaveBeenCalledTimes(1);
  });

  it('bleibt leer, wenn nichts fehlgeschlagen ist', () => {
    files = [makeFile({})];
    render(<SourcesHeader />);
    expect(screen.queryByText(/retryAllFailedShort/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
