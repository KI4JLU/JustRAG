import { useContext, useRef, useState } from 'react';
import {
    InlineCitationCard, InlineCitationCardBody, InlineCitationCardTrigger, cn,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { fillTemplate } from '../../utils/sourceDisplay';
import { CITED_BLOCK_SELECTOR, CitationChipContext, anchorRect, passageFor } from './citationChipContext';

type Placement = { alignOffset: number; sideOffset: number; width: number; focus: string };
import { SourcePreview } from './SourcePreview';

const chipActive = 'bg-primary text-on-primary';
const chipSuspect = 'bg-warning-container text-on-warning-container';

/**
 * An inline citation marker: the source's display number on a real button.
 * With a fine pointer it is the DS InlineCitation card — a click or Enter
 * opens the preview (hover does nothing), Esc closes and returns focus —
 * anchored under the chip's paragraph across the answer column, overlaying
 * what follows. On touch the chip opens the answer's bottom sheet instead.
 */
export function CitationChip({ n, raws, occ }: { n: number; raws: number[]; occ: number }) {
    const ctx = useContext(CitationChipContext);
    const { t } = useTheme();
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    // The card is anchored to the chip and shifted onto the chip's block: left
    // edge and width of the answer column, just under the paragraph. Measured
    // when it opens; the chip element is taken from its own events.
    const [placement, setPlacement] = useState<Placement | null>(null);
    const track = (e: { currentTarget: HTMLButtonElement }) => { triggerRef.current = e.currentTarget; };
    const handleOpenChange = (next: boolean) => {
        const chip = triggerRef.current;
        if (next && chip) {
            const block = chip.closest(CITED_BLOCK_SELECTOR);
            // The panel is already open: the chip moves it, no popover in between.
            if (ctx?.panelOpen && ctx.onOpenPanel && source) {
                ctx.onOpenPanel(n, raw, block?.textContent ?? undefined, occ);
                return;
            }
            const c = chip.getBoundingClientRect();
            const a = anchorRect(chip);
            setPlacement({ alignOffset: a.left - c.left, sideOffset: a.bottom - c.bottom + 8, width: a.width, focus: block?.textContent ?? '' });
        }
        setOpen(next);
    };

    const source = ctx?.model.cited[n - 1];
    if (!ctx || !source) return null;
    const { raw, index } = passageFor(source, raws.find(r => source.rawNumbers.includes(r)) ?? source.rawNumbers[0]);
    const passage = source.passages[index];
    const label = fillTemplate(t('citationChipLabel'), { n, title: source.title });
    const filled = ctx.activeN === n;
    const reason = raws.map(r => ctx.suspect?.get(r)).find(Boolean);
    const suspect = !!reason;
    const notice = reason ? t(reason === 'out_of_range' ? 'citationSuspectOutOfRange' : 'citationSuspectNoOverlap') : undefined;
    const dataProps = { 'data-n': n, 'data-raw': raws.join(','), 'data-occ': occ };

    if (!ctx.finePointer) {
        const sheetOpen = ctx.sheetOcc === occ;
        return (
            // eslint-disable-next-line design-system/no-raw-ui-elements -- the DS chip (InlineCitationCardTrigger) exists only inside its Popover; on touch the same chip opens the answer's Drawer
            <button
                type="button"
                {...dataProps}
                className={cn(
                    // align-[2px]: centred on the capitals beside it, like the DS chip (InlineCitationCardTrigger).
                    'citation-chip ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 align-[2px] text-[11px] leading-none font-semibold',
                    'relative before:absolute before:-inset-3 before:content-[""]',
                    sheetOpen || filled ? chipActive : suspect ? chipSuspect : 'bg-primary-fixed text-on-primary-fixed-variant',
                )}
                aria-label={label}
                aria-haspopup="dialog"
                aria-expanded={sheetOpen}
                onClick={() => ctx.openSheet({ n, raw, occ })}
            >
                {n}
            </button>
        );
    }

    const close = () => setOpen(false);
    return (
        <InlineCitationCard open={open} onOpenChange={handleOpenChange} openOnHover={false}>
            <InlineCitationCardTrigger
                onPointerEnter={track}
                onFocus={track}
                onClick={track}
                {...dataProps}
                className={cn('citation-chip', filled ? chipActive : suspect && cn(chipSuspect, 'data-[state=open]:bg-primary data-[state=open]:text-on-primary'))}
                aria-label={label}
            >
                {n}
            </InlineCitationCardTrigger>
            <InlineCitationCardBody
                side="bottom"
                align="start"
                alignOffset={placement?.alignOffset ?? 0}
                sideOffset={placement?.sideOffset ?? 8}
                collisionPadding={16}
                aria-label={label}
                className="max-w-[calc(100vw-2rem)] rounded-[var(--ui-radius-box)] px-4 pt-3 pb-3"
                style={placement ? { width: placement.width } : undefined}
            >
                <SourcePreview
                    source={source}
                    passage={passage}
                    span={ctx.spans?.get(raw)}
                    focus={placement?.focus}
                    notice={notice}
                    totalSources={ctx.model.cited.length}
                    onShowAll={ctx.onShowAll ? () => { close(); ctx.onShowAll?.(); } : undefined}
                    onOpenSource={ctx.onOpenPanel ? () => { close(); ctx.onOpenPanel?.(n, raw, placement?.focus, occ); } : undefined}
                />
            </InlineCitationCardBody>
        </InlineCitationCard>
    );
}
