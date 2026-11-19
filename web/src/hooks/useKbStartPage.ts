import { useEffect, useMemo, useState } from 'react';
import type { KbCategory } from '../types';
import {
    fetchBehavior, fetchBehaviorCatalog, fetchCategoryCatalog, fetchKbCategory, fetchStartPage, type StartPage,
} from '../components/kbSettings/assistant/api';
import { allRoles, type RoleView } from '../components/kbSettings/assistant/roleModel';
import { MAX_SKELETON_CARDS, activeTaskStart, pageMode, startEntries } from '../components/kbSettings/assistant/startPageModel';
import { useAuth } from '../contexts/AuthContext';
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
 * The last answer per KB is kept for this page load: a topic opened again
 * shows its start page at once (`loading` false) and takes the fresh answer
 * when it is in; a failed read drops it. A read that does not answer within
 * a few seconds stops counting as `loading`. `shape` is how the
 * page starts — while it loads, how it started on the last visit (null if
 * never seen), for the skeleton.
 *
 * The template roles (system texts, translated in „Vorlagen") show in the
 * member's own language; the KB's own roles as their admin wrote them.
 */
const known = new Map<string, KbStartPageData>();
const KNOWN_KEPT = 50;
/** How long a read may hold the start page (ms); after that the page shows without it, and a late answer still lands. */
const HOLD_LIMIT_MS = 8000;

/**
 * How a KB's start page starts, as far as a skeleton must know: the input
 * field, `cards` role cards, the one wide role-prompt card or the upload area.
 */
export interface StartShape {
    kind: 'input' | 'cards' | 'prompt' | 'upload';
    cards: number;
}

export function startShapeOf(data: Pick<KbStartPageData, 'page' | 'activeRoleId' | 'roles'>): StartShape {
    const mode = pageMode(data.page, data.activeRoleId, data.roles);
    if (mode === 'upload') return { kind: 'upload', cards: 0 };
    if (mode === 'task') return { kind: activeTaskStart(data.page, data.activeRoleId, data.roles) ? 'prompt' : 'input', cards: 0 };
    if (mode !== 'roles') return { kind: 'input', cards: 0 };
    const entries = startEntries(data.page, data.activeRoleId, data.roles);
    const [only] = entries;
    if (entries.length === 1 && only.kind === 'task' && only.text.trim()) return { kind: 'prompt', cards: 1 };
    return { kind: 'cards', cards: entries.length };
}

/*
 * The shapes seen last, kept in the browser: the next visit's skeleton then
 * has the shape of the page that will load. Storage may be missing or full —
 * the skeleton falls back to the input start's shape.
 */
const SHAPES_KEY = 'justrag.startShapes';
const SHAPES_KEPT = 200;
const KINDS: readonly string[] = ['input', 'cards', 'prompt', 'upload'];
let shapes: Record<string, StartShape> | null = null;
/** What the browser kept, read as untrusted: only well-formed shapes survive. */
function readShapes(): Record<string, StartShape> {
    if (shapes) return shapes;
    const read: Record<string, StartShape> = {};
    try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(SHAPES_KEY) ?? '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            for (const [kbId, raw] of Object.entries(parsed as Record<string, unknown>).slice(-SHAPES_KEPT)) {
                const shape = raw as Partial<StartShape> | null;
                if (!shape || typeof shape !== 'object' || typeof shape.kind !== 'string' || !KINDS.includes(shape.kind)) continue;
                const cards = Number.isInteger(shape.cards) ? Math.min(Math.max(shape.cards as number, 0), MAX_SKELETON_CARDS) : 0;
                read[kbId] = { kind: shape.kind, cards };
            }
        }
    } catch {
        // Unreadable: nothing kept.
    }
    shapes = read;
    return shapes;
}
function rememberShape(kbId: string, shape: StartShape): void {
    const all = readShapes();
    if (all[kbId]?.kind === shape.kind && all[kbId]?.cards === shape.cards) return;
    // Re-added last, so the least recently opened topics are the ones dropped.
    delete all[kbId];
    all[kbId] = shape;
    const ids = Object.keys(all);
    for (const id of ids.slice(0, Math.max(0, ids.length - SHAPES_KEPT))) delete all[id];
    try {
        window.localStorage.setItem(SHAPES_KEY, JSON.stringify(all));
    } catch {
        // Not kept: the next visit shows the input start's skeleton.
    }
}

/** Forgets the kept start pages (tests). */
export function forgetKbStartPages(): void {
    known.clear();
    shapes = null;
}

export function useKbStartPage(kbId: string | undefined, revision: unknown): { startPage: KbStartPageData | null; loading: boolean; shape: StartShape | null } {
    const { language } = useTheme();
    const { user } = useAuth();
    // Per signed-in user, KB and language: nothing kept shows for another of these.
    const scope = `${user?.id ?? ''}|${kbId ?? ''}|`;
    const key = kbId ? `${scope}${language}` : null;
    // The last answer and what it is for: null data = that read failed.
    const [result, setResult] = useState<{ key: string; data: KbStartPageData | null } | null>(null);
    useEffect(() => {
        if (!kbId || !key) return;
        let cancelled = false;
        // A read that never answers must not hold the page for good.
        const giveUp = setTimeout(() => {
            if (!cancelled) setResult(prev => (prev?.key === key ? prev : { key, data: known.get(key) ?? null }));
        }, HOLD_LIMIT_MS);
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
                clearTimeout(giveUp);
                const data: KbStartPageData = {
                    kbId,
                    page: start.startPage,
                    configured: start.configured,
                    roles: allRoles(catalog, behavior.behavior),
                    activeRoleId: behavior.behavior.activeRoleId,
                    category: categories.find(c => c.id === categoryId) ?? null,
                };
                // This KB's pages kept in other languages may predate a save: forget them.
                for (const k of [...known.keys()]) if (k.startsWith(scope)) known.delete(k);
                known.set(key, data);
                for (const k of [...known.keys()].slice(0, Math.max(0, known.size - KNOWN_KEPT))) known.delete(k);
                rememberShape(kbId, startShapeOf(data));
                setResult({ key, data });
            } catch {
                if (cancelled) return;
                clearTimeout(giveUp);
                // Not readable (any more): nothing kept is shown in its place.
                known.delete(key);
                setResult({ key, data: null });
            }
        })();
        return () => {
            cancelled = true;
            clearTimeout(giveUp);
        };
    }, [kbId, key, scope, revision, language]);
    const settled = !!key && result?.key === key;
    const kept = key ? known.get(key) ?? null : null;
    const startPage = settled ? result.data : kept;
    // The loaded page's shape, else the one seen on the last visit.
    const shape = useMemo(() => {
        if (startPage) return startShapeOf(startPage);
        return (kbId && Object.hasOwn(readShapes(), kbId) ? readShapes()[kbId] : null) ?? null;
    }, [startPage, kbId]);
    return { startPage, loading: !!key && !settled && !kept, shape };
}
