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
  // A marker per hover preview, so a test can tell whether a card has one.
  HoverCardContent: () => <span data-testid="hover-preview" />,
  FilePreview: () => null,
  preloadPdfjs: () => undefined,
  renderPdfFirstPage: () => Promise.resolve(''),
}));
// No preview fetches in a unit test: the cache would hit the network.
const useSourcePreviews = vi.fn();
vi.mock('../../hooks/sourcePreviews', () => ({
  useSourcePreviews: (files: unknown) => useSourcePreviews(files),
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
  canManage: true,
  canDownload: true,
};

describe('SourcesSection error display + retry', () => {
  it('shows the translated stage label and retry button for errored files', async () => {
    const onRetryFile = vi.fn();
    const file = makeFile({ status: 'error', errorStage: 'parse', errorMessage: 'The file could not be parsed' });
    render(<SourcesSection {...baseProps} files={[file]} onRetryFile={onRetryFile} />);

    // Stage maps to the translation key (t() is identity-mocked).
    expect(screen.getByText('fileErrorParse')).toBeInTheDocument();
    // The backend's technical text is never shown, not even as a tooltip.
    expect(screen.getByText('fileErrorParse')).not.toHaveAttribute('title');
    expect(screen.queryByText(/could not be parsed/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'retrySource doc.pdf' }));
    expect(onRetryFile).toHaveBeenCalledWith('f-1');
  });

  it('shows fileErrorUnknown for unknown stages and without any detail, never the raw errorMessage', () => {
    const weird = makeFile({ id: 'f-2', name: 'w.pdf', status: 'error', errorStage: 'martian', errorMessage: 'Strange failure' });
    const legacy = makeFile({ id: 'f-3', name: 'l.pdf', status: 'error' });
    render(<SourcesSection {...baseProps} files={[weird, legacy]} />);

    expect(screen.queryByText('Strange failure')).not.toBeInTheDocument();
    expect(screen.getAllByText('fileErrorUnknown')).toHaveLength(2);
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

// Spreadsheets open like every other source: a row click hands the file to
// onPreviewSource (useWebTools routes it to the tabular preview). There is no
// separate table-structure button any more.
describe('SourcesSection spreadsheet sources', () => {
  it('renders no extra action button for a completed spreadsheet file', () => {
    const file = makeFile({ name: 'a.xlsx', status: 'completed' });
    const other = makeFile({ id: 'f-pdf', name: 'a.pdf', status: 'completed' });
    const { rerender } = render(<SourcesSection {...baseProps} files={[other]} />);
    const pdfButtons = screen.getAllByRole('button').length;
    rerender(<SourcesSection {...baseProps} files={[file]} />);
    expect(screen.getAllByRole('button')).toHaveLength(pdfButtons);
  });

  it('opens a spreadsheet via onPreviewSource on row click', async () => {
    const onPreviewSource = vi.fn();
    const file = makeFile({ name: 'a.xlsx', status: 'completed' });
    render(<SourcesSection {...baseProps} files={[file]} onPreviewSource={onPreviewSource} />);
    await userEvent.click(screen.getByRole('listitem'));
    expect(onPreviewSource).toHaveBeenCalledWith(file);
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

// Without capabilities.manageSources (backend contract 2026-10-16: changing
// existing sources is fixed at edit and above) the backend refuses delete,
// retry, sync, pause and reschedule with a 403. So none of those controls may
// render, while what the caller CAN do — open, download, select, read an RSS
// feed's entries — stays. Adding sources is a separate right and not this
// component's concern (SourcesPanel / SourcesRail).
describe('SourcesSection without the manage right (canManage=false)', () => {
  const viewer = { ...baseProps, canManage: false };

  it('offers no retry button and no delete action on a file, but keeps download and select', async () => {
    render(<SourcesSection {...viewer} files={[makeFile({ status: 'error', errorMessage: 'x' })]} />);
    expect(screen.queryByRole('button', { name: /retrySource/ })).not.toBeInTheDocument();
    // Before opening the menu: an open (modal) menu hides the rest from the a11y tree.
    expect(screen.getByRole('checkbox', { name: /selectSource/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /sourceActions/ }));
    expect(await screen.findByRole('menuitem', { name: /download/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /delete/ })).not.toBeInTheDocument();
  });

  it('shows an RSS feed without sync, pause, delete or schedule, but with its entries', () => {
    render(<SourcesSection {...viewer} files={[]} rssFeeds={[makeRssFeed()]} />);
    for (const name of [/pollNow/, /^pause$/, /delete/]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rssViewEntries/ })).toBeInTheDocument();
  });

  it('shows Confluence and git sources without any edit control', () => {
    render(<SourcesSection {...viewer} files={[]}
      confluenceSources={[makeConfluenceSource()]} gitRepoSources={[makeGitRepoSource()]} />);
    expect(screen.getByText('ENG')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /pollNow|pause|delete/ })).toHaveLength(0);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('an editor still gets every control (the same rows with canManage=true)', () => {
    render(<SourcesSection {...baseProps} files={[]}
      rssFeeds={[makeRssFeed()]} confluenceSources={[makeConfluenceSource()]} gitRepoSources={[makeGitRepoSource()]} />);
    expect(screen.getAllByRole('button', { name: /pollNow/ })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /^delete/ })).toHaveLength(3);
  });
});

// Oracle: backend contract 2026-10-16 — downloadSources gates the download
// route, which is also what the in-app preview and the hover preview load. So
// without it neither the Download action nor either preview is rendered, and
// the card is display-only (DS SidebarCard without onOpen: the title is plain
// text, a click does nothing; the checkbox still selects). The UI rule: what
// cannot be used is not rendered at all.
describe('SourcesSection download right (canDownload)', () => {
  it('with the right: Download in the menu, a hover preview, preloading, click previews', async () => {
    useSourcePreviews.mockClear();
    const onPreviewSource = vi.fn();
    render(<SourcesSection {...baseProps} files={[makeFile({})]} onPreviewSource={onPreviewSource} />);
    expect(screen.getByTestId('hover-preview')).toBeInTheDocument();
    expect(useSourcePreviews).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'f-1' })]);
    await userEvent.click(screen.getByRole('button', { name: 'doc.pdf' }));
    expect(onPreviewSource).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'sourceActions doc.pdf' }));
    expect(await screen.findByRole('menuitem', { name: /download/ })).toBeInTheDocument();
  });

  it('without it: no Download, no hover preview, no preloading, the title is not a button', async () => {
    useSourcePreviews.mockClear();
    const onPreviewSource = vi.fn();
    const onToggleFilesSelection = vi.fn();
    render(<SourcesSection {...baseProps} canDownload={false} files={[makeFile({})]}
      onPreviewSource={onPreviewSource} onToggleFilesSelection={onToggleFilesSelection} />);
    expect(screen.queryByTestId('hover-preview')).not.toBeInTheDocument();
    expect(useSourcePreviews).toHaveBeenLastCalledWith([]);
    expect(screen.queryByRole('button', { name: 'doc.pdf' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('doc.pdf'));
    expect(onPreviewSource).not.toHaveBeenCalled();
    expect(onToggleFilesSelection).not.toHaveBeenCalled();
    // The manager still has Delete in the menu — just no Download.
    await userEvent.click(screen.getByRole('button', { name: 'sourceActions doc.pdf' }));
    expect(await screen.findByRole('menuitem', { name: /delete/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /download/ })).not.toBeInTheDocument();
  });

  it('renders no actions menu at all when neither download nor manage is allowed', () => {
    render(<SourcesSection {...baseProps} canDownload={false} canManage={false} files={[makeFile({})]} />);
    expect(screen.queryByRole('button', { name: /sourceActions/ })).not.toBeInTheDocument();
    // The selection stays for whoever sees the list.
    expect(screen.getByRole('checkbox', { name: 'selectSource doc.pdf' })).toBeInTheDocument();
  });

  it('without it the checkbox still selects an excluded source again', async () => {
    const onToggleFilesSelection = vi.fn();
    render(<SourcesSection {...baseProps} canDownload={false} files={[makeFile({ selected: false })]}
      onToggleFilesSelection={onToggleFilesSelection} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'selectSource doc.pdf' }));
    expect(onToggleFilesSelection).toHaveBeenCalledWith(['f-1'], true);
  });
});
