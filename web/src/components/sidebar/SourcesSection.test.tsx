import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SourcesSection } from './SourcesSection';
import type { FileEntry } from '../../types';

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
