import { cn } from '@ki4jlu/design-system';
import type { KbCategory } from '../types';
import { categoryDotColor } from './kbSettings/assistant/startPageModel';

/*
 * A catalog category as the app shows it everywhere — the topic's title card,
 * its category picker, the „Entdecken" cards, the home cards and the admin's
 * category list: a dot in the category's palette colour, and the name.
 */

export function CategoryDot({ category }: { category: Pick<KbCategory, 'colorSlot' | 'color'> | null | undefined }) {
    return <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: categoryDotColor(category) }} />;
}

/**
 * The category as a small pill. `small`: 12px semibold (a list row's line
 * under the name). `onHairline`: small too, on a hairline card's rule (DS
 * `CardHairline`), outlined in the card's colour.
 */
export function CategoryPill({ category, small = false, onHairline = false }: { category: KbCategory; small?: boolean; onHairline?: boolean }) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full border bg-surface-container-lowest px-2 py-0.5 text-on-surface',
                small || onHairline ? 'text-xs font-semibold' : 'font-medium',
                onHairline ? 'border-[var(--card-accent,var(--color-outline-variant))]' : 'border-outline-variant',
            )}
        >
            <CategoryDot category={category} /> {category.name}
        </span>
    );
}
