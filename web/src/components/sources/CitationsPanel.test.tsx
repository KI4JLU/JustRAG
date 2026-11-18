import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CitationsPanel } from './CitationsPanel';
import type { Message } from '../../types';

vi.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({ t: (key: string) => key, language: 'de' }),
}));

const source = (name: string, id: string) => ({
    fileName: name, fileId: id, content: 'Inhalt', score: 0.9,
}) as unknown as NonNullable<Message['sources']>[number];

const messages: Message[] = [
    { id: 'q1', role: 'user', content: 'Wie beantrage ich Urlaub?' },
    { id: 'a1', role: 'ai', content: 'Über das Portal [1].', sources: [source('Urlaub.pdf', 'f1')] },
    { id: 'q2', role: 'user', content: 'Und ohne Quelle?' },
    { id: 'a2', role: 'ai', content: 'Dazu steht nichts in den Quellen.' },
] as Message[];

describe('CitationsPanel', () => {
    it('lists the cited sources of each answer under its question, and skips answers without any', () => {
        render(<CitationsPanel messages={messages} target={null} onOpen={() => {}} />);
        const panel = screen.getByRole('region', { name: 'sidePanelCitations' });
        const groups = within(panel).getAllByRole('heading', { level: 3 });
        expect(groups).toHaveLength(1);
        expect(groups[0]).toHaveTextContent('Wie beantrage ich Urlaub?');
        expect(within(panel).getAllByRole('button')).toHaveLength(1);
    });

    it('opens a source with its answer as the target', async () => {
        const onOpen = vi.fn();
        render(<CitationsPanel messages={messages} target={null} onOpen={onOpen} />);
        await userEvent.click(screen.getByRole('button'));
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(onOpen.mock.calls[0][0]).toMatchObject({ messageKey: 'a1', passage: 0, source: { n: 1 } });
    });

    it('says so when the chat cites nothing yet', () => {
        render(<CitationsPanel messages={[]} target={null} onOpen={() => {}} />);
        expect(screen.getByText('sidePanelCitationsEmpty')).toBeInTheDocument();
        expect(screen.queryByRole('button')).toBeNull();
    });
});
