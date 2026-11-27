import { afterEach, describe, expect, it } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { Toaster, toast as sonner } from '@ki4jlu/design-system';
import { ToastProvider, useToast } from './ToastContext';

afterEach(() => {
  act(() => {
    sonner.dismiss();
  });
});

/** The toasts on screen, as `type:message`. */
const shown = () =>
  Array.from(document.querySelectorAll('[data-sonner-toast]')).map(
    (el) => `${el.getAttribute('data-type')}:${el.querySelector('[data-title] [data-slot=toast-title-row] > span')?.textContent}`,
  );

function setup(muteErrors?: () => boolean) {
  render(<Toaster />);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ToastProvider muteErrors={muteErrors}>{children}</ToastProvider>
  );
  return renderHook(() => useToast(), { wrapper }).result;
}

// Sonner hands a new toast to the Toaster in a timeout.
const raise = async (fn: () => void) => {
  await act(async () => {
    fn();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe('ToastProvider', () => {
  // Oracle: an unreachable server makes every load fail with the same
  // message; the user must see it once, not once per request.
  it('replaces an identical toast instead of stacking it', async () => {
    const toast = setup();
    await raise(() => {
      toast.current.error('Der Dienst ist gerade nicht erreichbar.');
      toast.current.error('Der Dienst ist gerade nicht erreichbar.');
      toast.current.error('Der Dienst ist gerade nicht erreichbar.');
    });
    expect(shown()).toEqual(['error:Der Dienst ist gerade nicht erreichbar.']);
  });

  it('keeps toasts that differ in message or type', async () => {
    const toast = setup();
    await raise(() => {
      toast.current.error('a');
      toast.current.error('b');
      toast.current.warning('a');
    });
    expect(shown().sort()).toEqual(['error:a', 'error:b', 'warning:a']);
  });

  // Oracle: a retry right after closing the same error must still be shown —
  // Sonner removes a closed toast only after its exit animation (200 ms).
  it('shows a retry raised while the closed toast is still leaving', async () => {
    const toast = setup();
    await raise(() => toast.current.error('Speichern fehlgeschlagen'));
    await userEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    await raise(() => toast.current.error('Speichern fehlgeschlagen'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(shown()).toEqual(['error:Speichern fehlgeschlagen']);
  });

  it('drops errors while muted, and only errors', async () => {
    const toast = setup(() => true);
    await raise(() => {
      toast.current.error('Sitzung abgelaufen');
      toast.current.info('Abgemeldet');
    });
    expect(shown()).toEqual(['info:Abgemeldet']);
  });
});
