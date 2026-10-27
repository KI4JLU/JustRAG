import type React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  uploads: [],
  onPreviewSource: vi.fn(),
  selection: null,
  selectionTone: 'default' as const,
  onStartSelection: vi.fn(),
  onStartRemoval: vi.fn(),
  onToggleSelected: vi.fn(),
  onDownloadFile: vi.fn(),
  rssFeeds: [],
  onUpdateRssFeed: vi.fn(),
  onPollFeedNow: vi.fn(),
  confluenceSources: [],
  onUpdateConfluenceSource: vi.fn(),
  onSyncConfluenceNow: vi.fn(),
  gitRepoSources: [],
  onUpdateGitRepoSource: vi.fn(),
  onSyncGitRepoNow: vi.fn(),
  onRetryFile: vi.fn(),
  onViewSource: vi.fn(),
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

  it('lists a file still uploading above the list, display-only', () => {
    const upload = { id: 'upload-1', kbId: 'kb-1', name: 'new.pdf', type: 'application/pdf', origin: 'upload' as const };
    render(<SourcesSection {...baseProps} uploads={[upload]} files={[]} />);
    expect(screen.getByText('new.pdf')).toBeInTheDocument();
    expect(screen.getByText('sourceUploading')).toBeInTheDocument();
    expect(screen.queryByText('noSources')).not.toBeInTheDocument();
    // No actions menu, no open link: nothing exists to act on yet.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps download and remove behind the per-file actions menu', async () => {
    const onDownloadFile = vi.fn();
    render(<SourcesSection {...baseProps} files={[makeFile({})]} onDownloadFile={onDownloadFile} />);
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'sourceActions doc.pdf' }));
    expect(screen.getByRole('menuitem', { name: 'removeSource' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /download/ }));
    expect(onDownloadFile).toHaveBeenCalledWith('f-1');
  });

  it('previews on a click anywhere on the card, but not on its controls', async () => {
    const onPreviewSource = vi.fn();
    render(<SourcesSection {...baseProps} files={[makeFile({})]} onPreviewSource={onPreviewSource} />);
    await userEvent.click(screen.getByRole('listitem'));
    expect(onPreviewSource).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'sourceActions doc.pdf' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /download/ }));
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

// A synced source (RSS feed, Confluence space, git repository) is a row like
// a file card: a grey type chip and its title, nothing else inline. State,
// counts, sync times (the next-sync rule moved with them — see
// SourceDetailsModal.test.tsx) and the entries live in its details dialog;
// sync, pause, the schedule and remove live in the row's ⋯ menu. Only a
// failure stays on the row, because it needs acting on.
describe('SourcesSection synced source rows', () => {
  const rows = {
    rss: makeRssFeed({ syncSchedule: 'daily', nextSyncAt: '2026-09-04T02:00:00Z', itemCount: 12 }),
    confluence: makeConfluenceSource({ syncSchedule: 'weekly', nextSyncAt: '2026-09-07T02:00:00Z', pageCount: 30 }),
    git: makeGitRepoSource({ syncSchedule: 'daily', nextSyncAt: '2026-09-04T02:00:00Z', fileCount: 8 }),
  };

  it('renders each as a type chip and its title, without inline meta, schedule or entries', () => {
    render(<SourcesSection {...baseProps} files={[]}
      rssFeeds={[rows.rss]} confluenceSources={[rows.confluence]} gitRepoSources={[rows.git]} />);
    // Titles per sourceDetailsTitle: the feed title, the space key, owner/repo.
    const cards = [...document.querySelectorAll('[data-slot=sidebar-card]')];
    expect(cards.map(c => c.textContent)).toEqual(['RSSFeed', 'COLENG', 'GITacme/repo']);
    expect(screen.queryByText(/nextSync/)).not.toBeInTheDocument();
    expect(screen.queryByText(/12|30|8/)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rssViewEntries|pollNow|^pause|removeSource/ })).not.toBeInTheDocument();
  });

  // A failure tints the row and is its tooltip / description (DS SidebarCard `error`).
  it('keeps a failure on the row', () => {
    render(<SourcesSection {...baseProps} files={[]} gitRepoSources={[makeGitRepoSource({ status: 'error', errorMessage: 'auth' })]} />);
    const row = screen.getByRole('listitem');
    expect(row).toHaveAttribute('data-error');
    expect(screen.getByRole('button', { name: 'acme/repo' })).toHaveAccessibleDescription('auth');
  });

  it.each([
    ['rss' as const, 'Feed', { rssFeeds: [rows.rss] }, rows.rss],
    ['confluence' as const, 'ENG', { confluenceSources: [rows.confluence] }, rows.confluence],
    ['git' as const, 'acme/repo', { gitRepoSources: [rows.git] }, rows.git],
  ])('opens the %s details from a click on the row and from „sourceDetails" in its menu', async (kind, title, lists, source) => {
    const onViewSource = vi.fn();
    render(<SourcesSection {...baseProps} files={[]} {...lists} onViewSource={onViewSource} />);
    await userEvent.click(screen.getByRole('button', { name: title }));
    expect(onViewSource).toHaveBeenLastCalledWith({ kind, source });
    await userEvent.click(screen.getByRole('button', { name: `sourceActions ${title}` }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'sourceDetails' }));
    expect(onViewSource).toHaveBeenCalledTimes(2);
    expect(onViewSource).toHaveBeenLastCalledWith({ kind, source });
  });
});

// F3(b): the schedule stays changeable on every source after creation, wired
// to the existing update handlers — now as the „syncScheduleLabel" submenu of
// the row's ⋯ menu, with the current schedule checked (aria-current).
describe('SourcesSection schedule in the row menu', () => {
  async function openSchedule(title: string) {
    await userEvent.click(screen.getByRole('button', { name: `sourceActions ${title}` }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'syncScheduleLabel' }));
  }
  const checked = () => screen.getAllByRole('menuitem').filter(i => i.getAttribute('aria-current') === 'true').map(i => i.textContent);

  it('offers the RSS feed\'s schedule with the current one checked, and calls onUpdateRssFeed on a pick', async () => {
    const onUpdateRssFeed = vi.fn();
    render(<SourcesSection {...baseProps} files={[]} rssFeeds={[makeRssFeed({ syncSchedule: 'weekly' })]} onUpdateRssFeed={onUpdateRssFeed} />);
    await openSchedule('Feed');
    expect(checked()).toEqual(['syncScheduleWeekly']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'syncScheduleDaily' }));
    expect(onUpdateRssFeed).toHaveBeenCalledWith('feed-1', { syncSchedule: 'daily' });
  });

  it('calls onUpdateConfluenceSource for a Confluence space', async () => {
    const onUpdateConfluenceSource = vi.fn();
    render(<SourcesSection {...baseProps} files={[]} confluenceSources={[makeConfluenceSource()]} onUpdateConfluenceSource={onUpdateConfluenceSource} />);
    await openSchedule('ENG');
    expect(checked()).toEqual(['syncScheduleManual']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'syncScheduleWeekly' }));
    expect(onUpdateConfluenceSource).toHaveBeenCalledWith('conf-1', { syncSchedule: 'weekly' });
  });

  it('calls onUpdateGitRepoSource for a git repository', async () => {
    const onUpdateGitRepoSource = vi.fn();
    render(<SourcesSection {...baseProps} files={[]} gitRepoSources={[makeGitRepoSource()]} onUpdateGitRepoSource={onUpdateGitRepoSource} />);
    await openSchedule('acme/repo');
    await userEvent.click(screen.getByRole('menuitem', { name: 'syncScheduleDaily' }));
    expect(onUpdateGitRepoSource).toHaveBeenCalledWith('git-1', { syncSchedule: 'daily' });
  });
});

// Sync now and pause/resume, also from the ⋯ menu.
describe('SourcesSection sync and pause in the row menu', () => {
  it('syncs and pauses an active RSS feed', async () => {
    const onPollFeedNow = vi.fn();
    const onUpdateRssFeed = vi.fn();
    render(<SourcesSection {...baseProps} files={[]} rssFeeds={[makeRssFeed()]} onPollFeedNow={onPollFeedNow} onUpdateRssFeed={onUpdateRssFeed} />);
    await userEvent.click(screen.getByRole('button', { name: 'sourceActions Feed' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'pollNow' }));
    expect(onPollFeedNow).toHaveBeenCalledWith('feed-1');
    await userEvent.click(screen.getByRole('button', { name: 'sourceActions Feed' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'pause' }));
    expect(onUpdateRssFeed).toHaveBeenCalledWith('feed-1', { status: 'paused' });
  });

  it('resumes a paused Confluence space and syncs it', async () => {
    const onUpdateConfluenceSource = vi.fn();
    const onSyncConfluenceNow = vi.fn();
    render(<SourcesSection {...baseProps} files={[]} confluenceSources={[makeConfluenceSource({ status: 'paused' })]}
      onUpdateConfluenceSource={onUpdateConfluenceSource} onSyncConfluenceNow={onSyncConfluenceNow} />);
    await userEvent.click(screen.getByRole('button', { name: 'sourceActions ENG' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'resume' }));
    expect(onUpdateConfluenceSource).toHaveBeenCalledWith('conf-1', { status: 'active' });
    await userEvent.click(screen.getByRole('button', { name: 'sourceActions ENG' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'pollNow' }));
    expect(onSyncConfluenceNow).toHaveBeenCalledWith('conf-1');
  });

  // The backend refuses to pause a repository mid-sync.
  it('disables pausing a git repository while it syncs', async () => {
    render(<SourcesSection {...baseProps} files={[]} gitRepoSources={[makeGitRepoSource({ status: 'syncing' })]} />);
    await userEvent.click(screen.getByRole('button', { name: 'sourceActions acme/repo' }));
    expect(screen.getByRole('menuitem', { name: 'resume' })).toHaveAttribute('aria-disabled', 'true');
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
  // Oracle: the row's accessible description (DS SidebarCard `busy`) — a
  // spinner on the tile with the stage as tooltip, no status line.
  it('describes a file in progress by its stage, without a status line', () => {
    const file = makeFile({ status: 'processing', currentStage: 'tabular', stageIndex: 2, stageTotal: 4, stageDetail: 'Blatt 2/3 · 120000 Zeilen' });
    render(<SourcesSection {...baseProps} files={[file]} />);
    expect(screen.getByRole('listitem')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: file.name })).toHaveAccessibleDescription('2/4 ingestStageTabular');
    expect(screen.queryByText('Blatt 2/3 · 120000 Zeilen')).not.toBeInTheDocument();
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
// render, while what the caller CAN do — open, download, select, read a
// synced source's details (its entries included) — stays. Adding sources is a separate right and not this
// component's concern (SourcesPanel / SourcesRail).
describe('SourcesSection without the manage right (canManage=false)', () => {
  const viewer = { ...baseProps, canManage: false };

  it('offers no retry button and no delete action on a file, but keeps download and select', async () => {
    render(<SourcesSection {...viewer} files={[makeFile({ status: 'error', errorMessage: 'x' })]} />);
    expect(screen.queryByRole('button', { name: /retrySource/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /sourceActions/ }));
    expect(await screen.findByRole('menuitem', { name: /download/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'selectSources' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /removeSource/ })).not.toBeInTheDocument();
  });

  it.each([
    ['an RSS feed', 'Feed', { rssFeeds: [makeRssFeed()] }],
    ['a Confluence space', 'ENG', { confluenceSources: [makeConfluenceSource()] }],
    ['a git repository', 'acme/repo', { gitRepoSources: [makeGitRepoSource()] }],
  ])('offers %s only its details and the selection — no sync, pause, schedule or remove', async (_kind, title, lists) => {
    render(<SourcesSection {...viewer} files={[]} {...lists} />);
    await userEvent.click(screen.getByRole('button', { name: `sourceActions ${title}` }));
    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(['sourceDetails', 'selectSources']);
  });

  it('an editor still gets every control (the same rows with canManage=true)', async () => {
    render(<SourcesSection {...baseProps} files={[]}
      rssFeeds={[makeRssFeed()]} confluenceSources={[makeConfluenceSource()]} gitRepoSources={[makeGitRepoSource()]} />);
    for (const title of ['Feed', 'ENG', 'acme/repo']) {
      await userEvent.click(screen.getByRole('button', { name: `sourceActions ${title}` }));
      expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual([
        'sourceDetails', 'selectSources', 'pollNow', 'pause', 'syncScheduleLabel', 'removeSource',
      ]);
      await userEvent.keyboard('{Escape}');
    }
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
    const onToggleSelected = vi.fn();
    render(<SourcesSection {...baseProps} canDownload={false} files={[makeFile({})]}
      onPreviewSource={onPreviewSource} onToggleSelected={onToggleSelected} />);
    expect(screen.queryByTestId('hover-preview')).not.toBeInTheDocument();
    expect(useSourcePreviews).toHaveBeenLastCalledWith([]);
    expect(screen.queryByRole('button', { name: 'doc.pdf' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('doc.pdf'));
    expect(onPreviewSource).not.toHaveBeenCalled();
    expect(onToggleSelected).not.toHaveBeenCalled();
    // The manager still has Remove in the menu — just no Download.
    await userEvent.click(screen.getByRole('button', { name: 'sourceActions doc.pdf' }));
    expect(await screen.findByRole('menuitem', { name: 'removeSource' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /download/ })).not.toBeInTheDocument();
  });

  it('leaves only Select in the menu when neither download nor manage is allowed', async () => {
    render(<SourcesSection {...baseProps} canDownload={false} canManage={false} files={[makeFile({})]} />);
    // The selection stays for whoever sees the list.
    await userEvent.click(screen.getByRole('button', { name: 'sourceActions doc.pdf' }));
    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(['selectSources']);
  });

  it('without it the checkbox still ticks a source in selection mode', async () => {
    const onToggleSelected = vi.fn();
    render(<SourcesSection {...baseProps} canDownload={false} files={[makeFile({})]}
      selection={new Set()} onToggleSelected={onToggleSelected} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'selectSource doc.pdf' }));
    expect(onToggleSelected).toHaveBeenCalledWith('file:f-1', true);
  });
});

// Two modes over the list (SourcesPanel owns them): "Select" opens the filter
// mode, "Remove" opens the remove mode with that row ticked. No checkbox until
// one is open; the checkboxes then show the mode's own set, not the chat
// filter (FileEntry.selected).
describe('SourcesSection selection and remove modes', () => {
  it('shows no checkbox by default, whatever the chat filter says', () => {
    render(<SourcesSection {...baseProps} files={[makeFile({}), makeFile({ id: 'f-2', name: 'b.pdf', selected: false })]}
      rssFeeds={[makeRssFeed()]} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it("opens the filter mode from the Select action of a file card's and a synced row's menu", async () => {
    const onStartSelection = vi.fn();
    render(<SourcesSection {...baseProps} canManage={false} files={[makeFile({})]} rssFeeds={[makeRssFeed()]}
      gitRepoSources={[makeGitRepoSource()]} onStartSelection={onStartSelection} />);
    for (const title of ['Feed', 'acme/repo', 'doc.pdf']) {
      await userEvent.click(screen.getByRole('button', { name: `sourceActions ${title}` }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'selectSources' }));
    }
    expect(onStartSelection).toHaveBeenCalledTimes(3);
  });

  it("opens the remove mode from the Remove action of a row's menu, with that row's key", async () => {
    const onStartRemoval = vi.fn();
    render(<SourcesSection {...baseProps} files={[makeFile({})]} rssFeeds={[makeRssFeed()]}
      confluenceSources={[makeConfluenceSource()]} gitRepoSources={[makeGitRepoSource()]} onStartRemoval={onStartRemoval} />);
    for (const [title, key] of [['Feed', 'rss:feed-1'], ['ENG', 'confluence:conf-1'], ['acme/repo', 'git:git-1'], ['doc.pdf', 'file:f-1']]) {
      await userEvent.click(screen.getByRole('button', { name: `sourceActions ${title}` }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'removeSource' }));
      expect(onStartRemoval).toHaveBeenLastCalledWith(key);
    }
  });

  // Oracle: the DS contract — SidebarCard muted carries data-muted.
  it('greys out a file card left out of the chat filter, but not while a mode is open', () => {
    const files = [makeFile({ selected: false }), makeFile({ id: 'f-2', name: 'b.pdf' })];
    const { container, rerender } = render(<SourcesSection {...baseProps} files={files} />);
    expect(container.querySelectorAll('[data-slot=sidebar-card][data-muted]')).toHaveLength(1);
    expect(screen.getByText('doc.pdf').closest('[data-slot=sidebar-card]')).toHaveAttribute('data-muted');
    rerender(<SourcesSection {...baseProps} files={files} selection={new Set()} />);
    expect(container.querySelector('[data-muted]')).toBeNull();
  });

  // DS SidebarCard selectionTone="destructive": a ticked row gets a red-tinted
  // background (bg-error/10) since the redesign, no longer a red border.
  it('marks a remove selection in the destructive tone', () => {
    render(<SourcesSection {...baseProps} files={[makeFile({})]} rssFeeds={[makeRssFeed()]}
      selection={new Set(['file:f-1', 'rss:feed-1'] as const)} selectionTone="destructive" />);
    expect(screen.getByText('doc.pdf').closest('[data-slot=sidebar-card]')).toHaveClass('bg-error/10');
    expect(screen.getByText('doc.pdf').closest('[data-slot=sidebar-card]')).not.toHaveClass('border-error');
    expect(screen.getByRole('checkbox', { name: 'selectSource Feed' }).className).toContain('data-[state=checked]:bg-error');
  });

  it('greys out an RSS feed none of whose files is in the chat filter, but not while a mode is open', () => {
    const files = [makeFile({ id: 'r1', origin: 'rss', rssFeedId: 'feed-1', selected: false })];
    const { container, rerender } = render(<SourcesSection {...baseProps} files={files} rssFeeds={[makeRssFeed()]} />);
    expect(container.querySelector('li[data-muted]')).not.toBeNull();
    rerender(<SourcesSection {...baseProps} files={files} rssFeeds={[makeRssFeed()]} selection={new Set()} />);
    expect(container.querySelector('li[data-muted]')).toBeNull();
    rerender(<SourcesSection {...baseProps} files={[{ ...files[0], selected: true }]} rssFeeds={[makeRssFeed()]} />);
    expect(container.querySelector('li[data-muted]')).toBeNull();
  });

  it('ticks from the selection set, not from the chat filter, and toggles by key', async () => {
    const onToggleSelected = vi.fn();
    const onPreviewSource = vi.fn();
    const files = [makeFile({ selected: false }), makeFile({ id: 'f-2', name: 'b.pdf', selected: true })];
    render(<SourcesSection {...baseProps} files={files} rssFeeds={[makeRssFeed()]}
      selection={new Set(['file:f-1'] as const)} onToggleSelected={onToggleSelected} onPreviewSource={onPreviewSource} />);
    expect(screen.getByRole('checkbox', { name: 'selectSource doc.pdf' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: 'selectSource b.pdf' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('checkbox', { name: 'selectSource Feed' })).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(screen.getByRole('checkbox', { name: 'selectSource b.pdf' }));
    expect(onToggleSelected).toHaveBeenCalledWith('file:f-2', true);
    await userEvent.click(screen.getByRole('checkbox', { name: 'selectSource Feed' }));
    expect(onToggleSelected).toHaveBeenCalledWith('rss:feed-1', true);
    // A click on the card toggles in the mode instead of previewing.
    expect(onPreviewSource).not.toHaveBeenCalled();
  });

  it('hides card menus and the feed controls while selecting', () => {
    render(<SourcesSection {...baseProps} files={[makeFile({})]} rssFeeds={[makeRssFeed()]} selection={new Set()} />);
    expect(screen.queryByRole('button', { name: /sourceActions/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pollNow|rssViewEntries|selectSources|removeSource/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  // Confluence and git rows take part in both modes now: their files carry
  // the source's id (confluenceSourceId, gitRepoSourceId), so a row stands for
  // them like an RSS feed's does (sourceSelection.ts).
  it.each(['default', 'destructive'] as const)('gives Confluence and git rows a checkbox in the %s mode, toggled by their key', async (tone) => {
    const onToggleSelected = vi.fn();
    render(<SourcesSection {...baseProps} files={[]} selection={new Set(['git:git-1'] as const)} selectionTone={tone}
      confluenceSources={[makeConfluenceSource()]} gitRepoSources={[makeGitRepoSource()]} onToggleSelected={onToggleSelected} />);
    expect(screen.getByRole('checkbox', { name: 'selectSource ENG' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('checkbox', { name: 'selectSource acme/repo' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('checkbox', { name: 'selectSource ENG' }));
    expect(onToggleSelected).toHaveBeenLastCalledWith('confluence:conf-1', true);
    await userEvent.click(screen.getByRole('checkbox', { name: 'selectSource acme/repo' }));
    expect(onToggleSelected).toHaveBeenLastCalledWith('git:git-1', false);
  });

  it('greys out a Confluence space none of whose files is in the chat filter', () => {
    const files = [makeFile({ id: 'c1', origin: 'confluence', confluenceSourceId: 'conf-1', selected: false })];
    render(<SourcesSection {...baseProps} files={files} confluenceSources={[makeConfluenceSource()]} />);
    expect(screen.getByText('ENG').closest('[data-slot=sidebar-card]')).toHaveAttribute('data-muted');
  });
});
