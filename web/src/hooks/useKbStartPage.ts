import { useEffect, useState } from 'react';
import type { KbCategory } from '../types';
import {
    fetchBehavior, fetchBehaviorCatalog, fetchCategoryCatalog, fetchKbCategory, fetchStartPage, type StartPage,
} from '../components/kbSettings/assistant/api';
import { allRoles, type RoleView } from '../components/kbSettings/assistant/roleModel';
import { useTheme } from '../contexts/ThemeContext';

export interface KbStartPageData {
    kbId: string;
    page: StartPage;
    /** False while the KB shows the default start page (the pre-settings one). */
    configured: boolean;
    roles: RoleView[];
    activeRoleId: string;
    category: KbCategory | null;
}

/**
 * What the chat start page shows from the assistant settings (Startseite +
 * the roles of Verhalten): read when the KB opens and again whenever the
 * settings dialog closes (`revision`). `startPage` is null while loading and on
 * failure; `loading` tells the two apart, so the chat can hold back what a
 * set-up page would replace, and fall back to the default start page once the
 * read has failed. A re-read keeps the page shown until its answer is in.
 *
 * The template roles (system texts, translated in „Vorlagen") show in the
 * member's own language; the KB's own roles as their admin wrote them.
 */
export function useKbStartPage(kbId: string | undefined, revision: unknown): { startPage: KbStartPageData | null; loading: boolean } {
    const { language } = useTheme();
    // The last answer and the KB it is for: null data = that KB's read failed.
    const [result, setResult] = useState<{ kbId: string; data: KbStartPageData | null } | null>(null);
    useEffect(() => {
        if (!kbId) return;
        let cancelled = false;
        (async () => {
            try {
                const [start, behavior, categoryId, categories] = await Promise.all([
                    fetchStartPage(kbId),
                    fetchBehavior(kbId),
                    fetchKbCategory(kbId).catch(() => null),
                    fetchCategoryCatalog().catch(() => [] as KbCategory[]),
                ]);
                const catalog = await fetchBehaviorCatalog(language);
                if (cancelled) return;
                setResult({
                    kbId,
                    data: {
                        kbId,
                        page: start.startPage,
                        configured: start.configured,
                        roles: allRoles(catalog, behavior.behavior),
                        activeRoleId: behavior.behavior.activeRoleId,
                        category: categories.find(c => c.id === categoryId) ?? null,
                    },
                });
            } catch {
                if (!cancelled) setResult({ kbId, data: null });
            }
        })();
        return () => { cancelled = true; };
    }, [kbId, revision, language]);
    const settled = !!kbId && result?.kbId === kbId;
    return { startPage: settled ? result.data : null, loading: !!kbId && !settled };
}
