import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';
import type { Dispatch, SetStateAction, TouchEvent as ReactTouchEvent } from 'react';
import { useViewState, type KbViewType } from './useViewState';

// Minimal fake touch events matching what useSwipeGesture reads
// (touches[0].clientX/clientY on start, changedTouches[0].clientX/clientY on
// end). threshold is 50px and horizontal movement must exceed vertical.
function touchStart(x: number): ReactTouchEvent {
  return { touches: [{ clientX: x, clientY: 0 }] } as unknown as ReactTouchEvent;
}
function touchEnd(x: number): ReactTouchEvent {
  return { changedTouches: [{ clientX: x, clientY: 0 }] } as unknown as ReactTouchEvent;
}

// Backs `kbView` with real React state (like AuthenticatedApp does), not a
// bare vi.fn() spy — useViewState's swipe handlers now read `kbView` on every
// render to derive the swipe's starting tab (see `deriveActiveMobileTab`), so
// a call to `setKbView` has to actually feed back into the next render for
// the multi-swipe tests below to track real app behavior. `setKbViewSpy`
// still lets tests assert on individual calls the way the plain vi.fn() did.
function setup(initialKbView: KbViewType = 'chat') {
  const setView = vi.fn();
  const setKbViewSpy = vi.fn();
  const setShowSettings = vi.fn();
  const { result } = renderHook(() => {
    const [kbView, setKbViewState] = useState<KbViewType>(initialKbView);
    const setKbView: Dispatch<SetStateAction<KbViewType>> = (v) => {
      setKbViewSpy(v);
      setKbViewState(v);
    };
    void kbView;
    return useViewState({ setView, setKbView, setShowSettings });
  });
  return { result, setKbView: setKbViewSpy };
}

// dx = end.x - start.x. dx < 0 (drag left) triggers onSwipeLeft, which in
// useViewState advances TAB_ORDER forward. dx > 0 (drag right) triggers
// onSwipeRight, which moves backward. TAB_ORDER = [history, chat, files] (no
// workspace tab since 22.09.2026 — the KB has one main-area view, the chat).
function swipeLeft(result: ReturnType<typeof setup>['result']) {
  act(() => {
    result.current.swipeHandlers.onTouchStart(touchStart(200));
    result.current.swipeHandlers.onTouchEnd(touchEnd(100));
  });
}
function swipeRight(result: ReturnType<typeof setup>['result']) {
  act(() => {
    result.current.swipeHandlers.onTouchStart(touchStart(100));
    result.current.swipeHandlers.onTouchEnd(touchEnd(200));
  });
}

describe('useViewState swipe navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('startet auf "chat"', () => {
    const { result } = setup();
    expect(result.current.mobileTab).toBe('chat');
  });

  it('Swipe rechts von chat landet auf history (kein setKbView-Aufruf)', () => {
    const { result, setKbView } = setup();
    swipeRight(result);
    expect(result.current.mobileTab).toBe('history');
    expect(setKbView).not.toHaveBeenCalled();
  });

  it('Swipe links von chat landet direkt auf files (kein Workspace-Reiter mehr), ohne setKbView', () => {
    const { result, setKbView } = setup();
    swipeLeft(result);
    expect(result.current.mobileTab).toBe('files');
    expect(setKbView).not.toHaveBeenCalled();
  });

  it('Swipe rechts von files kehrt zu chat zurück und ruft setKbView("chat")', () => {
    const { result, setKbView } = setup();
    swipeLeft(result); // chat -> files
    expect(result.current.mobileTab).toBe('files');

    setKbView.mockClear();
    swipeRight(result); // files -> chat
    expect(result.current.mobileTab).toBe('chat');
    expect(setKbView).toHaveBeenCalledWith('chat');
  });

  it('Swipe rechts an der Grenze "history" ist ein No-op', () => {
    const { result, setKbView } = setup();
    swipeRight(result); // chat -> history
    expect(result.current.mobileTab).toBe('history');

    setKbView.mockClear();
    swipeRight(result); // history -> history (Grenze)
    expect(result.current.mobileTab).toBe('history');
    expect(setKbView).not.toHaveBeenCalled();
  });

  it('Swipe links an der Grenze "files" ist ein No-op', () => {
    const { result, setKbView } = setup();
    swipeLeft(result); // chat -> files
    expect(result.current.mobileTab).toBe('files');

    setKbView.mockClear();
    swipeLeft(result); // files -> files (Grenze)
    expect(result.current.mobileTab).toBe('files');
    expect(setKbView).not.toHaveBeenCalled();
  });
});
