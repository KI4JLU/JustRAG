import { useEffect, useRef } from 'react';
import { useSettingsSearch } from '@ki4jlu/design-system';

/**
 * True while the settings window's search filters and names one of `labels` (case-insensitive,
 * the query anywhere in the label — the DS search's own rule). For settings a section does not
 * render until asked: an editor behind „Bearbeiten", a sub-screen, a hidden column.
 */
export function useSearchMatches(labels: readonly string[]): boolean {
    const { query, filtering } = useSettingsSearch();
    return filtering && labels.some((l) => l.toLocaleLowerCase().includes(query));
}

/**
 * Opens a part of a section for the settings search and closes it again afterwards. `target` names
 * what to open (null: nothing) — a part with one shape passes `'on'`, a form that can open on
 * different records names the one the query points at. The part opens when a target appears and
 * nothing is open; it follows a changed target while the search still owns it and `canSwitch`
 * allows; it closes when the target goes — but only what the search opened: a part the user had
 * open is left alone. The callbacks are read when the target changes, not on every render.
 */
export function useSearchReveal(
    target: string | null,
    isOpen: boolean,
    open: (target: string) => void,
    close: () => void,
    canSwitch: () => boolean = () => true,
): void {
    const owned = useRef<string | null>(null);
    const latest = useRef({ isOpen, open, close, canSwitch });
    useEffect(() => {
        latest.current = { isOpen, open, close, canSwitch };
    });
    useEffect(() => {
        const l = latest.current;
        if (target !== null) {
            if (owned.current === null ? !l.isOpen : owned.current !== target && l.canSwitch()) {
                owned.current = target;
                l.open(target);
            }
        } else if (owned.current !== null) {
            owned.current = null;
            l.close();
        }
    }, [target]);
}

/**
 * `useSearchReveal` for an add/edit form: the form the search opened follows the query to another
 * record and closes again only while nothing in it was changed — typed input is never thrown away
 * by a search.
 */
export function useSearchRevealForm<T>(
    target: string | null,
    showForm: boolean,
    formData: T,
    open: (target: string) => void,
    close: () => void,
): void {
    // The form as the search opened it, taken on the render after `open` filled it.
    const atOpen = useRef<string | null>(null);
    const pending = useRef(false);
    useEffect(() => {
        if (pending.current) {
            pending.current = false;
            atOpen.current = JSON.stringify(formData);
        }
    });
    const unchanged = () => atOpen.current !== null && JSON.stringify(formData) === atOpen.current;
    useSearchReveal(
        target,
        showForm,
        (t) => { pending.current = true; open(t); },
        () => { if (unchanged()) close(); atOpen.current = null; },
        unchanged,
    );
}

