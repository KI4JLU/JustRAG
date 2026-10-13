import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Button, Dialog, DialogContent, DialogTitle } from '@ki4jlu/design-system';
import { ModalProvider, useModalContext } from '../contexts/ModalContext';

vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));

/** A DS dialog (like the members dialog) whose button asks for a confirmation. */
function Host({ onAnswer }: { onAnswer: (answer: boolean) => void }) {
  const { showConfirm } = useModalContext();
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Mitglieder</DialogTitle>
        <Button onClick={async () => onAnswer(await showConfirm('Diesen Einladungslink widerrufen?', 'Bestätigen'))}>
          Widerrufen
        </Button>
      </DialogContent>
    </Dialog>
  );
}

beforeEach(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
});

// ORACLES: the DOM's own click rules as user-event enforces them (it refuses to
// click an element that has or inherits `pointer-events: none` — the bug), the
// dialogs' accessible names, and the answer the caller's promise resolves to.
describe('Modal — confirm opened from inside a DS dialog', () => {
  it('can be clicked, resolves the answer and leaves the outer dialog open', async () => {
    const onAnswer = vi.fn();
    render(<ModalProvider><Host onAnswer={onAnswer} /></ModalProvider>);

    await userEvent.click(screen.getByRole('button', { name: 'Widerrufen' }));
    const confirm = await screen.findByRole('dialog', { name: 'Bestätigen' });
    expect(confirm).toHaveAccessibleDescription('Diesen Einladungslink widerrufen?');

    await userEvent.click(screen.getByRole('button', { name: 'confirm' }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(true));
    expect(screen.queryByRole('dialog', { name: 'Bestätigen' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Mitglieder' })).toBeInTheDocument();
  });

  it('answers false on cancel, and Escape closes only the confirm', async () => {
    const onAnswer = vi.fn();
    render(<ModalProvider><Host onAnswer={onAnswer} /></ModalProvider>);

    await userEvent.click(screen.getByRole('button', { name: 'Widerrufen' }));
    await screen.findByRole('dialog', { name: 'Bestätigen' });
    await userEvent.click(screen.getByRole('button', { name: 'cancel' }));
    await waitFor(() => expect(onAnswer).toHaveBeenLastCalledWith(false));

    await userEvent.click(screen.getByRole('button', { name: 'Widerrufen' }));
    await screen.findByRole('dialog', { name: 'Bestätigen' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bestätigen' })).toBeNull());
    expect(onAnswer).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('dialog', { name: 'Mitglieder' })).toBeInTheDocument();
  });
});
