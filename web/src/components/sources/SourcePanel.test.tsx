import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SourcePanel } from './SourcePanel';
import { buildCitationModel } from '../../utils/sourceDisplay';

// Keys stand in for the strings, except the marker counter, whose template
// the panel fills ("Beleg {current} von {total}") — it gets a compact one.
vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ t: (key: string) => (key === 'sourcePanelMarker' ? '{current}/{total}' : key), language: 'en' as const }),
}));

// Oracle: the brief's §7 — the panel opens at the passage the chip pointed at
// and lists every passage the answer cites from that file in document order;
// a click on another passage shows it. Its ↑ / ↓ step through every inline
// citation marker of the answer in reading order, across sources ("Beleg x
// von y"), not through one file's passages.
const sources = [
  { index: 1, fileName: 'bericht.pdf', fileId: 'f1', content: 'Seite neun.', score: 1, pages: [9] },
  { index: 2, fileName: 'bericht.pdf', fileId: 'f1', content: 'Seite zwei.', score: 1, pages: [2] },
];
const model = buildCitationModel('A [1]. B [2].', sources);
const source = model.cited[0];

describe('SourcePanel (desktop pane)', () => {
  it('shows the passages in document order, the cited one active, and opens another on click', () => {
    const onPassage = vi.fn();
    render(<SourcePanel target={{ messageKey: 'm', source, passage: 0 }} onClose={vi.fn()} onPassage={onPassage} onNavigate={vi.fn()} canDownload={false} />);
    const pane = screen.getByRole('complementary', { name: 'sourcePanelLabel' });
    const sections = pane.querySelectorAll('section');
    expect([...sections].map(s => s.textContent)).toEqual(['pageAbbrev 2Seite zwei.', 'pageAbbrev 9Seite neun.']);
    expect(sections[1]).toHaveAttribute('aria-current', 'location');
    // Page 2 is passage index 1 (cited second, [2]).
    fireEvent.click(sections[0]);
    expect(onPassage).toHaveBeenCalledWith(1);
    // Without the answer's markers there is nothing to step through.
    expect(screen.queryByRole('button', { name: 'sourcePanelPreviousMarker' })).toBeNull();
  });

  describe('stepping through the answer\'s citation markers', () => {
    // Three paragraphs, so each marker is its own chip: bericht [1], anhang
    // [3], bericht again [2]. Display numbers by first appearance: bericht = 1
    // (raw 1, 2), anhang = 2 (raw 3).
    const crossSources = [
      ...sources,
      { index: 3, fileName: 'anhang.pdf', fileId: 'f2', content: 'Anhang.', score: 1, pages: [1] },
    ];
    const crossModel = buildCitationModel('A [1].\n\nB [3].\n\nC [2].', crossSources);
    const markers = [{ n: 1, raw: 1, occ: 0 }, { n: 2, raw: 3, occ: 1 }, { n: 1, raw: 2, occ: 2 }];
    const at = (occ: number) => {
      const m = markers[occ];
      const cited = crossModel.cited[m.n - 1];
      return { messageKey: 'm', source: cited, passage: cited.rawNumbers.indexOf(m.raw), model: crossModel, markers, occ };
    };

    it('counts the chip the panel shows among all of the answer\'s markers', () => {
      render(<SourcePanel target={at(1)} onClose={vi.fn()} onPassage={vi.fn()} onNavigate={vi.fn()} canDownload={false} />);
      expect(screen.getByRole('complementary')).toHaveTextContent('2/3');
    });

    it('steps to the previous and next marker, across sources', () => {
      const onNavigate = vi.fn();
      render(<SourcePanel target={at(1)} onClose={vi.fn()} onPassage={vi.fn()} onNavigate={onNavigate} canDownload={false} />);
      fireEvent.click(screen.getByRole('button', { name: 'sourcePanelPreviousMarker' }));
      expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ source: crossModel.cited[0], passage: 0, occ: 0 }));
      fireEvent.click(screen.getByRole('button', { name: 'sourcePanelNextMarker' }));
      expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ source: crossModel.cited[0], passage: 1, occ: 2 }));
    });

    it('disables the step past either end', () => {
      const { rerender } = render(<SourcePanel target={at(0)} onClose={vi.fn()} onPassage={vi.fn()} onNavigate={vi.fn()} canDownload={false} />);
      expect(screen.getByRole('button', { name: 'sourcePanelPreviousMarker' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'sourcePanelNextMarker' })).toBeEnabled();
      rerender(<SourcePanel target={at(2)} onClose={vi.fn()} onPassage={vi.fn()} onNavigate={vi.fn()} canDownload={false} />);
      expect(screen.getByRole('button', { name: 'sourcePanelNextMarker' })).toBeDisabled();
    });

    // Opened from the source list there is no chip: the walk starts at this
    // source's first marker (anhang's is the 2nd of 3).
    it('starts at the source\'s first marker when opened from the source list', () => {
      const fromList = { ...at(1), occ: undefined };
      render(<SourcePanel target={fromList} onClose={vi.fn()} onPassage={vi.fn()} onNavigate={vi.fn()} canDownload={false} />);
      expect(screen.getByRole('complementary')).toHaveTextContent('2/3');
    });
  });

  it('closes from its toggle and from "Zur Antwort"', () => {
    const onClose = vi.fn();
    render(<SourcePanel target={{ messageKey: 'm', source, passage: 0 }} onClose={onClose} onPassage={vi.fn()} onNavigate={vi.fn()} canDownload={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'sourcePanelClose' }));
    fireEvent.click(screen.getByRole('button', { name: 'sourcePanelBack' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('offers the origin link a passage carries', () => {
    const withOrigin = buildCitationModel('A [1].', [{ ...sources[0], fileName: 'Seite.md', content: '# T\n\nSource: https://wiki.example/p\n\nText' }]).cited[0];
    render(<SourcePanel target={{ messageKey: 'm', source: withOrigin, passage: 0 }} fileOrigin="confluence" onClose={vi.fn()} onPassage={vi.fn()} onNavigate={vi.fn()} canDownload={false} />);
    expect(screen.getByRole('link', { name: 'openInConfluence' })).toHaveAttribute('href', 'https://wiki.example/p');
    expect(screen.getByRole('complementary')).not.toHaveTextContent('Source: https');
  });
});
