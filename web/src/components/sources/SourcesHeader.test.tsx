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

// Wave-5 Task 6 (moved here from SourcesSection with the header): the count of
// flagged external-origin files. rss/confluence/git files are folded into their
// feed/source rows and have no own row, so without this count the badge would be
// invisible for three of the four screened origins.
describe('SourcesHeader injection screening summary', () => {
  it('counts flagged rss files even though they have no own row', () => {
    files = [
      makeFile({ id: 'r1', origin: 'rss', rssFeedId: 'feed-1', injectionFlag: true }),
      makeFile({ id: 'r2', origin: 'rss', rssFeedId: 'feed-1', injectionFlag: true }),
      makeFile({ id: 'r3', origin: 'rss', rssFeedId: 'feed-1' }),
    ];
    render(<SourcesHeader />);
    expect(screen.getByLabelText('fileInjectionFlagged (2)')).toBeInTheDocument();
    // Nothing failed, so the retry button stays away.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders no summary when nothing is flagged', () => {
    files = [makeFile({})];
    render(<SourcesHeader />);
    expect(screen.queryByLabelText(/fileInjectionFlagged \(/)).not.toBeInTheDocument();
  });

  // A flagged upload can only be a leftover from before an origin change (the
  // screen never runs on uploads); it keeps its own row badge in the list, and
  // counting it here too would double-report it.
  it('excludes upload-origin files from the count', () => {
    files = [
      makeFile({ id: 'u1', origin: 'upload', injectionFlag: true }),
      makeFile({ id: 'c1', name: 'page.html', origin: 'crawl', injectionFlag: true }),
    ];
    render(<SourcesHeader />);
    expect(screen.getByLabelText('fileInjectionFlagged (1)')).toBeInTheDocument();
  });

  it('renders no summary when only an upload is flagged', () => {
    files = [makeFile({ origin: 'upload', injectionFlag: true })];
    render(<SourcesHeader />);
    expect(screen.queryByLabelText(/fileInjectionFlagged \(/)).not.toBeInTheDocument();
  });
});
