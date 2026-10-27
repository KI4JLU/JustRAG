import { createContext } from 'react';
import type { CitationModel, CitedSource } from '../../utils/sourceDisplay';

/** What the inline chips of one answer share, provided by MessageContent. */
export interface CitationChipContextValue {
    model: CitationModel;
    spans?: Map<number, { start: number; end: number }>;
    /** Raw citation numbers the validator could not back up, with its reason: amber, no icon. */
    suspect?: ReadonlyMap<number, 'out_of_range' | 'no_overlap'>;
    /** The display number the source panel shows, if this answer's: its chips stay filled. */
    activeN: number | null;
    /** Hover popover (mouse, trackpad) or bottom sheet (touch). */
    finePointer: boolean;
    /** "In Quelle öffnen" — and, while the panel is open, a click on a chip. */
    onOpenPanel?: (n: number, raw: number, focus?: string, occ?: number) => void;
    /** The source panel is open (for any answer): a chip click goes straight to it, no popover. */
    panelOpen: boolean;
    /** "Alle N Quellen". */
    onShowAll?: () => void;
    /** Touch: opens the sheet for this chip. */
    openSheet: (sheet: ChipSheet) => void;
    sheetOcc: number | null;
}

export interface ChipSheet {
    n: number;
    raw: number;
    occ: number;
}

export const CitationChipContext = createContext<CitationChipContextValue | null>(null);

/** The block a chip sits in: the preview opens under it, over the answer column's width. */
export const CITED_BLOCK_SELECTOR = 'p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, dd';

export function anchorRect(el: HTMLElement | null) {
    const zero = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    if (!el) return { ...zero, toJSON: () => zero };
    const block = el.closest(CITED_BLOCK_SELECTOR) ?? el;
    const column = el.closest('.markdown-content') ?? block;
    const b = block.getBoundingClientRect();
    const c = column.getBoundingClientRect();
    const r = { x: c.left, y: b.top, top: b.top, left: c.left, right: c.right, bottom: b.bottom, width: c.width, height: b.height };
    return { ...r, toJSON: () => r };
}

/** The cited passage a chip points at: the first of its raw numbers this file has. */
export function passageFor(source: CitedSource, raw: number): { raw: number; index: number } {
    const index = source.rawNumbers.indexOf(raw);
    return index >= 0 ? { raw, index } : { raw: source.rawNumbers[0], index: 0 };
}

