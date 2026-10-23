import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import type { ConfluenceSource, FileEntry, GitRepoSource, RssFeed } from '../../types';
import { SourceDetailsModal } from './SourceDetailsModal';

vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));

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

const makeFile = (over: Partial<FileEntry>): FileEntry => ({
  id: 'f-1', name: 'item.html', type: 'text/html', status: 'completed', progress: 100,
  origin: 'rss', createdAt: '2026-06-12T00:00:00Z', ...over,
});

/** The fact labels the dialog lists (t() is identity-mocked: the keys). */
const factLabels = () => [...document.querySelectorAll('.source-details__facts dt')].map(dt => dt.textContent);

// The API contract that moved here with the row redesign (it used to be the
// source row's inline meta): nextSyncAt is shown only when the schedule is
// not 'manual' AND the value is non-null — for each of the three kinds.
describe('SourceDetailsModal next-sync display', () => {
  const cases = [
    ['an RSS feed', (over: Partial<RssFeed>) => ({ kind: 'rss' as const, source: makeRssFeed(over) })],
    ['a Confluence space', (over: Partial<ConfluenceSource>) => ({ kind: 'confluence' as const, source: makeConfluenceSource(over) })],
    ['a git repository', (over: Partial<GitRepoSource>) => ({ kind: 'git' as const, source: makeGitRepoSource(over) })],
  ] as const;

  it.each(cases)('shows the next sync time for %s on a non-manual schedule', (_kind, target) => {
    render(<SourceDetailsModal target={target({ syncSchedule: 'daily', nextSyncAt: '2026-09-04T02:00:00Z' })} onClose={vi.fn()} />);
    expect(factLabels()).toContain('nextSync');
  });

  it.each(cases)('hides it for %s on a manual schedule, even with a value set', (_kind, target) => {
    render(<SourceDetailsModal target={target({ syncSchedule: 'manual', nextSyncAt: '2026-09-04T02:00:00Z' })} onClose={vi.fn()} />);
    expect(factLabels()).not.toContain('nextSync');
  });

  it.each(cases)('hides it for %s with no value, even on a non-manual schedule', (_kind, target) => {
    render(<SourceDetailsModal target={target({ syncSchedule: 'weekly', nextSyncAt: null })} onClose={vi.fn()} />);
    expect(factLabels()).not.toContain('nextSync');
  });
});

// Oracle: the facts each kind carries, hand-listed from the redesign brief —
// state, what it holds, when it last synced, how it syncs.
describe('SourceDetailsModal facts and entries', () => {
  it('names the source with its type chip and lists a feed\'s facts', () => {
    render(<SourceDetailsModal target={{ kind: 'rss', source: makeRssFeed({ syncSchedule: 'weekly', itemCount: 12 }) }} onClose={vi.fn()} />);
    // The chip is decoration (aria-hidden): the dialog is named by the title alone.
    const dialog = screen.getByRole('dialog', { name: 'Feed' });
    expect(within(dialog).getByText('RSS')).toBeInTheDocument();
    expect(factLabels()).toEqual(['sourceStatus', 'items', 'lastPolled', 'syncScheduleLabel']);
    expect(within(dialog).getByText('12')).toBeInTheDocument();
    expect(within(dialog).getByText('syncScheduleWeekly')).toBeInTheDocument();
  });

  it('shows a source\'s error message', () => {
    render(<SourceDetailsModal target={{ kind: 'git', source: makeGitRepoSource({ status: 'error', errorMessage: 'authentication failed' }) }} onClose={vi.fn()} />);
    expect(screen.getByText('feedError')).toBeInTheDocument();
    expect(screen.getByText('authentication failed')).toBeInTheDocument();
  });

  it('lists the entries it is given, with delete only when a handler is passed', async () => {
    const onDeleteFile = vi.fn();
    const files = [makeFile({}), makeFile({ id: 'f-2', name: 'zwei.html' })];
    const { rerender } = render(<SourceDetailsModal target={{ kind: 'rss', source: makeRssFeed() }} files={files} onClose={vi.fn()} />);
    expect(screen.getByText('item.html')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^delete / })).not.toBeInTheDocument();

    rerender(<SourceDetailsModal target={{ kind: 'rss', source: makeRssFeed() }} files={files} onDeleteFile={onDeleteFile} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'delete zwei.html' }));
    expect(onDeleteFile).toHaveBeenCalledWith('f-2', expect.anything());
  });

  it('says so when a feed has no entries', () => {
    render(<SourceDetailsModal target={{ kind: 'rss', source: makeRssFeed() }} files={[]} onClose={vi.fn()} />);
    expect(screen.getByText('rssNoEntries')).toBeInTheDocument();
  });
});
