import type { KnowledgeBase } from '../types';

/* ---------------------------------------------------------------------------
 * The three-way visibility split, in its own module.
 *
 * IT LIVES HERE AND NOT IN `KbCard.tsx` because two things read it now — the
 * card's badge and „Mein Wissen"'s „Persönlich" / „Geteilt" filter chips — and
 * because exporting a non-component from a component file breaks fast refresh
 * (`react-refresh/only-export-components`, which is an ERROR in this repo).
 * Same reason the design system keeps its `*-variants.ts` files separate.
 *
 * ONE PREDICATE, deliberately: a chip that disagreed with the badge on the card
 * beneath it would be the obvious bug, and two copies of this branch is how
 * that happens.
 * ------------------------------------------------------------------------- */

export type VisibilityState = 'public' | 'shared' | 'personal';

/* Exported since the „Persönlich" / „Geteilt" filter chips key off the same
   three-way split the badge shows. One predicate: a chip that disagreed with
   the badge on the card beneath it would be the obvious bug. */
export function visibilityState(kb: KnowledgeBase): VisibilityState {
  if (kb.visibility === 'public') return 'public';
  return (kb.memberCount ?? 1) > 1 ? 'shared' : 'personal';
}
