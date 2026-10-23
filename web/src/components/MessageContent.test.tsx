import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MessageContent from './MessageContent';
import type { TrajectoryEvent } from '../types';
import { SourcePanelContext, type SourcePanelApi } from '../contexts/SourcePanelContext';
import { translations } from '../translations';
import * as ThemeContext from '../contexts/ThemeContext';

// Mock the module
vi.mock('../contexts/ThemeContext', () => ({
    useTheme: vi.fn(),
}));

// Stub the export helper — it lazy-loads ExcelJS and touches the DOM/Blob APIs,
// neither of which we want to exercise in a unit test of the wiring.
vi.mock('../utils/exportXlsx', () => ({
    exportRowsToXlsx: vi.fn(),
}));

describe('MessageContent', () => {
    beforeEach(() => {
        // Reset mock before each test
        vi.resetAllMocks();
        // Default mock implementation
        // `t` resolves the real English strings: the table footer (MarkdownTable)
        // reads its labels through it.
        vi.mocked(ThemeContext.useTheme).mockReturnValue({
            language: 'en',
            t: (k: string) => translations[k as keyof typeof translations]?.en ?? k,
        } as unknown as ReturnType<typeof ThemeContext.useTheme>);
    });

    it('renders content correctly', () => {
        render(<MessageContent content="Hello world" />);
        expect(screen.getByText('Hello world')).toBeInTheDocument();
    });

    // Oracle: the DS Reasoning disclosure (collapsed once the stream is over,
    // open while thinking) with the app's English labels and the DS German ones.
    it('renders reasoning behind a collapsed trigger when provided', async () => {
        render(<MessageContent content="Hello" reasoning="Thinking process" />);
        const trigger = screen.getByRole('button', { name: /Thought for a few seconds/ });
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(trigger);
        expect(await screen.findByText('Thinking process')).toBeInTheDocument();
    });

    it('renders reasoning with the German label', () => {
        vi.mocked(ThemeContext.useTheme).mockReturnValue({ language: 'de' } as ReturnType<typeof ThemeContext.useTheme>);
        render(<MessageContent content="Hallo" reasoning="Denkprozess" />);
        expect(screen.getByRole('button', { name: /Nachgedacht/ })).toBeInTheDocument();
    });

    it('shows the reasoning open with a thinking label while thinking', () => {
        render(<MessageContent content="" reasoning="Thinking..." isThinking={true} />);
        expect(screen.getByRole('button', { name: /Thinking/ })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Thinking...')).toBeInTheDocument();
    });

    it('renders markdown content', () => {
        render(<MessageContent content="**Bold**" />);
        // ReactMarkdown renders bold as strong
        expect(screen.getByText('Bold').tagName).toBe('STRONG');
    });

    const chips = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>('button.citation-chip')];

    it('renders a citation marker as a numbered chip button named after its source', () => {
        const sources = [{ index: 1, fileName: 'Anforderungen_JLU_RAG.xlsx', fileId: 'f1', content: '', score: 0.9, pages: [4] }];
        const { container } = render(<MessageContent content="Claim [1]." sources={sources} />);
        const [chip] = chips(container);
        expect(chip.textContent).toBe('1');
        expect(chip).toHaveAccessibleName('Source 1: Anforderungen JLU RAG');
        expect(container.textContent).not.toContain('[1]');
    });

    it('treats markdown-escaped \\[N\\] like a plain marker', () => {
        const sources = [{ index: 1, fileName: 'doc.pdf', fileId: 'f1', content: '', score: 0.9 }];
        const { container } = render(<MessageContent content="Claim \[1\]." sources={sources} />);
        expect(chips(container).map(c => c.textContent)).toEqual(['1']);
    });

    it('numbers the sources by first appearance in the answer, without gaps', () => {
        const sources = [
            { index: 1, fileName: 'a.pdf', fileId: 'f1', content: '', score: 0.9 },
            { index: 2, fileName: 'b.pdf', fileId: 'f2', content: '', score: 0.8 },
            { index: 3, fileName: 'c.pdf', fileId: 'f3', content: '', score: 0.7 },
        ];
        const { container } = render(<MessageContent content={'First [3].\n\nSecond [1].'} sources={sources} />);
        const cs = chips(container);
        expect(cs.map(c => c.textContent)).toEqual(['1', '2']);
        expect(cs[0]).toHaveAccessibleName('Source 1: c');
        expect(cs[1]).toHaveAccessibleName('Source 2: a');
    });

    it('renders a grouped or comma-separated marker as chips side by side, without commas', () => {
        const sources = [
            { index: 1, fileName: 'a.pdf', fileId: 'f1', content: '', score: 0.9 },
            { index: 2, fileName: 'b.pdf', fileId: 'f2', content: '', score: 0.8 },
        ];
        const { container } = render(<MessageContent content="Both agree [1, 2]. Again [2], [1]" sources={sources} />);
        expect(chips(container).map(c => c.textContent)).toEqual(['2', '1']);
        expect(container.querySelector('p')?.textContent).toBe('Both agree. Again 21');
    });

    it('collapses several chunks of one file into one chip', () => {
        const sources = [
            { index: 1, fileName: 'report.pdf', fileId: 'f1', content: '', score: 0.9, pages: [4] },
            { index: 2, fileName: 'other.pdf', fileId: 'f2', content: '', score: 0.8, pages: [2] },
            { index: 3, fileName: 'report.pdf', fileId: 'f1', content: '', score: 0.7, pages: [9] },
        ];
        const { container } = render(<MessageContent content="See the analysis [1, 3]." sources={sources} />);
        const cs = chips(container);
        expect(cs.length).toBe(1);
        expect(cs[0].dataset.raw).toBe('1,3');
    });

    it('marks a source once per paragraph, at its last citation', () => {
        const sources = [
            { index: 1, fileName: 'a.pdf', fileId: 'f1', content: '', score: 0.9 },
            { index: 2, fileName: 'b.pdf', fileId: 'f2', content: '', score: 0.8 },
        ];
        const { container } = render(<MessageContent content={'One [1]. Two [2]. Three [1].\n\nFour [1].'} sources={sources} />);
        const [p1, p2] = [...container.querySelectorAll('p')];
        expect(p1.textContent).toBe('One. Two 2. Three 1.');
        expect(p2.textContent).toBe('Four 1.');
    });

    it('drops a marker that points at no source', () => {
        const sources = [{ index: 1, fileName: 'a.pdf', fileId: 'f1', content: '', score: 0.9 }];
        const { container } = render(<MessageContent content="Claim [9]." sources={sources} />);
        expect(chips(container)).toHaveLength(0);
        expect(container.textContent).toBe('Claim.');
    });

    it('resolves 3-digit markers', () => {
        const sources = Array.from({ length: 150 }, (_, i) => ({
            index: i + 1, fileName: `doc${i + 1}.pdf`, fileId: `f${i + 1}`, content: '', score: 0.5,
        }));
        const { container } = render(<MessageContent content="Per the appendix [150]." sources={sources} />);
        expect(chips(container).map(c => c.textContent)).toEqual(['1']);
        expect(chips(container)[0]).toHaveAccessibleName('Source 1: doc150');
    });

    it('colours a suspect citation, without an icon', () => {
        const sources = [{ index: 1, fileName: 'a.pdf', fileId: 'f1', content: '', score: 0.9 }];
        const { container } = render(<MessageContent content="Claim [1]." sources={sources} suspectCitations={new Map([[1, 'no_overlap' as const]])} />);
        const [chip] = chips(container);
        expect(chip.className).toContain('bg-warning-container');
        expect(chip.textContent).toBe('1');
    });

    it('leaves the answer unmarked while the source panel shows a passage', () => {
        const sources = [
            { index: 1, fileName: 'a.pdf', fileId: 'f1', content: '', score: 0.9 },
            { index: 2, fileName: 'b.pdf', fileId: 'f2', content: '', score: 0.8 },
        ];
        const { container } = render(
            <MessageContent content={'One [1].\n\nTwo [2].'} sources={sources} activeCitation={{ n: 2, raw: 2 }} />,
        );
        // Owner decision: the highlight belongs on the cited source text in the panel, not on the answer.
        expect(container.querySelector('[data-cited-active]')).toBeNull();
    });

    it('hides the trajectory panel when no trajectory is provided', () => {
        render(<MessageContent content="answer" />);
        expect(screen.queryByTestId('trajectory-panel')).toBeNull();
    });

    it('renders the trajectory panel collapsed and expands on click for a 3-hop trajectory', () => {
        const trajectory: TrajectoryEvent[] = [
            { stage: 'hop', step: 1, query: 'who lead the project' },
            { stage: 'decision', decision: 'crag_proceed', reason: 'relevant_chunks_sufficient' },
            { stage: 'hop', step: 2, query: 'what is their email', findings: 1, chunks: [{ idx: 1, file_name: 'team.md', score: 0.91 }] },
            { stage: 'answer', step: 2, decision: 'early_stop_sufficient' },
        ];
        render(<MessageContent content="answer" trajectory={trajectory} />);

        const toggle = screen.getByRole('button', { name: /Reasoning steps/i });
        // Collapsed by default — query is not in the DOM yet.
        expect(screen.queryByText(/who lead the project/i)).toBeNull();

        fireEvent.click(toggle);

        // Expanded — every stage's content is now rendered.
        expect(screen.getByText(/who lead the project/i)).toBeInTheDocument();
        expect(screen.getByText(/what is their email/i)).toBeInTheDocument();
        expect(screen.getByText(/crag_proceed/i)).toBeInTheDocument();
        expect(screen.getByText(/early_stop_sufficient/i)).toBeInTheDocument();
    });

    it('renders a Download .xlsx button on a Markdown table', () => {
        const md = '| Name | Score |\n| --- | --- |\n| Alice | 9 |\n| Bob | 7 |';
        render(<MessageContent content={md} />);
        expect(screen.getByRole('button', { name: /Download \.xlsx/i })).toBeInTheDocument();
    });

    it('does not render a Download button when there is no table', () => {
        render(<MessageContent content="Just prose, no table." />);
        expect(screen.queryByRole('button', { name: /Download \.xlsx/i })).toBeNull();
    });

    it('exports the table cells (incl. header) on click', async () => {
        const { exportRowsToXlsx } = await import('../utils/exportXlsx');

        const md = '| Name | Score |\n| --- | --- |\n| Alice | 9 |\n| Bob | 7 |';
        render(<MessageContent content={md} />);
        fireEvent.click(screen.getByRole('button', { name: /Download \.xlsx/i }));

        expect(exportRowsToXlsx).toHaveBeenCalledWith(
            [
                ['Name', 'Score'],
                ['Alice', '9'],
                ['Bob', '7'],
            ],
            { filename: 'table.xlsx' },
        );
    });

    // The per-answer knowledge-graph control moved out of MessageContent into
    // the MessageBubble §8 footer's action row, so its tests now live with
    // MessageBubble's footer.

    it('strips citation markers from exported table cells', async () => {
        const { exportRowsToXlsx } = await import('../utils/exportXlsx');
        const sources = [{ index: 1, fileName: 'doc.pdf', fileId: 'f1', content: '', score: 0.9, pages: [4] }];

        // The cell carries an inline citation that renders as a sup.source-ref.
        const md = '| Topic | Detail |\n| --- | --- |\n| Budget | 5000 EUR [1] |';
        render(<MessageContent content={md} sources={sources} />);
        fireEvent.click(screen.getByRole('button', { name: /Download \.xlsx/i }));

        expect(exportRowsToXlsx).toHaveBeenCalledWith(
            [
                ['Topic', 'Detail'],
                ['Budget', '5000 EUR'],
            ],
            { filename: 'table.xlsx' },
        );
    });
});

// A mouse or trackpad: the chip opens the DS InlineCitation popover.
function stubFinePointer(fine: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('pointer: fine') ? fine : false,
        media: query, onchange: null,
        addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
        dispatchEvent: () => false,
    }));
}

describe('MessageContent source preview (fine pointer: popover)', () => {
    const sources = [
        { index: 1, fileName: 'bericht.pdf', fileId: 'f1', content: 'Der **zitierte** Absatz.', score: 0.9, pages: [7] },
        { index: 2, fileName: 'anhang.pdf', fileId: 'f2', content: 'Zweite Quelle.', score: 0.8, pages: [2] },
    ];

    beforeEach(() => {
        vi.resetAllMocks();
        stubFinePointer(true);
        vi.mocked(ThemeContext.useTheme).mockReturnValue({
            language: 'en',
            t: (k: string) => translations[k as keyof typeof translations]?.en ?? k,
        } as unknown as ReturnType<typeof ThemeContext.useTheme>);
    });

    const chip = (name: RegExp) => screen.getByRole('button', { name });

    // The compact popover: one head row (icon, title, type chip, „Open in
    // source") and the cited lines under it. The number/type/page line is no
    // longer printed — it rides the title's tooltip. „All N sources" is gone
    // (the footer's source list is right under the answer).
    it('opens the preview on click, pinned, with head, rendered excerpt and actions', () => {
        render(<MessageContent content="Claim [1]. More [2]." sources={sources} onOpenPanel={vi.fn()} onShowAllSources={vi.fn()} />);
        fireEvent.click(chip(/Source 1: bericht/));
        const dialog = screen.getByRole('dialog', { name: 'Source 1: bericht' });
        expect(dialog).toHaveTextContent('bericht');
        expect(dialog).toHaveTextContent('PDF');
        expect(dialog.querySelector('[title="bericht · Source 1 · PDF · p. 7"]')).not.toBeNull();
        expect(dialog.querySelector('strong')?.textContent).toBe('zitierte');
        expect(dialog).not.toHaveTextContent('**');
        expect(chip(/Source 1: bericht/)).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('button', { name: 'Open in source' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /All 2 sources|Show list/ })).toBeNull();
    });

    // The last argument is the chip's occurrence (`data-occ`): the answer's
    // only chip is occurrence 0.
    it('"Open in source" hands the display number, the raw citation and the chip to the panel', () => {
        const onOpenPanel = vi.fn();
        render(<MessageContent content="Claim [2]." sources={sources} onOpenPanel={onOpenPanel} />);
        fireEvent.click(chip(/Source 1: anhang/));
        fireEvent.click(screen.getByRole('button', { name: 'Open in source' }));
        expect(onOpenPanel).toHaveBeenCalledWith(1, 2, expect.any(String), 0);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    // With the source panel already open, a chip moves the panel straight to
    // its passage — no popover in between. Second chip of the answer → occ 1.
    it('while the source panel is open, a chip click goes straight to the panel', () => {
        const onOpenPanel = vi.fn();
        const panel: SourcePanelApi = {
            target: { messageKey: 'other', source: {} as never, passage: 0 },
            open: vi.fn(),
            close: vi.fn(),
        };
        render(
            <SourcePanelContext.Provider value={panel}>
                <MessageContent content="Claim [1]. More [2]." sources={sources} onOpenPanel={onOpenPanel} />
            </SourcePanelContext.Provider>,
        );
        fireEvent.click(chip(/Source 2: anhang/));
        expect(onOpenPanel).toHaveBeenCalledWith(2, 2, expect.any(String), 1);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closes on Escape and returns focus to the chip', async () => {
        render(<MessageContent content="Claim [1]." sources={sources} />);
        chip(/Source 1/).focus();
        fireEvent.click(chip(/Source 1/));
        expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        await waitFor(() => expect(document.activeElement).toBe(chip(/Source 1/)));
    });

    it('marks the verified span of the passage', () => {
        render(<MessageContent content="Claim [1]." sources={[{ ...sources[0], content: 'Vorher. Der zitierte Satz. Nachher.' }]} citationSpans={new Map([[1, { start: 8, end: 26 }]])} />);
        fireEvent.click(chip(/Source 1/));
        expect(screen.getByRole('dialog').querySelector('mark')?.textContent).toBe('Der zitierte Satz.');
    });

    it('ignores a malformed span', () => {
        render(<MessageContent content="Claim [1]." sources={sources} citationSpans={new Map([[1, { start: 5, end: 999 }]])} />);
        fireEvent.click(chip(/Source 1/));
        expect(screen.getByRole('dialog').querySelector('mark')).toBeNull();
    });

    it('shows a spreadsheet chunk as label/value pairs of the cited row', () => {
        const content = '### Anforderungen.xlsx › Liste\n[tabular.t rows 1–2]\nID: F-06a | Status: Erledigt\nID: F-06b | Status: Offen\n';
        const start = Array.from(content).length - 'Offen\n'.length;
        render(<MessageContent content="Claim [1]." sources={[{ index: 1, fileName: 'Anforderungen.xlsx', fileId: 'f1', content, score: 0.9 }]} citationSpans={new Map([[1, { start, end: start + 5 }]])} />);
        fireEvent.click(chip(/Source 1/));
        const dialog = screen.getByRole('dialog');
        expect([...dialog.querySelectorAll('dt')].map(d => d.textContent)).toEqual(['ID', 'Status']);
        expect([...dialog.querySelectorAll('dd')].map(d => d.textContent)).toEqual(['F-06b', 'Offen']);
        expect(dialog.querySelector('mark')?.textContent).toBe('Offen');
        expect(dialog).toHaveTextContent('XLSX');
        expect(dialog.querySelector('[title="Anforderungen · Source 1 · Spreadsheet"]')).not.toBeNull();
    });

    it('offers no actions without handlers', () => {
        render(<MessageContent content="Claim [1]." sources={sources} />);
        fireEvent.click(chip(/Source 1/));
        expect(screen.queryByRole('button', { name: 'Open in source' })).toBeNull();
    });
});

describe('MessageContent source preview (touch: sheet)', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        stubFinePointer(false);
        vi.mocked(ThemeContext.useTheme).mockReturnValue({
            language: 'en',
            t: (k: string) => translations[k as keyof typeof translations]?.en ?? k,
        } as unknown as ReturnType<typeof ThemeContext.useTheme>);
    });

    it('opens the same preview in a bottom sheet', () => {
        const sources = [{ index: 1, fileName: 'bericht.pdf', fileId: 'f1', content: 'Der Absatz.', score: 0.9, pages: [7] }];
        render(<MessageContent content="Claim [1]." sources={sources} onOpenPanel={vi.fn()} />);
        const chipEl = screen.getByRole('button', { name: /Source 1: bericht/ });
        fireEvent.click(chipEl);
        const dialog = screen.getByRole('dialog', { name: 'Source 1: bericht' });
        expect(dialog).toHaveTextContent('Der Absatz.');
        expect(dialog).toHaveTextContent('Source 1 · PDF · p. 7');
        expect(chipEl).toHaveAttribute('aria-expanded', 'true');
    });
});

describe('MessageContent — math', () => {
    beforeEach(() => {
        vi.mocked(ThemeContext.useTheme).mockReturnValue({ language: 'de', t: (k: string) => k } as unknown as ReturnType<typeof ThemeContext.useTheme>);
    });

    it('renders display math with KaTeX', () => {
        const { container } = render(<MessageContent content={'Die Lösung:\n\n$$\nx = \\frac{-b}{2a}\n$$\n'} />);
        expect(container.querySelector('.katex-display')).not.toBeNull();
        expect(container.textContent).not.toContain('$$');
        // KaTeX lays formulas out with inline styles and ships MathML for
        // screen readers; run before rehype-sanitize, both would be stripped.
        expect(container.querySelector('.katex-display math')).not.toBeNull();
        expect(container.querySelector('.katex-html [style]')).not.toBeNull();
    });

    it('renders inline math, including the \\( … \\) form LLMs emit', () => {
        const { container } = render(<MessageContent content={'Mit $a^2$ und \\(b^2\\) gilt es.'} />);
        expect(container.querySelectorAll('.katex').length).toBe(2);
    });

    it('does not turn an index inside math into a citation pill', () => {
        const sources = [{ fileName: 'a.pdf', content: 'x' }] as never;
        const { container } = render(<MessageContent content={'Der Vektor $v[1]$ laut [1].'} sources={sources} />);
        expect(container.querySelectorAll('button.citation-chip').length).toBe(1);
        // KaTeX keeps the TeX source in the MathML annotation; pill HTML
        // injected into the formula would show up there.
        expect(container.querySelector('.katex annotation')?.textContent).toBe('v[1]');
    });

    it('keeps escaped citations working', () => {
        const sources = [{ fileName: 'a.pdf', content: 'x' }] as never;
        const { container } = render(<MessageContent content={'Laut \\[1\\].'} sources={sources} />);
        expect(container.querySelectorAll('button.citation-chip').length).toBe(1);
        expect(container.querySelector('.katex')).toBeNull();
    });

    it('leaves dollar signs in code alone', () => {
        const { container } = render(<MessageContent content={'Shell: `echo $HOME $PATH`'} />);
        expect(container.querySelector('.katex')).toBeNull();
        expect(container.textContent).toContain('echo $HOME $PATH');
    });

    it('restores code spans verbatim, including $$ and $& (String.replace patterns)', () => {
        const { container } = render(<MessageContent content={'PID: `echo $$` und `s/x/$&/`'} />);
        expect(container.textContent).toContain('echo $$');
        expect(container.textContent).toContain('s/x/$&/');
    });

    it('shows invalid LaTeX instead of breaking the message', () => {
        const { container } = render(<MessageContent content={'Kaputt: $\\frac{a$ und weiter Text.'} />);
        expect(container.textContent).toContain('weiter Text');
    });
});
