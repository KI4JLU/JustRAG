import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTopicSettings } from './useTopicSettings';

// Oracle: the acceptance rules for Thema-Einstellungen — open per topic, a
// topic change lands in the new topic's chat, and „Teilen" on a card opens
// its topic directly on Mitglieder.
describe('useTopicSettings', () => {
  const setup = (kbId: string | undefined) =>
    renderHook(({ id }) => useTopicSettings(id), { initialProps: { id: kbId } });

  it('opens on Verhalten from the gear and closes again', () => {
    const { result } = setup('a');
    expect(result.current.open).toBe(false);
    act(() => result.current.setOpen(true));
    expect(result.current).toMatchObject({ open: true, section: 'behavior' });
    act(() => result.current.setOpen(false));
    expect(result.current.open).toBe(false);
  });

  it('closes when the topic changes, and stays closed on the way back', () => {
    const { result, rerender } = setup('a');
    act(() => result.current.setOpen(true));
    rerender({ id: 'b' });
    expect(result.current.open).toBe(false);
    rerender({ id: 'a' });
    expect(result.current.open).toBe(false);
  });

  it('keeps a request for the topic it is about to open (Teilen → Mitglieder)', () => {
    const { result, rerender } = setup('a');
    act(() => result.current.openFor('b', 'members'));
    // Not shown over the topic still open.
    expect(result.current.open).toBe(false);
    rerender({ id: 'b' });
    expect(result.current).toMatchObject({ open: true, section: 'members' });
  });

  it('opens a request for the topic already open at once', () => {
    const { result } = setup('a');
    act(() => result.current.openFor('a', 'members'));
    expect(result.current).toMatchObject({ open: true, section: 'members' });
  });

  it('does nothing from the gear with no topic open', () => {
    const { result } = setup(undefined);
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(false);
  });
});
