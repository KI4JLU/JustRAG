import type { KbCategory } from '../types';
import { categoryDotColor } from './kbSettings/assistant/startPageModel';

/*
 * A catalog category as the app shows it everywhere — the topic's title card,
 * its category picker, the „Entdecken" cards, the home cards and the admin's
 * category list: a dot in the category's palette colour, and the name.
 */

export function CategoryDot({ category }: { category: Pick<KbCategory, 'colorSlot'> | null | undefined }) {
    return <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: categoryDotColor(category) }} />;
}

/** The category as a small pill. */
export function CategoryPill({ category }: { category: KbCategory }) {
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container-lowest px-2 py-0.5 font-medium text-on-surface">
            <CategoryDot category={category} /> {category.name}
        </span>
    );
}
