import type React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SourcesRail } from './SourcesRail';

const handlePreviewSource = vi.fn();
const setShowUploadModal = vi.fn();

// The preview card itself is not under test here.
vi.mock('@ki4jlu/design-system', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  HoverCard: ({ children }: { children: React.ReactNode }) => children,
  HoverCardTrigger: ({ children }: { children: React.ReactNode }) => children,
  HoverCardContent: () => null,
  FilePreview: () => null,
}));
vi.mock('../../hooks/sourcePreviews', () => ({
  useSourcePreviews: () => undefined,
  useSourcePreview: () => ({ image: undefined, pending: false }),
  preloadSourcePreview: () => Promise.resolve(null),
}));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));
vi.mock('../../contexts/KbDataContext', () => ({
  useKbData: () => ({
    fileMgmt: {
      setShowUploadModal,
      files: [
        { id: 'f1', name: 'a.pdf', origin: 'upload', status: 'completed', selected: true },
        { id: 'f2', name: 'b.pdf', origin: 'upload', status: 'completed', selected: false },
        { id: 'r1', name: 'feed item', origin: 'rss', status: 'completed' },
      ],
    },
    webTools: { handlePreviewSource },
  }),
}));

beforeEach(() => vi.clearAllMocks());

// Oracle: the fixture above — two listed files, one feed item that the
// expanded list also leaves out, one excluded file.
describe('SourcesRail', () => {
  it('shows one icon per listed source, not feed items', () => {
    render(<SourcesRail />);
    expect(screen.getByRole('button', { name: 'a.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'b.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'feed item' })).not.toBeInTheDocument();
  });

  it('opens the preview on click and dims excluded sources', async () => {
    render(<SourcesRail />);
    await userEvent.click(screen.getByRole('button', { name: 'a.pdf' }));
    expect(handlePreviewSource).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }));
    // DS SidebarRailItem `muted` dims the entry.
    expect(screen.getByRole('button', { name: 'b.pdf' })).toHaveClass('opacity-50');
    expect(screen.getByRole('button', { name: 'a.pdf' })).not.toHaveClass('opacity-50');
  });

  it('leads with an add-source action that opens the upload dialog', async () => {
    render(<SourcesRail />);
    await userEvent.click(screen.getByRole('button', { name: 'addSources' }));
    expect(setShowUploadModal).toHaveBeenCalledWith(true);
  });
});
