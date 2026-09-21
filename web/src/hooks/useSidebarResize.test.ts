import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEFT_SIDEBAR_BOUNDS,
  LEFT_SIDEBAR_WIDTH_KEY,
  RIGHT_SIDEBAR_BOUNDS,
  RIGHT_SIDEBAR_WIDTH_KEY,
  useSidebarResize,
} from './useSidebarResize';

/* What THIS hook owns is the wiring: two distinct keys in the app's storage
 * namespace, the bounds the old drag code enforced, one shared default. The
 * storage mechanics (write-through, clamp on read, NaN, a throwing Storage)
 * are the design system's `usePersistedWidth` and are tested THERE, against
 * an injected in-memory Storage — asserting them again here would test the
 * design system's code a second time, not this file.
 *
 * So the design-system hook is replaced by a recording stub. ORACLE: the key
 * strings and bounds this test spells out by hand against `STORAGE_NAMESPACE`,
 * not the constants' own values read back — a hook that wrote both widths to
 * one key, or swapped the bounds, fails here. Everything else in
 * `@ki4jlu/design-system` stays real (`importOriginal`). */
type PersistedOpts = { defaultWidth: number; minWidth: number; maxWidth: number };
type Setter = ReturnType<typeof vi.fn>;
/** Every call the hook under test makes into the stub, in order. */
const calls: { key: string; opts: PersistedOpts; setter: Setter }[] = [];

vi.mock('@ki4jlu/design-system', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePersistedWidth: (key: string, opts: PersistedOpts) => {
    // A minimal controlled pair, so the returned setter is the stub's own and
    // the "which setter reaches which column" assertion is meaningful.
    const setter = vi.fn();
    calls.push({ key, opts, setter });
    return [opts.defaultWidth, setter] as const;
  },
}));

beforeEach(() => { calls.length = 0; });
/** The first render's two calls — left, then right — which is what `result.current` is bound to. */
const firstRender = () => calls.slice(0, 2);

describe('useSidebarResize — hands the design system two keys and two ranges', () => {
  it('persists each column under its own justrag.-prefixed key', () => {
    renderHook(() => useSidebarResize());
    expect(firstRender().map(c => c.key)).toEqual(['justrag.kb.sidebar.left.width', 'justrag.kb.sidebar.right.width']);
    expect(LEFT_SIDEBAR_WIDTH_KEY).not.toBe(RIGHT_SIDEBAR_WIDTH_KEY);
  });

  it('passes the bounds (right raised to 300) and one shared default', () => {
    renderHook(() => useSidebarResize());
    const [left, right] = firstRender();
    expect(left.opts).toEqual({ defaultWidth: 320, minWidth: 150, maxWidth: 600 });
    expect(right.opts).toEqual({ defaultWidth: 320, minWidth: 300, maxWidth: 800 });
    expect(LEFT_SIDEBAR_BOUNDS).toEqual({ min: 150, max: 600 });
    expect(RIGHT_SIDEBAR_BOUNDS).toEqual({ min: 300, max: 800 });
  });

  it('returns each column its OWN setter', () => {
    const { result } = renderHook(() => useSidebarResize());
    act(() => result.current.setLeftSidebarWidth(412));
    const [left, right] = firstRender();
    expect(left.setter).toHaveBeenCalledWith(412);
    expect(right.setter).not.toHaveBeenCalled();
  });

  it('keeps the open state in plain component state', () => {
    const { result } = renderHook(() => useSidebarResize());
    act(() => result.current.setIsLeftSidebarOpen(false));
    expect(result.current.isLeftSidebarOpen).toBe(false);
    expect(result.current.isRightSidebarOpen).toBe(true);
    // Only the two width keys ever reach storage — across every render.
    expect(new Set(calls.map(c => c.key))).toEqual(new Set([LEFT_SIDEBAR_WIDTH_KEY, RIGHT_SIDEBAR_WIDTH_KEY]));
  });
});
