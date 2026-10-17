import type React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SourcesRail } from './SourcesRail';

const handlePreviewSource = vi.fn();
const setShowUploadModal = vi.fn();
const handleToggleFilesSelection = vi.fn();
// The caller's role on the open KB, and the backend's resolved capabilities
// (undefined = an older backend). The real kbSourceRights decides from them.
let myRole: string | undefined = 'edit';
let capabilities: Record<string, boolean> | undefined;

// The preview card itself is not under test here.
vi.mock('@ki4jlu/design-system', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  HoverCard: ({ children }: { children: React.ReactNode }) => children,
  HoverCardTrigger: ({ children }: { children: React.ReactNode }) => children,
  // A marker per hover preview, so a test can tell whether an icon has one.
  HoverCardContent: () => <span data-testid="hover-preview" />,
  FilePreview: () => null,
}));
vi.mock('../../hooks/sourcePreviews', () => ({
  useSourcePreviews: () => undefined,
  useSourcePreview: () => ({ image: undefined, pending: false }),
  preloadSourcePreview: () => Promise.resolve(null),
}));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: 'user' } }) }));
vi.mock('../../contexts/KbCoreContext', () => ({
  useKbCore: () => ({ currentKb: { id: 'kb1', isGlobal: false, visibility: 'private', userId: null, myRole, capabilities } }),
}));
vi.mock('../../contexts/KbDataContext', () => ({
  useKbData: () => ({
    fileMgmt: {
      setShowUploadModal,
      handleToggleFilesSelection,
      files: [
        { id: 'f1', name: 'a.pdf', origin: 'upload', status: 'completed', selected: true },
        { id: 'f2', name: 'b.pdf', origin: 'upload', status: 'completed', selected: false },
        { id: 'r1', name: 'feed item', origin: 'rss', status: 'completed' },
      ],
    },
    webTools: { handlePreviewSource },
  }),
}));

beforeEach(() => { vi.clearAllMocks(); myRole = 'edit'; capabilities = undefined; });

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

  it('offers no add-source action to a viewer (the edit chain would refuse the upload)', () => {
    myRole = 'view';
    render(<SourcesRail />);
    expect(screen.queryByRole('button', { name: 'addSources' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'a.pdf' })).toBeInTheDocument();
  });

  // Oracle: backend contract 2026-10-16 — the "+" creates a source, so it
  // follows capabilities.addSources, switchable for viewers and editors alike.
  it('offers the add-source action to a viewer the KB lets add sources', () => {
    myRole = 'view';
    capabilities = { seeSources: true, addSources: true, downloadSources: false, seeCitations: false, manageSources: false };
    render(<SourcesRail />);
    expect(screen.getByRole('button', { name: 'addSources' })).toBeInTheDocument();
  });

  it('offers no add-source action to an editor the KB denies adding', () => {
    capabilities = { seeSources: true, addSources: false, downloadSources: true, seeCitations: true, manageSources: true };
    render(<SourcesRail />);
    expect(screen.queryByRole('button', { name: 'addSources' })).not.toBeInTheDocument();
  });

  // Oracle: backend contract 2026-10-16 — opening a source (and its hover
  // preview) loads the file, which downloadSources gates. Without it an icon
  // is display-only (DS SidebarRailItem interactive={false}): no button, not
  // focusable, a click does nothing.
  it('without downloadSources an icon is a display-only tile with no preview', async () => {
    myRole = 'view';
    capabilities = { seeSources: true, addSources: false, downloadSources: false, seeCitations: true, manageSources: false };
    render(<SourcesRail />);
    expect(screen.queryByTestId('hover-preview')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'a.pdf' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'b.pdf' })).not.toBeInTheDocument();
    const tile = screen.getByRole('img', { name: 'b.pdf' });
    expect(tile).not.toHaveAttribute('tabindex');
    await userEvent.click(tile);
    expect(handlePreviewSource).not.toHaveBeenCalled();
    expect(handleToggleFilesSelection).not.toHaveBeenCalled();
  });

  it('with downloadSources an icon has a hover preview and opens the preview', async () => {
    capabilities = { seeSources: true, addSources: false, downloadSources: true, seeCitations: true, manageSources: false };
    render(<SourcesRail />);
    expect(screen.getAllByTestId('hover-preview')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'a.pdf' }));
    expect(handlePreviewSource).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }));
    expect(handleToggleFilesSelection).not.toHaveBeenCalled();
  });
});
