import type React from 'react';

/**
 * TRUE when a click inside a card landed on one of its own controls (title
 * button, checkbox, menu trigger — or a portaled menu item, whose React event
 * still bubbles to the card). Those handle themselves; the card's whole-plane
 * click is only for the rest of the surface.
 */
export const isCardControlClick = (e: React.MouseEvent) =>
    (e.target as HTMLElement).closest('button, a, input, [role="checkbox"], [role="menu"], [role="menuitem"]') !== null;
