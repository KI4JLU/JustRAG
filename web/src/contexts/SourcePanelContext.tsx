import { createContext, useContext } from 'react';
import type { CitedSource } from '../utils/sourceDisplay';

/** What the source panel shows: one cited file of one answer, at one passage. */
export interface SourcePanelTarget {
    /** The answer's section key (messageSectionKey). */
    messageKey: string;
    source: CitedSource;
    /** Index into source.passages. */
    passage: number;
    /** Verified citation spans of the answer, by raw citation number. */
    spans?: Map<number, { start: number; end: number }>;
    /** The answer text citing each raw number: marks the matching sentence where no span exists. */
    citing?: Map<number, string>;
    /** The statement whose chip opened the panel: marks the active passage. */
    focus?: string;
}

export interface SourcePanelApi {
    target: SourcePanelTarget | null;
    open: (target: SourcePanelTarget) => void;
    close: () => void;
}

/** Provided by the chat view; absent elsewhere (comparison view), where sources open the document instead. */
export const SourcePanelContext = createContext<SourcePanelApi | null>(null);

export function useSourcePanel(): SourcePanelApi | null {
    return useContext(SourcePanelContext);
}
