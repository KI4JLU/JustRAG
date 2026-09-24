import type { ReactNode } from 'react';
import { SidebarPanel, useSidebarCollapsed } from '@ki4jlu/design-system';

/**
 * The home pages' navigation column on the same DS `SidebarPanel` frame as
 * every other side column (KB history, sources, settings sections): shared
 * insets, list scrolling with the gutter and edge fade.
 *
 * Collapsed to the 60px rail the rows render bare: `NavItem`s shrink to their
 * icon-only form there, and the panel's insets would not fit the rail.
 */
export function SidebarNav({ children }: { children: ReactNode }) {
    const collapsed = useSidebarCollapsed();
    if (collapsed) return <>{children}</>;
    return (
        <SidebarPanel>
            <div className="flex flex-col gap-2">{children}</div>
        </SidebarPanel>
    );
}
