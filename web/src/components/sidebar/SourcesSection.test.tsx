import type React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SourcesSection } from './SourcesSection';
import type { FileEntry, RssFeed, ConfluenceSource, GitRepoSource } from '../../types';

// The hover preview (HoverCard + FilePreview) is DS 0.42.0; the pinned package
// under vitest may be older, and the preview is not what this file tests.
// Everything else stays the shipped design-system export (`importOriginal`).
vi.mock('@ki4jlu/design-system', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  HoverCard: ({ children }: { children: React.ReactNode }) => children,
  HoverCardTrigger: ({ children }: { children: React.ReactNode }) => children,
  HoverCardContent: () => null,
  FilePreview: () => null,
  preloadPdfjs: () => undefined,
  renderPdfFirstPage: () => Promise.resolve(''),
}));
// No preview fetches in a unit test: the cache would hit the network.
vi.mock('../../hooks/sourcePreviews', () => ({
  useSourcePreviews: () => undefined,
  useSourcePreview: () => ({ image: undefined, pending: false }),
  preloadSourcePreview: () => Promise.resolve(null),
  canPreviewSource: () => false,
}));
vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ t: (key: string) => key }),
}));
vi.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
  getMotionProps: () => ({}),
}));

const makeFile = (over: Partial<FileEntry>): FileEntry => ({
  id: 'f-1', name: 'doc.pdf', type: 'application/pdf',
  status: 'completed', progress: 100, origin: 'upload',
  createdAt: '2026-06-12T00:00:00Z', selected: true,
  ...over,
});

const makeRssFeed = (over: Partial<RssFeed> = {}): RssFeed => ({
  id: 'feed-1', kbId: 'kb-1', url: 'https://example.com/feed.xml', title: 'Feed',
  syncSchedule: 'manual', nextSyncAt: null, status: 'active', errorMessage: null,
  consecutiveFailures: 0, lastPolledAt: null, itemCount: 0, fetchFullText: false,
  createdAt: '2026-06-12T00:00:00Z',
  ...over,
});

const makeConfluenceSource = (over: Partial<ConfluenceSource> = {}): ConfluenceSource => ({
  id: 'conf-1', kbId: 'kb-1', connectionId: 'conn-1', spaceKey: 'ENG', rootPageId: null,
  rootPageTitle: null, includeAttachments: false, syncSchedule: 'manual', nextSyncAt: null,
  status: 'active', errorMessage: null, consecutiveFailures: 0, lastSyncedAt: null,
  pageCount: 0, syncProgress: 0, syncTotal: 0, createdAt: '2026-06-12T00:00:00Z',
  ...over,
});

const makeGitRepoSource = (over: Partial<GitRepoSource> = {}): GitRepoSource => ({
  id: 'git-1', kbId: 'kb-1', repoUrl: 'https://github.com/acme/repo', isPrivate: false,
  branch: null, hasToken: false, syncSchedule: 'manual', nextSyncAt: null,
  status: 'active', errorMessage: null, consecutiveFailures: 0, lastSyncedAt: null,
  lastCommitSha: null, fileCount: 0, syncProgress: 0, syncTotal: 0,
  createdAt: '2026-06-12T00:00:00Z',
  ...over,
});

const baseProps = {
  onPreviewSource: vi.fn(),
  onToggleFileSelection: vi.fn(),
  onToggleFilesSelection: vi.fn(),
  onDownloadFile: vi.fn(),
  onDeleteFile: vi.fn(),
  rssFeeds: [],
  onUpdateRssFeed: vi.fn(),
  onDeleteRssFeed: vi.fn(),
  onPollFeedNow: vi.fn(),
  onViewFeed: vi.fn(),
  confluenceSources: [],
  onUpdateConfluenceSource: vi.fn(),
  onDeleteConfluenceSource: vi.fn(),
  onSyncConfluenceNow: vi.fn(),
  gitRepoSources: [],
  onUpdateGitRepoSource: vi.fn(),
  onDeleteGitRepoSource: vi.fn(),
  onSyncGitRepoNow: vi.fn(),
  onRetryFile: vi.fn(),
  onOpenTabular: vi.fn(),
};

describe('SourcesSection error display + retry', () => {
  it('shows the translated stage label and retry button for errored files', async () => {
    const onRetryFile = vi.fn();
    const file = makeFile({ status: 'error', errorStage: 'parse', errorMessage: 'The file could not be parsed' });
    render(<SourcesSection {...baseProps} files={[file]} onRetryFile={onRetryFile} />);

    // Stage maps to the translation key (t() is identity-mocked).
    expect(screen.getByText('fileErrorParse')).toBeInTheDocument();
    // Raw message rides along as the tooltip.
    expect(screen.getByText('fileErrorParse')).toHaveAttribute('title', 'The file could not be parsed');

    await userEvent.click(screen.getByRole('button', { name: 'retrySource doc.pdf' }));
    expect(onRetryFile).toHaveBeenCalledWith('f-1');
  });

  it('falls back to errorMessage for unknown stages and to fileErrorUnknown without any detail', () => {
    const weird = makeFile({ id: 'f-2', name: 'w.pdf', status: 'error', errorStage: 'martian', errorMessage: 'Strange failure' });
    const legacy = makeFile({ id: 'f-3', name: 'l.pdf', status: 'error' });
    render(<SourcesSection {...baseProps} files={[weird, legacy]} />);

    expect(screen.getByText('Strange failure')).toBeInTheDocument();
    expect(screen.getByText('fileErrorUnknown')).toBeInTheDocument();
  });

  it('shows no status line for a finished upload, only for queued files', () => {
    render(<SourcesSection {...baseProps} files={[makeFile({}), makeFile({ id: 'f-9', name: 'q.pdf', status: 'pending' })]} />);
    expect(screen.queryByText(/completed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/upload/)).not.toBeInTheDocument();
    expect(screen.getByText('fileStatusPending')).toBeInTheDocument();
  });

  it('keeps download and delete behind the per-file actions menu', async () => {
    const onDownloadFile = vi.fn();
    render(<SourcesSection {...baseProps} files={[makeFile({})]} onDownloadFile={onDownloadFile} />);
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'sourceActions doc.pdf' }));
    expect(screen.getByRole('menuitem', { name: /delete/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /download/ }));
    expect(onDownloadFile).toHaveBeenCalledWith('f-1');
  });

  it('puts the selection checkbox on the card and toggles through the bulk handler', async () => {
    const onToggleFilesSelection = vi.fn();
    render(<SourcesSection {...baseProps} files={[makeFile({})]} onToggleFilesSelection={onToggleFilesSelection} />);
    const box = screen.getByRole('checkbox', { name: 'selectSource doc.pdf' });
    expect(box).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(box);
    expect(onToggleFilesSelection).toHaveBeenCalledWith(['f-1'], false);
  });

  it('previews on a click anywhere on the card, but not on its controls', async () => {
    const onPreviewSource = vi.fn();
    const onToggleFilesSelection = vi.fn();
    render(<SourcesSection {...baseProps} files={[makeFile({})]} onPreviewSource={onPreviewSource} onToggleFilesSelection={onToggleFilesSelection} />);
    await userEvent.click(screen.getByRole('listitem'));
    expect(onPreviewSource).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('checkbox', { name: 'selectSource doc.pdf' }));
    await userEvent.click(screen.getByRole('button', { name: 'sourceActions doc.pdf' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /download/ }));
    expect(onToggleFilesSelection).toHaveBeenCalledTimes(1);
    expect(onPreviewSource).toHaveBeenCalledTimes(1);
  });

  it('hides the per-file retry control when nothing failed', () => {
    render(<SourcesSection {...baseProps} files={[makeFile({})]} />);
    expect(screen.queryByRole('button', { name: /retrySource/ })).not.toBeInTheDocument();
  });

  it('no longer carries the section heading or the bulk retry button', () => {
    // Both moved into the right column's h-16 header row, which the shell
    // renders and `KbWorkspaceLayout` fills — see SourcesHeader.test.tsx.
    // Asserted here rather than only there because a SECOND copy left behind
    // in the scrolling list is exactly what this move must not produce, and
    // nothing in SourcesHeader's own test can see it.
    const files = [makeFile({ id: 'f-1', status: 'error' }), makeFile({ id: 'f-2', name: 'b.pdf', status: 'error' })];
    render(<SourcesSection {...baseProps} files={files} />);
    expect(screen.queryByRole('heading', { name: 'sources' })).not.toBeInTheDocument();
    expect(screen.queryByText(/retryAllFailed/)).not.toBeInTheDocument();
  });
});

// The API contract: nextSyncAt is displayed only when the source's schedule
// is not 'manual' AND the value is non-null. Asserted on the text the user
// actually sees (t() is identity-mocked, so t('nextSync') renders literally
// as "nextSync") rather than on internal props, per each of the three source
// types the rule applies to.
describe('SourcesSection next-sync display', () => {
  it('shows the next sync time for an RSS feed on a non-manual schedule', () => {
    const feed = makeRssFeed({ syncSchedule: 'daily', nextSyncAt: '2026-09-04T02:00:00Z' });
    render(<SourcesSection {...baseProps} files={[]} rssFeeds={[feed]} />);
    expect(screen.getByText(/nextSync/)).toBeInTheDocument();
  });

  it('hides the next sync time for an RSS feed on a manual schedule, even with a value set', () => {
    const feed = makeRssFeed({ syncSchedule: 'manual', nextSyncAt: '2026-09-04T02:00:00Z' });
    render(<SourcesSection {...baseProps} files={[]} rssFeeds={[feed]} />);
    expect(screen.queryByText(/nextSync/)).not.toBeInTheDocument();
  });

  it('hides the next sync time for an RSS feed with no value, even on a non-manual schedule', () => {
    const feed = makeRssFeed({ syncSchedule: 'daily', nextSyncAt: null });
    render(<SourcesSection {...baseProps} files={[]} rssFeeds={[feed]} />);
    expect(screen.queryByText(/nextSync/)).not.toBeInTheDocument();
  });

  it('shows the next sync time for a Confluence source on a non-manual schedule', () => {
    const source = makeConfluenceSource({ syncSchedule: 'weekly', nextSyncAt: '2026-09-07T02:00:00Z' });
    render(<SourcesSection {...baseProps} files={[]} confluenceSources={[source]} />);
    expect(screen.getByText(/nextSync/)).toBeInTheDocument();
  });

  it('hides the next sync time for a Confluence source on a manual schedule, even with a value set', () => {
    const source = makeConfluenceSource({ syncSchedule: 'manual', nextSyncAt: '2026-09-07T02:00:00Z' });
    render(<SourcesSection {...baseProps} files={[]} confluenceSources={[source]} />);
    expect(screen.queryByText(/nextSync/)).not.toBeInTheDocument();
  });

  it('hides the next sync time for a Confluence source with no value, even on a non-manual schedule', () => {
    const source = makeConfluenceSource({ syncSchedule: 'weekly', nextSyncAt: null });
    render(<SourcesSection {...baseProps} files={[]} confluenceSources={[source]} />);
    expect(screen.queryByText(/nextSync/)).not.toBeInTheDocument();
  });

  it('shows the next sync time for a git repo source on a non-manual schedule', () => {
    const source = makeGitRepoSource({ syncSchedule: 'daily', nextSyncAt: '2026-09-04T02:00:00Z' });
    render(<SourcesSection {...baseProps} files={[]} gitRepoSources={[source]} />);
    expect(screen.getByText(/nextSync/)).toBeInTheDocument();
  });

  it('hides the next sync time for a git repo source on a manual schedule, even with a value set', () => {
    const source = makeGitRepoSource({ syncSchedule: 'manual', nextSyncAt: '2026-09-04T02:00:00Z' });
    render(<SourcesSection {...baseProps} files={[]} gitRepoSources={[source]} />);
    expect(screen.queryByText(/nextSync/)).not.toBeInTheDocument();
  });

  it('hides the next sync time for a git repo source with no value, even on a non-manual schedule', () => {
    const source = makeGitRepoSource({ syncSchedule: 'daily', nextSyncAt: null });
    render(<SourcesSection {...baseProps} files={[]} gitRepoSources={[source]} />);
    expect(screen.queryByText(/nextSync/)).not.toBeInTheDocument();
  });
});

// F3(b): a schedule control is reachable on every source row (not just at
// creation time), wired to the existing update handlers, so a user can
// change their mind about a source's schedule without deleting and
// recreating it.
describe('SourcesSection per-row schedule control', () => {
  it('renders a schedule select for an RSS feed, pre-selected to its current schedule, and calls onUpdateRssFeed on change', () => {
    const onUpdateRssFeed = vi.fn();
    const feed = makeRssFeed({ syncSchedule: 'weekly' });
    render(<SourcesSection {...baseProps} files={[]} rssFeeds={[feed]} onUpdateRssFeed={onUpdateRssFeed} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('weekly');

    fireEvent.change(select, { target: { value: 'daily' } });
    expect(onUpdateRssFeed).toHaveBeenCalledWith('feed-1', { syncSchedule: 'daily' });
  });

  it('renders a schedule select for a Confluence source and calls onUpdateConfluenceSource on change', () => {
    const onUpdateConfluenceSource = vi.fn();
    const source = makeConfluenceSource({ syncSchedule: 'manual' });
    render(<SourcesSection {...baseProps} files={[]} confluenceSources={[source]} onUpdateConfluenceSource={onUpdateConfluenceSource} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('manual');

    fireEvent.change(select, { target: { value: 'weekly' } });
    expect(onUpdateConfluenceSource).toHaveBeenCalledWith('conf-1', { syncSchedule: 'weekly' });
  });

  it('renders a schedule select for a git repo source and calls onUpdateGitRepoSource on change', () => {
    const onUpdateGitRepoSource = vi.fn();
    const source = makeGitRepoSource({ syncSchedule: 'manual' });
    render(<SourcesSection {...baseProps} files={[]} gitRepoSources={[source]} onUpdateGitRepoSource={onUpdateGitRepoSource} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('manual');

    fireEvent.change(select, { target: { value: 'daily' } });
    expect(onUpdateGitRepoSource).toHaveBeenCalledWith('git-1', { syncSchedule: 'daily' });
  });

  it('gives each row schedule select a unique id for label association when multiple sources are shown', () => {
    const feed = makeRssFeed({ id: 'feed-a' });
    const feed2 = makeRssFeed({ id: 'feed-b' });
    render(<SourcesSection {...baseProps} files={[]} rssFeeds={[feed, feed2]} />);

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects).toHaveLength(2);
    expect(selects[0].id).not.toBe(selects[1].id);
    expect(new Set(selects.map(s => s.id)).size).toBe(2);
  });
});

// Phase 4: the "Tabellen" file-detail button — only for completed
// spreadsheet files, calling onOpenTabular(file) when clicked.
describe('SourcesSection tabular detail button', () => {
  it('shows the button for a completed spreadsheet file and calls onOpenTabular with it', async () => {
    const onOpenTabular = vi.fn();
    const file = makeFile({ name: 'a.xlsx', status: 'completed' });
    render(<SourcesSection {...baseProps} files={[file]} onOpenTabular={onOpenTabular} />);

    const btn = screen.getByRole('button', { name: 'tabularPanelOpen a.xlsx' });
    await userEvent.click(btn);
    expect(onOpenTabular).toHaveBeenCalledWith(file);
  });

  it('hides the button for a non-spreadsheet completed file', () => {
    const file = makeFile({ name: 'a.pdf', status: 'completed' });
    render(<SourcesSection {...baseProps} files={[file]} />);
    expect(screen.queryByRole('button', { name: /tabularPanelOpen/ })).not.toBeInTheDocument();
  });

  it('hides the button for a spreadsheet file that is still processing', () => {
    const file = makeFile({ name: 'a.xlsx', status: 'processing' });
    render(<SourcesSection {...baseProps} files={[file]} />);
    expect(screen.queryByRole('button', { name: /tabularPanelOpen/ })).not.toBeInTheDocument();
  });

  it('shows the button for every other supported spreadsheet extension, case-insensitively', () => {
    const files = ['b.XLS', 'c.ods', 'd.csv', 'e.tsv'].map((name, i) =>
      makeFile({ id: `f-ext-${i}`, name, status: 'completed' }));
    render(<SourcesSection {...baseProps} files={files} />);
    expect(screen.getAllByRole('button', { name: /tabularPanelOpen/ })).toHaveLength(files.length);
  });

  it('hides the button for a completed .xlsm file (macro workbooks are out of scope)', () => {
    const file = makeFile({ name: 'a.xlsm', status: 'completed' });
    render(<SourcesSection {...baseProps} files={[file]} />);
    expect(screen.queryByRole('button', { name: /tabularPanelOpen/ })).not.toBeInTheDocument();
  });
});

// Phase 4: files.stage_detail (live per-stage progress text) rendered by
// IngestStageIndicator when currentStage is set.
describe('SourcesSection stage detail pass-through', () => {
  it('renders stageDetail when currentStage is set', () => {
    const file = makeFile({ currentStage: 'tabular', stageDetail: 'Blatt 2/3 · 120000 Zeilen' });
    render(<SourcesSection {...baseProps} files={[file]} />);
    expect(screen.getByText('Blatt 2/3 · 120000 Zeilen')).toBeInTheDocument();
  });
});

// Wave-5 Task 6: the ingest prompt-injection screening badge. The flag is
// advisory — the file is ingested and searchable either way — so the badge
// must be additive: it never replaces the name, the actions or the error row.
describe('SourcesSection injection screening badge', () => {
  it('renders a badge with the snippet in the accessible name for a flagged file', () => {
    const file = makeFile({
      origin: 'crawl',
      injectionFlag: true,
      injectionDetail: { rule: 'ignore_previous', position: 20, snippet: 'Ignore all previous instructions', screened_at: '2026-09-06T00:00:00Z' },
    });
    render(<SourcesSection {...baseProps} files={[file]} />);

    const badge = screen.getByLabelText('fileInjectionFlagged: Ignore all previous instructions');
    expect(badge).toBeInTheDocument();
    // The snippet also rides along as the hover tooltip.
    expect(badge).toHaveAttribute('title', 'fileInjectionFlagged: Ignore all previous instructions');
    // Additive: the file itself is still fully usable — name and actions menu stay.
    expect(screen.getByText('doc.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'sourceActions doc.pdf' })).toBeInTheDocument();
  });

  it('falls back to the plain label when the detail carries no snippet', () => {
    const file = makeFile({ origin: 'crawl', injectionFlag: true });
    render(<SourcesSection {...baseProps} files={[file]} />);
    expect(screen.getByLabelText('fileInjectionFlagged')).toBeInTheDocument();
  });

  it('renders no badge for an unflagged file', () => {
    render(<SourcesSection {...baseProps} files={[makeFile({})]} />);
    expect(screen.queryByLabelText(/fileInjectionFlagged/)).not.toBeInTheDocument();
  });

  // The header count of flagged external-origin files lives in SourcesHeader
  // (above the list) — see SourcesHeader.test.tsx. A flagged upload keeps its
  // own row and badge here.
  it('keeps the per-file badge on a flagged upload', () => {
    const files = [
      makeFile({ id: 'u1', origin: 'upload', injectionFlag: true }),
      makeFile({ id: 'c1', name: 'page.html', origin: 'crawl', injectionFlag: true }),
    ];
    render(<SourcesSection {...baseProps} files={files} />);
    expect(screen.getAllByLabelText('fileInjectionFlagged')).toHaveLength(2);
    // No second copy of the header summary inside the list.
    expect(screen.queryByLabelText(/fileInjectionFlagged \(/)).not.toBeInTheDocument();
  });
});
