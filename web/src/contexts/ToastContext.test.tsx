import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider, useToastContext } from './ToastContext';

const wrapper = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>;

describe('ToastProvider', () => {
  // Oracle: an unreachable server makes every load fail with the same
  // message; the user must see it once, not once per request.
  it('replaces an identical toast instead of stacking it', () => {
    const { result } = renderHook(() => useToastContext(), { wrapper });
    act(() => {
      result.current.toast.error('Der Dienst ist gerade nicht erreichbar.');
      result.current.toast.error('Der Dienst ist gerade nicht erreichbar.');
      result.current.toast.error('Der Dienst ist gerade nicht erreichbar.');
    });
    expect(result.current.toasts).toHaveLength(1);
  });

  it('keeps toasts that differ in message or type', () => {
    const { result } = renderHook(() => useToastContext(), { wrapper });
    act(() => {
      result.current.toast.error('a');
      result.current.toast.error('b');
      result.current.toast.warning('a');
    });
    expect(result.current.toasts.map(t => `${t.type}:${t.message}`)).toEqual(['error:a', 'error:b', 'warning:a']);
  });
});
