import type React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SourcesSection } from './SourcesSection';
import type { FileEntry } from '../../types';

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
