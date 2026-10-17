import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { SystemPromptPanel } from './SystemPromptPanel';
import { SOURCE_FLAG_DEFAULTS } from '../utils/kbRoleRights';

vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k, language: 'de' }) }));
vi.mock('axios', () => ({ default: { get: vi.fn(() => Promise.resolve({ data: { prompt: '' } })) } }));

const renderPanel = (dirty: boolean, onSave = vi.fn()) => {
    render(
        <SystemPromptPanel
            draft="" onDraftChange={vi.fn()} onSave={onSave} onDelete={vi.fn()} onClose={vi.fn()}
            flags={{ ...SOURCE_FLAG_DEFAULTS }} onFlagsChange={vi.fn()} onAssignPeople={vi.fn()} dirty={dirty}
        />,
    );
    return { onSave };
};

// Oracle: Sten's mockup of 2026-10-16 — "Keine Änderungen" on the left while
// nothing changed, Speichern disabled until something did; Löschen only on
// the Verhalten tab.
describe('SystemPromptPanel footer', () => {
    it('says nothing changed and keeps Speichern disabled while clean', () => {
        renderPanel(false);
        expect(screen.getByText('kbSettingsNoChanges')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /save/ })).toBeDisabled();
    });

    it('enables Speichern once something changed', async () => {
        const { onSave } = renderPanel(true);
        expect(screen.queryByText('kbSettingsNoChanges')).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: /save/ }));
        expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('offers Löschen on Verhalten only', async () => {
        renderPanel(false);
        expect(screen.getByRole('button', { name: /delete/ })).toBeInTheDocument();
        await userEvent.click(screen.getByRole('tab', { name: 'kbSettingsTabRoles' }));
        expect(screen.queryByRole('button', { name: /delete/ })).toBeNull();
    });
});
