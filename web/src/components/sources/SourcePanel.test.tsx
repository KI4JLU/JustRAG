import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SourcePanel } from './SourcePanel';
import { buildCitationModel } from '../../utils/sourceDisplay';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ t: (key: string) => key, language: 'en' as const }),
}));

// Oracle: the brief's §7 — the panel opens at the passage the chip pointed at,
// lists every passage the answer cites from that file in document order and
// steps through them with "1 von N".
const sources = [
  { index: 1, fileName: 'bericht.pdf', fileId: 'f1', content: 'Seite neun.', score: 1, pages: [9] },
  { index: 2, fileName: 'bericht.pdf', fileId: 'f1', content: 'Seite zwei.', score: 1, pages: [2] },
];
const model = buildCitationModel('A [1]. B [2].', sources);
const source = model.cited[0];

describe('SourcePanel (desktop pane)', () => {
  it('shows the passages in document order, the cited one active, and steps through them', () => {
    const onPassage = vi.fn();
    render(<SourcePanel target={{ messageKey: 'm', source, passage: 0 }} onClose={vi.fn()} onPassage={onPassage} canDownload={false} />);
    const pane = screen.getByRole('complementary', { name: 'sourcePanelLabel' });
    const sections = pane.querySelectorAll('section');
    expect([...sections].map(s => s.textContent)).toEqual(['pageAbbrev 2Seite zwei.', 'pageAbbrev 9Seite neun.']);
    expect(sections[1]).toHaveAttribute('aria-current', 'location');
    fireEvent.click(screen.getByRole('button', { name: 'sourcePanelPrevious' }));
    expect(onPassage).toHaveBeenCalledWith(1);
    expect(screen.getByRole('button', { name: 'sourcePanelNext' })).toBeDisabled();
  });

  it('closes from its toggle and from "Zur Antwort"', () => {
    const onClose = vi.fn();
    render(<SourcePanel target={{ messageKey: 'm', source, passage: 0 }} onClose={onClose} onPassage={vi.fn()} canDownload={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'sourcePanelClose' }));
    fireEvent.click(screen.getByRole('button', { name: 'sourcePanelBack' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('offers the origin link a passage carries', () => {
    const withOrigin = buildCitationModel('A [1].', [{ ...sources[0], fileName: 'Seite.md', content: '# T\n\nSource: https://wiki.example/p\n\nText' }]).cited[0];
    render(<SourcePanel target={{ messageKey: 'm', source: withOrigin, passage: 0 }} fileOrigin="confluence" onClose={vi.fn()} onPassage={vi.fn()} canDownload={false} />);
    expect(screen.getByRole('link', { name: 'openInConfluence' })).toHaveAttribute('href', 'https://wiki.example/p');
    expect(screen.getByRole('complementary')).not.toHaveTextContent('Source: https');
  });
});
