import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MessageBubble from './MessageBubble';
import type { Message } from './types';
import { SourcePanelContext } from './contexts/SourcePanelContext';

// Same harness mocks as MessageBubble.test.tsx: identity `t`, the footer's
// MessageActions contexts, and no matchMedia in jsdom.
vi.mock('./contexts/ThemeContext', () => ({
  useTheme: () => ({ t: (key: string) => key, language: 'en' as const }),
}));
vi.mock('./contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));
vi.mock('./contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, siteConfigs: {} }),
}));
vi.mock('./hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
  getMotionProps: () => ({}),
}));

/* ---------------------------------------------------------------------------
 * Oracle: the backend contract of 2026-10-16 and the UI rule that comes with
 * it — a caller only sees what they can use; nothing is shown disabled.
 *
 *  - seeCitations (ChatView → `showCitations`): the inline [n] markers and
 *    their source popover, the "Quellen · N" list, and the conflict report
 *    (it names the sources) exist only with it.
 *  - downloadSources (ChatView passes `onPdfOpen` / `onPreviewSource` only
 *    with it): "Im Dokument öffnen" — in the list and in the popover — exists
 *    only with it, since both open the downloaded file.
 * ------------------------------------------------------------------------- */
const answer: Message = {
  id: 'ai1',
  role: 'ai',
  content: 'Die Beitragshöhe beträgt 50 EUR [1].',
  sources: [{ index: 1, fileName: 'satzung.pdf', fileId: 'f1', content: 'Beitrag 50 EUR', score: 1, pages: [3] }],
  conflicts: [{ claim: 'Beitrag', sourceA: 1, sourceB: 2, kind: 'contradiction', newer: 'unknown', fileA: 'alt.md', fileB: 'neu.md' }],
};

describe('MessageBubble — seeCitations', () => {
  it('with it: the inline citation, the source list toggle and the conflict report', () => {
    const { container } = render(<MessageBubble message={answer} showCitations />);
    expect(container.querySelector('button.citation-chip')).not.toBeNull();
    expect(screen.getByRole('button', { name: /answerSourcesToggle/ })).toBeInTheDocument();
    expect(screen.getByLabelText('conflictsBadge')).toBeInTheDocument();
  });

  it('without it: no marker in the text, no source list, no conflict report', () => {
    const { container } = render(<MessageBubble message={answer} showCitations={false} />);
    expect(container.querySelector('button.citation-chip')).toBeNull();
    expect(container).toHaveTextContent('Die Beitragshöhe beträgt 50 EUR.');
    expect(container).not.toHaveTextContent('[1]');
    expect(screen.queryByRole('button', { name: /answerSourcesToggle/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('conflictsBadge')).not.toBeInTheDocument();
  });

  it('defaults to showing citations (a backend without capabilities)', () => {
    const { container } = render(<MessageBubble message={answer} />);
    expect(container.querySelector('button.citation-chip')).not.toBeNull();
  });

  it('leaves a user message untouched', () => {
    render(<MessageBubble message={{ id: 'u1', role: 'user', content: 'Was steht in [1]?' }} showCitations={false} />);
    expect(screen.getByText('Was steht in [1]?')).toBeInTheDocument();
  });
});

describe('MessageBubble — opening a source', () => {
  it('without a source panel: the list row and "openInSource" open the document, with downloadSources', () => {
    const onPdfOpen = vi.fn();
    const { container } = render(<MessageBubble message={answer} onPdfOpen={onPdfOpen} sourcesOpen />);
    fireEvent.click(screen.getByRole('button', { name: /satzung/ }));
    expect(onPdfOpen).toHaveBeenCalledWith('f1', 'satzung.pdf', 3);
    fireEvent.click(container.querySelector('button.citation-chip') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'openInSource' }));
    expect(onPdfOpen).toHaveBeenCalledTimes(2);
  });

  it('without a source panel and without downloadSources: the preview opens, nothing offers the document', () => {
    const { container } = render(<MessageBubble message={answer} sourcesOpen />);
    // The list itself is citation content and stays, as plain rows.
    expect(screen.getByText('satzung')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /satzung/ })).not.toBeInTheDocument();
    fireEvent.click(container.querySelector('button.citation-chip') as HTMLElement);
    expect(screen.getByRole('dialog')).toHaveTextContent('satzung');
    expect(screen.queryByRole('button', { name: 'openInSource' })).not.toBeInTheDocument();
  });

  it('with the chat view\'s source panel: row and preview open the panel at the cited passage', () => {
    const open = vi.fn();
    const { container } = render(
      <SourcePanelContext.Provider value={{ target: null, open, close: vi.fn() }}>
        <MessageBubble message={answer} sourcesOpen />
      </SourcePanelContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /satzung/ }));
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ messageKey: 'ai1', passage: 0, source: expect.objectContaining({ n: 1, fileId: 'f1' }) }));
    fireEvent.click(container.querySelector('button.citation-chip') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'openInSource' }));
    expect(open).toHaveBeenCalledTimes(2);
  });
});
