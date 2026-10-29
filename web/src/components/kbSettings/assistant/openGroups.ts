import { useState } from 'react';

const GROUPS_PREF = 'kbSettings.behavior.openGroups';

function readOpen(): Record<string, boolean> {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(GROUPS_PREF) ?? '{}');
        return parsed && typeof parsed === 'object' ? parsed as Record<string, boolean> : {};
    } catch {
        return {};
    }
}

/**
 * The open items of a `type="multiple"` Accordion, kept per browser and item:
 * an item never toggled is open when `defaults` lists it.
 */
export function useOpenGroups(ids: string[], defaults: string[]): [string[], (open: string[]) => void] {
    const [open, setOpenState] = useState(() => {
        const stored = readOpen();
        return ids.filter(id => stored[id] ?? defaults.includes(id));
    });
    const setOpen = (next: string[]) => {
        setOpenState(next);
        try {
            localStorage.setItem(GROUPS_PREF, JSON.stringify({ ...readOpen(), ...Object.fromEntries(ids.map(id => [id, next.includes(id)])) }));
        } catch {
            /* per-viewer convenience only */
        }
    };
    return [open, setOpen];
}
