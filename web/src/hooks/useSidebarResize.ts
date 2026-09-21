import { useState } from 'react';
import { usePersistedWidth } from '@ki4jlu/design-system';
import { STORAGE_NAMESPACE } from './useStoredFlag';

/* ---------------------------------------------------------------------------
 * The KB screen's two column states: open/closed and width, left and right.
 *
 * WHAT LEFT (2026-09-21). Until the KB screen moved onto the design system's
 * `AppShellLayout`, this hook also ran the drag: `isResizingLeft/Right`, a
 * document-level `mousemove` listener computing the width from `clientX`, and
 * the body cursor. The design system's `ResizeHandle` owns all of that now —
 * pointer drag, arrow keys, Home/End, clamping — and reports one clamped
 * number through `onWidthChange`. A second drag loop here would be exactly
 * the failure mode that component's doc names. So this hook holds STATE only.
 *
 * WIDTHS ARE PERSISTED PER DEVICE — BY THE DESIGN SYSTEM'S OWN HOOK. The
 * developer ruled on 2026-09-21 that the design system is the single source
 * of truth for this: `usePersistedWidth` (0.36.0) does the storage, the
 * try/catch around Safari private mode, the clamp on read and the NaN
 * fallback, once, for JustRAG and CampusAgents alike. This app supplies only
 * what is its own: the two storage KEYS (in its `justrag.` namespace, like
 * every other remembered preference here) and the bounds. A local
 * `useStoredNumber` written earlier the same day was deleted in favour of it.
 *
 * Open state is NOT persisted: a column width is a lasting preference, which
 * columns were open is a position in a session. The AppChrome sidebar
 * (`useSidebarCollapse`) is the one open-state that IS remembered, and that
 * stays its own decision.
 *
 * DEFAULTS. Both 320px — the developer asked for the two columns to match,
 * with the right one narrower than its old 500 and the left wider than the
 * shell's 256 (2026-09-21). BOUNDS are the ones the old drag code enforced
 * (left 150–600; right 300–800, raised from 150 on 21.09.2026); they are the `ResizeHandle`'s
 * `aria-valuemin/max` and what a stored value is clamped into on read.
 * ------------------------------------------------------------------------- */

export const LEFT_SIDEBAR_WIDTH_KEY = `${STORAGE_NAMESPACE}kb.sidebar.left.width`;
export const RIGHT_SIDEBAR_WIDTH_KEY = `${STORAGE_NAMESPACE}kb.sidebar.right.width`;

export const LEFT_SIDEBAR_BOUNDS = { min: 150, max: 600 } as const;
// Right minimum 300 (developer, 21.09.2026): below that the source cards'
// title, meta line and three row actions no longer fit on one row. A stored
// narrower width from before this rule is clamped up on read.
export const RIGHT_SIDEBAR_BOUNDS = { min: 300, max: 800 } as const;

const DEFAULT_SIDEBAR_WIDTH = 320;

export function useSidebarResize() {
  const [leftSidebarWidth, setLeftSidebarWidth] = usePersistedWidth(LEFT_SIDEBAR_WIDTH_KEY, {
    defaultWidth: DEFAULT_SIDEBAR_WIDTH,
    minWidth: LEFT_SIDEBAR_BOUNDS.min,
    maxWidth: LEFT_SIDEBAR_BOUNDS.max,
  });
  const [rightSidebarWidth, setRightSidebarWidth] = usePersistedWidth(RIGHT_SIDEBAR_WIDTH_KEY, {
    defaultWidth: DEFAULT_SIDEBAR_WIDTH,
    minWidth: RIGHT_SIDEBAR_BOUNDS.min,
    maxWidth: RIGHT_SIDEBAR_BOUNDS.max,
  });
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);

  return {
    leftSidebarWidth,
    rightSidebarWidth,
    isLeftSidebarOpen,
    setIsLeftSidebarOpen,
    isRightSidebarOpen,
    setIsRightSidebarOpen,
    setLeftSidebarWidth,
    setRightSidebarWidth,
  };
}
