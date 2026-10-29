import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import type { KbCategory, KnowledgeBase } from '../../../types';
import {
    ROLE_ENTRY_MAX, fetchAssistantSettings, fetchBehaviorCatalog, fetchCategoryCatalog, resetBehavior, saveAssistantSettings,
    type AssistantSettingsResponse, type Behavior, type BehaviorCatalog, type StartPage,
} from './api';
import { newId } from './roleModel';

/**
 * The one settings object behind „Startseite" and „Verhalten": both sections
 * read and edit this draft, so a role deleted in Verhalten takes its role
 * cards along, and a role offered as a starter in Verhalten lands on the
 * Startseite. Saved with the dialog's Speichern in ONE request
 * (PUT /api/kb/{id}/assistant-settings), which writes one version for the
 * Versionsverlauf.
 */
export interface AssistantDraft {
    behavior: Behavior;
    startPage: StartPage;
    /** The KB's name: editing it is a rename (canRename). */
    title: string;
    /** The own description; null = the automatic one. */
    description: string | null;
    categoryId: string | null;
}

/** Actions one section hands to the other (cross-links). */
export type AssistantAction =
    | { type: 'addEntry'; roleId: string }
    | { type: 'previewRole'; roleId: string };

/**
 * What the opened section starts with: the Startseite on the „Nur über
 * Rolle" editor (a card added for `entryId`; `switched` when the mode was
 * changed for it), or Verhalten on a role's preview.
 */
export type AssistantPending =
    | { type: 'startRoles'; entryId: string | null; switched: boolean }
    | { type: 'previewRole'; roleId: string };

export type AssistantSection = 'start' | 'behavior';

/** Why the last save failed: the settings changed meanwhile, or anything else. */
export type SaveError = 'conflict' | 'failed' | null;

export interface AssistantSettings {
    status: 'loading' | 'ready' | 'error';
    kb: KnowledgeBase;
    canRename: boolean;
    catalog: BehaviorCatalog | null;
    categories: KbCategory[];
    draft: AssistantDraft | null;
    saved: AssistantDraft | null;
    /** The newest version number; 0 before the first save. */
    version: number;
    dirty: boolean;
    saveError: SaveError;
    /** A save was refused as incomplete: the sections now show what is missing. */
    showErrors: boolean;
    revealErrors: () => void;
    update: (patch: Partial<AssistantDraft>) => void;
    updateBehavior: (fn: (b: Behavior) => Behavior) => void;
    updateStartPage: (fn: (p: StartPage) => StartPage) => void;
    /** Removes a role and, in the same draft, its rules, its start and the role cards that start it. */
    deleteRole: (roleId: string) => void;
    /** Back to the saved state. */
    discard: () => void;
    /** Writes the draft; resolves false when it failed (see saveError). */
    save: () => Promise<boolean>;
    /** „Löschen": no role and no rule (DELETE behavior). */
    resetBehavior: () => Promise<boolean>;
    /** Takes a state the server returned (a restored version) as saved. */
    applyServer: (s: AssistantSettingsResponse) => void;
    /** Takes a saved or restored state and brings the app's KB lists in step. */
    applySaved: (s: AssistantSettingsResponse) => void;
    pending: AssistantPending | null;
    /** Hands an action to the other section and opens it. */
    send: (section: AssistantSection, action?: AssistantAction) => void;
    clearPending: () => void;
    retry: () => void;
}

const draftKey = (d: AssistantDraft | null) => (d ? JSON.stringify(d) : '');

function draftOf(s: AssistantSettingsResponse): AssistantDraft {
    return {
        behavior: s.behavior.behavior,
        startPage: s.startPage,
        title: s.title,
        description: s.description,
        categoryId: s.categoryId,
    };
}

interface Options {
    kb: KnowledgeBase;
    /** PATCH /api/kb/{id} through the app's KB store: keeps the KB lists in step after a save. */
    onUpdateKb: (update: Record<string, unknown>) => Promise<boolean>;
    /** Opens a section of the dialog. */
    onOpenSection: (section: AssistantSection) => void;
}

export function useAssistantSettingsStore({ kb, onUpdateKb, onOpenSection }: Options): AssistantSettings {
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [catalog, setCatalog] = useState<BehaviorCatalog | null>(null);
    const [categories, setCategories] = useState<KbCategory[]>([]);
    const [draft, setDraft] = useState<AssistantDraft | null>(null);
    const [saved, setSaved] = useState<AssistantDraft | null>(null);
    const [version, setVersion] = useState(0);
    const [canRename, setCanRename] = useState(false);
    const [saveError, setSaveError] = useState<SaveError>(null);
    const [showErrors, setShowErrors] = useState(false);
    const [pending, setPending] = useState<AssistantPending | null>(null);
    const [attempt, setAttempt] = useState(0);

    const applyServer = useCallback((s: AssistantSettingsResponse) => {
        const loaded = draftOf(s);
        setDraft(loaded);
        setSaved(loaded);
        setVersion(s.version);
        setCanRename(s.canRename);
        setSaveError(null);
        setShowErrors(false);
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [settings, cats] = await Promise.all([
                    fetchAssistantSettings(kb.id),
                    fetchCategoryCatalog().catch(() => [] as KbCategory[]),
                ]);
                // The catalog in the language the KB's prompt is compiled in, so
                // the Vorschau shows the text the model gets.
                const cat = await fetchBehaviorCatalog(settings.behavior.language);
                if (cancelled) return;
                setCatalog(cat);
                setCategories(cats);
                applyServer(settings);
                setStatus('ready');
            } catch {
                if (!cancelled) setStatus('error');
            }
        })();
        return () => { cancelled = true; };
    }, [kb.id, attempt, applyServer]);

    const dirty = draftKey(draft) !== draftKey(saved);

    const update = useCallback((patch: Partial<AssistantDraft>) => setDraft(d => (d ? { ...d, ...patch } : d)), []);
    const updateBehavior = useCallback((fn: (b: Behavior) => Behavior) => setDraft(d => (d ? { ...d, behavior: fn(d.behavior) } : d)), []);
    const updateStartPage = useCallback((fn: (p: StartPage) => StartPage) => setDraft(d => (d ? { ...d, startPage: fn(d.startPage) } : d)), []);
    const deleteRole = useCallback((roleId: string) => setDraft(d => {
        if (!d) return d;
        const defaultRole = catalog?.roles.find(r => r.isDefault)?.id ?? 'research';
        const activeRoleId = d.behavior.activeRoleId === roleId ? defaultRole : d.behavior.activeRoleId;
        return {
            ...d,
            behavior: {
                ...d.behavior,
                customRoles: d.behavior.customRoles.filter(r => r.id !== roleId),
                // Its rules go with it.
                roleRules: Object.fromEntries(Object.entries(d.behavior.roleRules).filter(([id]) => id !== roleId)),
                // The active role falls back to the default role.
                activeRoleId,
            },
            startPage: (() => {
                // The default role, active now, shows first: its own card goes too.
                const roleEntries = d.startPage.roleEntries.filter(e => e.roleId !== roleId && e.roleId !== activeRoleId);
                const roleStarts = { ...d.startPage.roleStarts };
                delete roleStarts[roleId];
                // The last further role went: one role leaves nothing to choose, so the input field.
                const startMode = d.startPage.startMode === 'roles' && roleEntries.length === 0 ? 'input' : d.startPage.startMode;
                return { ...d.startPage, roleEntries, roleStarts, startMode };
            })(),
        };
    }), [catalog]);

    const discard = useCallback(() => { setDraft(saved); setShowErrors(false); }, [saved]);

    // A save or a restore changed the settings: the app's KB lists show name
    // and description, so bring them in step, then take the server's state.
    const applySaved = useCallback((res: AssistantSettingsResponse) => {
        const sync: Record<string, unknown> = {};
        if (res.canRename && res.title !== saved?.title) sync.name = res.title;
        if (res.description !== saved?.description) sync.description = res.description;
        if (Object.keys(sync).length) void onUpdateKb(sync);
        applyServer(res);
    }, [saved, onUpdateKb, applyServer]);

    const save = useCallback(async () => {
        if (!draft || !saved) return true;
        try {
            const res = await saveAssistantSettings(kb.id, {
                title: draft.title.trim(),
                description: draft.description?.trim() || null,
                categoryId: draft.categoryId,
                behavior: draft.behavior,
                startPage: draft.startPage,
                baseVersion: version,
            });
            applySaved(res);
            return true;
        } catch (err) {
            setSaveError(axios.isAxiosError(err) && err.response?.status === 409 ? 'conflict' : 'failed');
            return false;
        }
    }, [draft, saved, version, kb.id, applySaved]);

    const doReset = useCallback(async () => {
        try {
            await resetBehavior(kb.id);
            // Read everything back: the start page drops cards of roles that went.
            applyServer(await fetchAssistantSettings(kb.id));
            return true;
        } catch {
            return false;
        }
    }, [kb.id, applyServer]);

    const send = useCallback((section: AssistantSection, action?: AssistantAction) => {
        if (action?.type === 'previewRole') setPending(action);
        if (action?.type === 'addEntry' && draft) {
            // „Als Einstiegsfrage anbieten": the chat start becomes „Nur über
            // Rolle" with a card for the role (Verhalten offers it only for a
            // further role not on the page yet, while there is room). Every
            // role shows once: a role already on the page keeps its card.
            const page = draft.startPage;
            const existing = page.roleEntries.find(e => e.roleId === action.roleId);
            const canAdd = !existing && page.roleEntries.length < ROLE_ENTRY_MAX && action.roleId !== draft.behavior.activeRoleId;
            const entryId = canAdd ? newId('re') : existing?.id ?? null;
            updateStartPage(p => ({
                ...p,
                startMode: 'roles',
                roleEntries: canAdd && entryId
                    ? [...p.roleEntries, { id: entryId, roleId: action.roleId }]
                    : p.roleEntries,
            }));
            setPending({ type: 'startRoles', entryId, switched: page.startMode !== 'roles' });
        }
        onOpenSection(section);
    }, [onOpenSection, draft, updateStartPage]);

    return useMemo(() => ({
        status, kb, canRename, catalog, categories, draft, saved, version, dirty, saveError,
        showErrors, revealErrors: () => setShowErrors(true),
        update, updateBehavior, updateStartPage, deleteRole, discard, save,
        resetBehavior: doReset, applyServer, applySaved,
        pending, send, clearPending: () => setPending(null),
        retry: () => { setStatus('loading'); setAttempt(a => a + 1); },
    }), [status, kb, canRename, catalog, categories, draft, saved, version, dirty, saveError, showErrors, update, updateBehavior, updateStartPage, deleteRole, discard, save, doReset, applyServer, applySaved, pending, send]);
}

export const AssistantSettingsContext = createContext<AssistantSettings | null>(null);

export function useAssistantSettings(): AssistantSettings {
    const ctx = useContext(AssistantSettingsContext);
    if (!ctx) throw new Error('useAssistantSettings outside AssistantSettingsContext');
    return ctx;
}
