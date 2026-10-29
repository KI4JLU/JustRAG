/*
 * Proposed design-system pattern (selectable card): a card the user picks, with
 * a border + tint for the picked state and room for a sibling action menu.
 * The DS has no selectable card yet; the role cards and the Chat-Start options
 * share these classes until it does.
 */
export const selectableCardBase =
    'flex h-full w-full cursor-pointer gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

export function selectableCardState(selected: boolean): string {
    return selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-outline-variant hover:border-primary';
}
