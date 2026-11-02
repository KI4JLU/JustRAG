import { useCallback, useState } from 'react';

/**
 * The composer's notch: in one-line mode the text sits between the two
 * control groups, which float over the bottom corners of the frame, so the
 * textarea reserves their measured width (+ edge offset and a gap). Measured,
 * not hard-coded — the right group changes with the agent chip, the reasoning
 * toggle and the source count. Once the text wraps, the textarea moves above
 * the controls instead. Shared by the chat composer and its preview in the
 * topic settings (Startseite), so both lay out the same.
 */
export function useComposerNotch() {
    const [notch, setNotch] = useState({ left: 0, right: 0 });
    const observeNotch = useCallback((side: 'left' | 'right') => (el: HTMLDivElement | null) => {
        if (!el) return;
        const apply = () => setNotch(n => {
            const w = Math.ceil(el.getBoundingClientRect().width) + 12 + 8;
            return n[side] === w ? n : { ...n, [side]: w };
        });
        apply();
        // Deferred to the next frame: reacting synchronously inside the observer
        // callback re-lays out the frame in the same tick and trips
        // "ResizeObserver loop completed with undelivered notifications".
        let frame = 0;
        const ro = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(apply);
        });
        ro.observe(el);
        return () => { cancelAnimationFrame(frame); ro.disconnect(); };
    }, []);
    return { notch, observeNotch };
}
