import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';
import { toast as sonner } from '@ki4jlu/design-system';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastOptions {
  duration?: number;
}

interface ToastApi {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
  warning: (message: string, options?: ToastOptions) => void;
}

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 4000,
  error: 6000,
  info: 4000,
  warning: 5000,
};

const ToastContext = createContext<ToastApi | null>(null);

interface ToastProviderProps {
  children: ReactNode;
  /** While it answers true, error toasts are dropped. For the moment the
   * session ends: every request in flight fails with it, and each caller
   * reports its own failure although the login page already says why. Asked
   * per toast, not passed as state — the callers' handlers run before the
   * next render. */
  muteErrors?: () => boolean;
}

/**
 * The app's toast API over the design system's `toast` (Sonner), shown by the
 * one `Toaster` (components/ui/ToastStack.tsx). Sonner owns the queue, the
 * timers and the pile; this adds the app's rules on top: default durations
 * per type, errors muted while the session ends, and an identical toast still
 * on screen replaced instead of stacked — when the server is unreachable
 * every load fails with the same message, and one toast says it where four
 * would shout. The same type and message reuse the toast's id while it is
 * on screen, so Sonner updates it in place; once it starts to leave (closed,
 * swiped, timed out) the id is retired, so a retry in its exit animation gets
 * a toast of its own instead of updating the leaving one into oblivion.
 */
export function ToastProvider({ children, muteErrors }: ToastProviderProps) {
  // `type:message` → the id of that toast while it is on screen.
  const active = useRef(new Map<string, string>());
  const count = useRef(0);
  const addToast = useCallback((type: ToastType, message: string, options?: ToastOptions) => {
    if (type === 'error' && muteErrors?.()) return;
    const key = `${type}:${message}`;
    const id = active.current.get(key) ?? `${key}#${++count.current}`;
    active.current.set(key, id);
    const retire = () => {
      if (active.current.get(key) === id) active.current.delete(key);
    };
    sonner[type](message, {
      id,
      duration: options?.duration ?? DEFAULT_DURATIONS[type],
      onDismiss: retire,
      onAutoClose: retire,
    });
  }, [muteErrors]);

  const toast: ToastApi = useMemo(() => ({
    success: (msg: string, opts?: ToastOptions) => addToast('success', msg, opts),
    error: (msg: string, opts?: ToastOptions) => addToast('error', msg, opts),
    info: (msg: string, opts?: ToastOptions) => addToast('info', msg, opts),
    warning: (msg: string, opts?: ToastOptions) => addToast('warning', msg, opts),
  }), [addToast]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
