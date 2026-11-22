import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { TouchEvent as ReactTouchEvent } from 'react';
import { useViewState } from './useViewState';

// Minimal fake touch events matching what useSwipeGesture reads
// (touches[0].clientX/clientY on start, changedTouches[0].clientX/clientY on
// end). threshold is 50px and horizontal movement must exceed vertical.
function touchStart(x: number): ReactTouchEvent {
  return { touches: [{ clientX: x, clientY: 0 }] } as unknown as ReactTouchEvent;
}
function touchEnd(x: number): ReactTouchEvent {
  return { changedTouches: [{ clientX: x, clientY: 0 }] } as unknown as ReactTouchEvent;
}

function setup(showFilesTab = true) {
  const { result } = renderHook(() => useViewState({ showFilesTab }));
  return { result };
}

// dx = end.x - start.x. dx < 0 (drag left) triggers onSwipeLeft, which in
// useViewState advances TAB_ORDER forward. dx > 0 (drag right) triggers
// onSwipeRight, which moves backward. TAB_ORDER = [history, chat, files] (no
// tools tab since 22.09.2026 — the KB has one main-area view, the chat).
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

  it('Swipe rechts von chat landet auf history', () => {
    const { result } = setup();
    swipeRight(result);
    expect(result.current.mobileTab).toBe('history');
  });

  it('Swipe links von chat landet direkt auf files', () => {
    const { result } = setup();
    swipeLeft(result);
    expect(result.current.mobileTab).toBe('files');
  });

  it('Swipe rechts von files kehrt zu chat zurück', () => {
    const { result } = setup();
    swipeLeft(result); // chat -> files
    expect(result.current.mobileTab).toBe('files');

    swipeRight(result); // files -> chat
    expect(result.current.mobileTab).toBe('chat');
  });

  it('Swipe rechts an der Grenze "history" ist ein No-op', () => {
    const { result } = setup();
    swipeRight(result); // chat -> history
    expect(result.current.mobileTab).toBe('history');

    swipeRight(result); // history -> history (Grenze)
    expect(result.current.mobileTab).toBe('history');
  });

  it('Swipe links an der Grenze "files" ist ein No-op', () => {
    const { result } = setup();
    swipeLeft(result); // chat -> files
    expect(result.current.mobileTab).toBe('files');

    swipeLeft(result); // files -> files (Grenze)
    expect(result.current.mobileTab).toBe('files');
  });
});

// Oracle: without seeSources AppFrame renders only history and chat,
// so the swipe order is exactly those two tabs — no swipe lands on 'files',
// and one swipe right from chat opens history.
describe('useViewState swipe without the files tab', () => {
  it('Swipe links von chat ist ein No-op', () => {
    const { result } = setup(false);
    swipeLeft(result);
    expect(result.current.mobileTab).toBe('chat');
  });

  it('ein Swipe rechts von chat landet auf history', () => {
    const { result } = setup(false);
    swipeLeft(result);
    swipeRight(result);
    expect(result.current.mobileTab).toBe('history');
  });
});
