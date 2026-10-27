import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A tab's actions, rendered in the admin dialog's footer (`slot`, the element
 * AdminUI puts there) as dialog actions are everywhere else; without a slot
 * (a tab shown on its own) they sit under the form.
 */
export function FooterActions({ slot, children }: { slot?: HTMLElement | null; children: ReactNode }) {
    return slot
        ? createPortal(children, slot)
        : <div className="flex flex-col-reverse gap-2 border-t border-outline-variant pt-4 sm:flex-row sm:justify-end">{children}</div>;
}
