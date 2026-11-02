import { useEffect, useState } from 'react';
import type { KbCategory } from '../types';
import {
    fetchBehavior, fetchBehaviorCatalog, fetchCategoryCatalog, fetchKbCategory, fetchStartPage, type StartPage,
} from '../components/kbSettings/assistant/api';
import { allRoles, type RoleView } from '../components/kbSettings/assistant/roleModel';

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
 * settings dialog closes (`revision`). Null while loading or on failure — the
 * start page then looks as it did before these settings existed.
 */
export function useKbStartPage(kbId: string | undefined, revision: unknown): KbStartPageData | null {
    const [data, setData] = useState<KbStartPageData | null>(null);
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
                const catalog = await fetchBehaviorCatalog(behavior.language);
                if (cancelled) return;
                setData({
                    kbId,
                    page: start.startPage,
                    configured: start.configured,
                    roles: allRoles(catalog, behavior.behavior),
                    activeRoleId: behavior.behavior.activeRoleId,
                    category: categories.find(c => c.id === categoryId) ?? null,
                });
            } catch {
                if (!cancelled) setData(null);
            }
        })();
        return () => { cancelled = true; };
    }, [kbId, revision]);
    return data && data.kbId === kbId ? data : null;
}
