import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AgentSteps, type AgentStepsProps } from './AgentSteps';
import { translations } from '../../translations';
import * as ThemeContext from '../../contexts/ThemeContext';
import type { TrajectoryEvent } from '../../types';

vi.mock('../../contexts/ThemeContext', () => ({ useTheme: vi.fn() }));

function useLang(language: 'de' | 'en') {
    vi.mocked(ThemeContext.useTheme).mockReturnValue({
        language,
        t: (k: string) => translations[k as keyof typeof translations]?.[language] ?? k,
    } as unknown as ReturnType<typeof ThemeContext.useTheme>);
}

/** The caller owns the open state (MessageContent → useMessageSections). */
function Harness(props: Omit<AgentStepsProps, 'open' | 'onOpenChange' | 'renderReasoning'> & { reasoningText?: string }) {
    const [open, setOpen] = useState(false);
    return <AgentSteps {...props} open={open} onOpenChange={setOpen} renderReasoning={() => <p>{props.reasoningText ?? props.reasoning}</p>} />;
}

const planExecute: TrajectoryEvent[] = [
    { stage: 'plan', reason: 'starting' },
    { stage: 'plan', queries: ['Anmeldefrist Bachelorarbeit', 'Verlängerung'], reason: 'Frist und Ausnahme getrennt suchen' },
    { stage: 'iterate', step: 1, queries: ['Anmeldefrist Bachelorarbeit'] },
    { stage: 'iterate', step: 1, query: 'Anmeldefrist Bachelorarbeit', findings: 3, chunks: [{ idx: 1, file_name: 'PO Informatik 2024.pdf', score: 0.9 }] },
    { stage: 'reasoning' },
    { stage: 'answer', step: 1, decision: 'answered_after_iter' },
];

describe('AgentSteps', () => {
    beforeEach(() => useLang('de'));

    it('renders nothing without a step', () => {
        const { container } = render(<Harness trajectory={[{ stage: 'decision', decision: 'crag_proceed' }]} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('is one collapsed timeline with a summary; opening shows plan, round, thinking and answer in order', () => {
        render(<Harness trajectory={planExecute} reasoning="Ich prüfe die PO." />);
        const header = screen.getByRole('button', { name: 'Plan erstellt, 1 Suche durchgeführt und 2 weitere Schritte' });
        expect(header).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('Recherche-Runde 1')).toBeNull();

        fireEvent.click(header);
        const rows = [...screen.getByTestId('agent-steps').querySelectorAll('[data-stage]')].map(r => r.getAttribute('data-stage'));
        expect(rows).toEqual(['plan', 'iterate', 'reasoning', 'answer']);
        expect(screen.getByText('Recherche-Runde 1')).toBeInTheDocument();
        expect(screen.getByText('Nachgedacht')).toBeInTheDocument();
    });

    it('every row shows its detail right away: queries, rationale, the files as search results', () => {
        render(<Harness trajectory={planExecute} />);
        fireEvent.click(screen.getByRole('button', { name: 'Plan erstellt, 1 Suche durchgeführt und Recherche abgeschlossen' }));
        expect(screen.getByText('PO Informatik 2024.pdf')).toBeInTheDocument();
        expect(screen.getByText('Frist und Ausnahme getrennt suchen')).toBeInTheDocument();
        expect(screen.getByText('Verlängerung')).toBeInTheDocument();
    });

    it('the thinking row shows the rendered reasoning', () => {
        render(<Harness reasoning="Erste Zeile der Überlegung" reasoningText="REASONING BODY" />);
        expect(screen.queryByText('REASONING BODY')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Nachgedacht' }));
        expect(screen.getByText('REASONING BODY')).toBeInTheDocument();
    });

    it('only the header toggles; the rows do not collapse', () => {
        render(<Harness trajectory={planExecute} reasoning="x" />);
        fireEvent.click(screen.getByRole('button', { name: /^Plan erstellt/ }));
        expect(within(screen.getByTestId('agent-steps')).getAllByRole('button')).toHaveLength(1);
    });

    it('each row carries the fade-in hook', () => {
        render(<Harness trajectory={planExecute} />);
        fireEvent.click(screen.getByRole('button', { name: /^Plan erstellt/ }));
        const rows = screen.getByTestId('agent-steps').querySelectorAll('[data-stage]');
        expect(rows.length).toBeGreaterThan(0);
        rows.forEach(r => expect(r).toHaveClass('agent-step'));
    });

    it('while the answer is prepared the header names the current step', () => {
        render(<Harness trajectory={planExecute.slice(0, 4)} working />);
        expect(screen.getByRole('button', { name: 'Recherche-Runde 1' })).toBeInTheDocument();
    });

    it('the header is the chevron, then the line — no icon', () => {
        render(<Harness trajectory={planExecute} />);
        const header = screen.getByRole('button', { name: /^Plan erstellt/ });
        const svgs = header.querySelectorAll('svg');
        expect(svgs).toHaveLength(1);
        expect(svgs[0]).toHaveClass('lucide-chevron-right');
        expect(header.lastElementChild).toHaveTextContent('Plan erstellt');
        fireEvent.click(header);
        expect(header).toHaveAttribute('aria-controls', screen.getByText('Recherche-Runde 1').closest('[id]')?.id);
    });

    it('a degrading step gets the warning icon, a routine one not', () => {
        render(<Harness trajectory={[
            { stage: 'decision', decision: 'crag_rewrite' },
            { stage: 'decision', decision: 'crag_abstain', reason: 'no_relevant_chunks' },
        ]} />);
        fireEvent.click(screen.getByRole('button', { name: '1 Suche durchgeführt und 1 Entscheidung getroffen' }));
        const [rewrite, abstain] = screen.getByTestId('agent-steps').querySelectorAll('[data-stage="decision"]');
        expect(rewrite.querySelector('svg')).not.toHaveClass('text-warning');
        expect(abstain.querySelector('svg')).toHaveClass('text-warning');
    });

    it('uses the English labels', () => {
        useLang('en');
        render(<Harness trajectory={planExecute} reasoning="x" />);
        fireEvent.click(screen.getByRole('button', { name: 'Made a plan, ran 1 search and 2 more steps' }));
        expect(screen.getByText('Research round 1')).toBeInTheDocument();
        expect(screen.getByText('Thought')).toBeInTheDocument();
    });
});
