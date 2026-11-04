import { useLayoutEffect, useRef, useState } from 'react';

/** How many whole lines of `lineHeight` fit into `height` — at least one. */
export function fittingLines(height: number, lineHeight: number): number {
  if (!(lineHeight > 0)) return 1;
  // Half a pixel of slack: a box of 59.99px is three 20px lines, not two.
  return Math.max(1, Math.floor((height + 0.5) / lineHeight));
}

/**
 * A line clamp that follows the element's height: for a box whose height the
 * layout sets (absolutely positioned, a flex cell) rather than its text. A
 * fixed `line-clamp-N` in a box shorter than N lines lets the overflow clip
 * the last line through the middle, with no ellipsis; this clamps to the
 * lines that fit, so the text ends on a whole line.
 *
 * @returns `[ref, lines]` — `lines` is `undefined` until measured (and where
 * `ResizeObserver` does not exist); pass it as `WebkitLineClamp`.
 */
export function useFittingLineClamp<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [lines, setLines] = useState<number>();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const style = getComputedStyle(el);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
      setLines(fittingLines(el.clientHeight, lineHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, lines] as const;
}
