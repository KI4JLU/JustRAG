import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, EyeOff } from 'lucide-react';
import { Button, TabsList, TabsTrigger, cn } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';

export interface SheetTab {
    value: string;
    label: string;
    /** Non-empty rows; omitted until known. */
    count?: number;
    /** A sheet hidden in the workbook, shown on request: rendered dimmed. */
    hidden?: boolean;
}

interface SheetTabsProps {
    tabs: SheetTab[];
    active: string;
    /** Extra control after the tabs (the hidden-sheets toggle). */
    end?: React.ReactNode;
    /** Row actions at the far right (download, fullscreen). */
    actions?: React.ReactNode;
    /** Leads the row, before the tabs (the preview's back link). */
    start?: React.ReactNode;
}

/**
 * The sheet strip: every sheet in ONE row (DS `TabsList`, underline variant;
 * render inside the dialog's `Tabs`). No scrollbar and no wheel scrolling —
 * the container clips both axes (`overflow-hidden`) and pages with two arrow buttons that
 * only appear when the tabs overflow (disabled at either end), each step 70 %
 * of the visible width. The overflowing side fades out via `mask-image`, and
 * the active tab is kept in view, also when it changes by keyboard inside the
 * tablist. Overflow state follows a ResizeObserver plus the scroll position.
 */
export const SheetTabs: React.FC<SheetTabsProps> = ({ tabs, active, end, actions, start }) => {
    const { t } = useTheme();
    const ref = useRef<HTMLDivElement>(null);
    const [edge, setEdge] = useState({ left: false, right: false });

    const update = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        setEdge({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
    }, []);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        update();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(update);
        ro.observe(el);
        if (el.firstElementChild) ro.observe(el.firstElementChild);
        return () => ro.disconnect();
    }, [update, tabs.length]);

    useEffect(() => {
        const tab = ref.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
        tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }, [active]);

    const page = (dir: -1 | 1) => {
        const el = ref.current;
        if (!el) return;
        el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: 'smooth' });
    };

    const overflow = edge.left || edge.right;

    return (
        // The DS `enclosed` sheet tabs on the dialog's own surface, with the
        // divider continued under the arrows and actions (same inset line).
        // Every control here is exactly a tab's height (h-8), bottom-aligned.
        // The last action ends on the dialog's close button edge (DS Dialog `--dialog-close-inset`).
        <div className="flex shrink-0 items-end gap-1 pl-2 pr-[var(--dialog-close-inset,0.5rem)] shadow-[inset_0_-1px_0_var(--color-outline-variant)]">
            {start && <div className="flex h-8 shrink-0 items-center">{start}</div>}
            {overflow && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 disabled:opacity-30"
                    aria-label={t('tpPrevSheets')}
                    disabled={!edge.left}
                    onClick={() => page(-1)}
                >
                    <ChevronLeft className="size-4" aria-hidden="true" />
                </Button>
            )}
            <div
                ref={ref}
                onScroll={update}
                className={cn(
                    // Both axes clipped: with only overflow-x hidden, CSS makes the
                    // y axis `auto` and the strip could scroll vertically.
                    'min-w-0 flex-1 overflow-hidden',
                    edge.left && edge.right && '[mask-image:linear-gradient(to_right,transparent,black_2rem,black_calc(100%-2rem),transparent)]',
                    edge.left && !edge.right && '[mask-image:linear-gradient(to_right,transparent,black_2rem)]',
                    !edge.left && edge.right && '[mask-image:linear-gradient(to_left,transparent,black_2rem)]',
                )}
            >
                <TabsList variant="enclosed" aria-label={t('tpSheets')} className="w-max">
                    {tabs.map(tab => (
                        <TabsTrigger key={tab.value} value={tab.value} className={cn('group', tab.hidden && 'opacity-70')}>
                            {tab.hidden && <EyeOff className="size-3.5" aria-hidden="true" />}
                            {tab.label}
                            {tab.count !== undefined && (
                                <span className="rounded-full bg-surface-dim px-1.5 text-[11px] tabular-nums text-on-surface-variant group-data-[state=active]:bg-surface-container-lowest group-data-[state=active]:text-on-surface">
                                    {tab.count}
                                </span>
                            )}
                        </TabsTrigger>
                    ))}
                </TabsList>
            </div>
            {overflow && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 disabled:opacity-30"
                    aria-label={t('tpNextSheets')}
                    disabled={!edge.right}
                    onClick={() => page(1)}
                >
                    <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
            )}
            {end && <div className="flex h-8 shrink-0 items-center">{end}</div>}
            {actions && (
                <>
                    <span aria-hidden="true" className="mx-1 mb-1.5 h-5 w-px shrink-0 bg-outline-variant" />
                    <div className="flex h-8 shrink-0 items-center gap-1">{actions}</div>
                </>
            )}
        </div>
    );
};
