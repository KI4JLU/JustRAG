import type { MouseEventHandler, ReactNode } from 'react';
import { cn } from '@ki4jlu/design-system';

interface KbListRowProps {
  /** Before the name: a favorite's star, a globe. */
  leading?: ReactNode;
  /** The name, usually in a `truncate` element: it is what shrinks when the row is narrow. */
  name: ReactNode;
  /** After the name, on the row's right: facts, badges and the ⋮ menu. Never shrinks. */
  trailing?: ReactNode;
  /** A clickable row gets the pointer and the hover tint; without it the row is plain. */
  onClick?: MouseEventHandler<HTMLDivElement>;
}

/**
 * One line of a list of knowledge bases: the home view's list mode (`PrivateKbCard compact`) and the
 * admin's public KBs share it.
 *
 * It carries no legacy class. `.source-card`, `.source-title` and the other stacked-card rules are
 * UNLAYERED margins that defeat `items-center` inside a flex row, and a utility cannot override them
 * (Tailwind's utilities sit in `@layer utilities`; the repo gates on it in `scripts/check-css-cascade.mjs`),
 * so the row is built from tokens only. No fixed height: the tallest child plus `p-stack-md`, one value on
 * all four sides.
 */
export function KbListRow({ leading, name, trailing, onClick }: KbListRowProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-stack-md rounded-[var(--ui-radius-card)] border border-outline-variant bg-surface-container-lowest p-stack-md transition-colors',
        onClick && 'cursor-pointer hover:bg-secondary-container',
      )}
      role="presentation"
      onClick={onClick}
    >
      {leading}
      <div className="flex min-w-0 flex-1 items-center font-body-base text-body-base text-on-surface">{name}</div>
      <div className="flex shrink-0 items-center gap-stack-sm">{trailing}</div>
    </div>
  );
}
