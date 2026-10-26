import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Eye, Globe, Megaphone, Pencil, Tag, Trash2, Undo2 } from 'lucide-react';
import {
    ActionMenu, Badge, Grid, type ActionMenuItem,
} from '@ki4jlu/design-system';
import { API_BASE_URL } from '../../api';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { useModalContext } from '../../contexts/ModalContext';
import { useAuth } from '../../contexts/AuthContext';
import { getApiErrorMessage } from '../../utils/apiError';
import type { KbCategory } from '../../types';
import { AdminUnpublishDialog } from './AdminUnpublishDialog';
import AdminCategoriesSection from './AdminCategoriesSection';
import { KbListRow } from '../KbListRow';

interface GlobalKbRow {
    id: string;
    name: string;
    createdAt: string;
    headerText?: string;
    autoSubscribe: boolean;
    /** Live: visible to everyone who may see public KBs. A staged public KB is not (docs/kb-access.md). Absent: live. */
    isPublished?: boolean;
}

interface AdminGlobalKbsTabProps {
    onEditGlobalKb?: (kb: { id: string; name: string }) => void;
}

/**
 * Admin surface for KBs that are visibility='public' — i.e. already
 * published. Publishing a private KB is deliberately not offered here: that
 * action targets a private KB, which by definition never appears in this
 * list. That entry point belongs on the KB overview instead.
 */
export default function AdminGlobalKbsTab({ onEditGlobalKb }: AdminGlobalKbsTabProps) {
    const { t, language } = useTheme();
    const toast = useToast();
    const { showConfirm } = useModalContext();
    const { user } = useAuth();
    const [globalKbs, setGlobalKbs] = useState<GlobalKbRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [categories, setCategories] = useState<KbCategory[]>([]);
    const [kbCategoryIds, setKbCategoryIds] = useState<Record<string, string[]>>({});
    // Tracks, per row, whether the GET /api/kb/{id}/categories prefetch below
    // failed — an empty array from a failed fetch must never be
    // indistinguishable from "this KB genuinely has no categories", because
    // the former rendered as if true would let a subsequent PUT silently
    // wipe the KB's real assignments.
    const [kbCategoryLoadFailed, setKbCategoryLoadFailed] = useState<Record<string, boolean>>({});

    const [unpublishTarget, setUnpublishTarget] = useState<GlobalKbRow | null>(null);
    const [unpublishBusy, setUnpublishBusy] = useState(false);
    const [unpublishError, setUnpublishError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await axios.get(`${API_BASE_URL}/api/admin/global-kbs`);
                const rows: GlobalKbRow[] = res.data;
                if (cancelled) return;
                setGlobalKbs(rows);
                // Pre-populate each row's current assignment so the multi-select
                // below doesn't start empty and wipe existing categories on the
                // first unrelated PUT. A failed fetch must not masquerade as "no
                // categories" — track it separately (kbCategoryLoadFailed) so the
                // row's control can be disabled instead of rendered as if the
                // empty result were true.
                const entries = await Promise.all(rows.map(async (kb) => {
                    try {
                        const catRes = await axios.get(`${API_BASE_URL}/api/kb/${kb.id}/categories`);
                        return { id: kb.id, categoryIds: (catRes.data as KbCategory[]).map(c => c.id), failed: false };
                    } catch (err: unknown) {
                        console.error(err);
                        return { id: kb.id, categoryIds: [] as string[], failed: true };
                    }
                }));
                if (!cancelled) {
                    setKbCategoryIds(Object.fromEntries(entries.map(e => [e.id, e.categoryIds])));
                    setKbCategoryLoadFailed(Object.fromEntries(entries.map(e => [e.id, e.failed])));
                }
            } catch (err: unknown) {
                console.error(err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        axios.get(`${API_BASE_URL}/api/admin/kb-categories`)
            .then(res => setCategories(res.data))
            .catch(() => setCategories([]));
    }, []);

    /* `handleCreate` stood here and is deleted (developer ruling, 18.09.2026):
       a topic is not CREATED global, it is created private and PROMOTED. It
       POSTed /api/admin/global-kbs — the same direct-creation route the
       „Globale KB erstellen" tile on „Geteiltes Wissen" used, and the last one
       left in the app. Promotion is the admin KB overview's publish action
       (`KBOverviewDashboard`, POST /api/admin/kb/{id}/publish, admin or
       superadmin). The backend endpoint is untouched. */

    const handleDelete = async (id: string) => {
        if (!await showConfirm(t('confirmDeleteGlobalKb'))) return;
        try {
            await axios.delete(`${API_BASE_URL}/api/admin/global-kbs/${id}`);
            setGlobalKbs(prev => prev.filter(k => k.id !== id));
        } catch (err: unknown) {
            console.error(err);
            toast.error(t('globalKbDeleteError'));
        }
    };

    // One change per KB at a time: a second toggle while the first request is in flight would roll back to an
    // optimistic value the server never had. The ref is the guard (it is current between renders), the state
    // disables the menu items.
    const inFlight = useRef(new Set<string>());
    const [busyKbs, setBusyKbs] = useState<ReadonlySet<string>>(new Set());
    const exclusive = async (kbId: string, change: () => Promise<void>) => {
        if (inFlight.current.has(kbId)) return;
        inFlight.current.add(kbId);
        setBusyKbs(new Set(inFlight.current));
        try {
            await change();
        } finally {
            inFlight.current.delete(kbId);
            setBusyKbs(new Set(inFlight.current));
        }
    };

    const handleTogglePublished = (kb: GlobalKbRow) => exclusive(kb.id, async () => {
        const previous = kb.isPublished ?? true;
        setGlobalKbs(prev => prev.map(k => (k.id === kb.id ? { ...k, isPublished: !previous } : k)));
        try {
            await axios.patch(`${API_BASE_URL}/api/admin/global-kbs/${kb.id}`, { isPublished: !previous });
        } catch (err: unknown) {
            console.error(err);
            toast.error(t('kbPublishFailed'));
            setGlobalKbs(prev => prev.map(k => (k.id === kb.id ? { ...k, isPublished: previous } : k)));
        }
    });

    const handleToggleAutoSubscribe = (kb: GlobalKbRow) => exclusive(kb.id, async () => {
        const next = !kb.autoSubscribe;
        setGlobalKbs(prev => prev.map(k => (k.id === kb.id ? { ...k, autoSubscribe: next } : k)));
        try {
            await axios.patch(`${API_BASE_URL}/api/admin/global-kbs/${kb.id}`, { autoSubscribe: next });
        } catch (err: unknown) {
            console.error(err);
            toast.error(t('autoSubscribeError'));
            setGlobalKbs(prev => prev.map(k => (k.id === kb.id ? { ...k, autoSubscribe: kb.autoSubscribe } : k)));
        }
    });

    const handleCategoryChange = (kbId: string, categoryIds: string[]) => exclusive(kbId, async () => {
        // Defense in depth alongside the disabled select below: a row whose
        // current assignments failed to load must never be saved over, even
        // if a change event reaches this handler some other way.
        if (kbCategoryLoadFailed[kbId]) return;
        const previous = kbCategoryIds[kbId] ?? [];
        setKbCategoryIds(prev => ({ ...prev, [kbId]: categoryIds }));
        try {
            await axios.put(`${API_BASE_URL}/api/kb/${kbId}/categories`, { categoryIds });
        } catch (err: unknown) {
            console.error(err);
            toast.error(t('categoriesAssignError'));
            setKbCategoryIds(prev => ({ ...prev, [kbId]: previous }));
        }
    });

    const handleUnpublishConfirm = async (newOwnerId: string) => {
        if (!unpublishTarget) return;
        setUnpublishBusy(true);
        setUnpublishError(null);
        try {
            await axios.post(`${API_BASE_URL}/api/admin/kb/${unpublishTarget.id}/unpublish`, { newOwnerId });
            // The KB is no longer public — it drops out of this list.
            setGlobalKbs(prev => prev.filter(k => k.id !== unpublishTarget.id));
            setUnpublishTarget(null);
        } catch (err: unknown) {
            console.error(err);
            setUnpublishError(getApiErrorMessage(err, t('unpublishError')));
        } finally {
            setUnpublishBusy(false);
        }
    };

    // The ⋮ menu carries every action of a public KB: edit, the settings (publish, show in all overviews, categories:
    // each applied at once, a checked item being the current state), take it back, delete.
    const actionsFor = (kb: GlobalKbRow): ActionMenuItem[] => {
        const assigned = kbCategoryIds[kb.id] ?? [];
        // A row whose assignment failed to load offers no categories: a toggle would PUT over the real ones.
        const loadFailed = !!kbCategoryLoadFailed[kb.id];
        return [
            {
                label: t('edit'),
                icon: <Pencil className="size-4" aria-hidden="true" />,
                onSelect: () => onEditGlobalKb?.(kb),
            },
            {
                label: t('kbActionPublishLive'),
                icon: <Megaphone className="size-4" aria-hidden="true" />,
                checked: kb.isPublished ?? true,
                disabled: busyKbs.has(kb.id),
                onSelect: () => { void handleTogglePublished(kb); },
            },
            {
                label: t('autoSubscribe'),
                icon: <Eye className="size-4" aria-hidden="true" />,
                checked: kb.autoSubscribe,
                disabled: busyKbs.has(kb.id),
                onSelect: () => { void handleToggleAutoSubscribe(kb); },
            },
            ...(categories.length > 0 ? [{
                label: t('categories'),
                icon: <Tag className="size-4" aria-hidden="true" />,
                submenu: categories.map(cat => ({
                    label: cat.name,
                    checked: assigned.includes(cat.id),
                    disabled: loadFailed || busyKbs.has(kb.id),
                    onSelect: () => {
                        void handleCategoryChange(
                            kb.id,
                            assigned.includes(cat.id) ? assigned.filter(id => id !== cat.id) : [...assigned, cat.id],
                        );
                    },
                })),
            }] : []),
            {
                label: t('unpublishKb'),
                icon: <Undo2 className="size-4" aria-hidden="true" />,
                separatorBefore: true,
                onSelect: () => { setUnpublishError(null); setUnpublishTarget(kb); },
            },
            {
                label: t('delete'),
                icon: <Trash2 className="size-4" aria-hidden="true" />,
                destructive: true,
                onSelect: () => { void handleDelete(kb.id); },
            },
        ];
    };

    return (
        <>
            {loading ? (
                <p className="text-on-surface-variant">{t('loading')}</p>
            ) : globalKbs.length === 0 ? (
                <p className="p-8 text-center text-on-surface-variant">{t('noGlobalKbs')}</p>
            ) : (
                // The home view's list rows (KbListRow); everything the old card carried is in the ⋮ menu.
                <Grid cols={1} gap="sm">
                    {globalKbs.map(kb => (
                        <KbListRow
                            key={kb.id}
                            leading={<Globe size={16} className="shrink-0 text-primary" aria-hidden="true" />}
                            name={<span className="truncate">{kb.name}</span>}
                            trailing={(
                                <>
                                    {kbCategoryLoadFailed[kb.id] && <Badge tone="error">{t('categoriesLoadError')}</Badge>}
                                    {kb.isPublished === false && <Badge tone="warning" title={t('kbStagedHint')}>{t('kbStagedBadge')}</Badge>}
                                    {kb.autoSubscribe && <Badge tone="primary">{t('autoSubscribeBadge')}</Badge>}
                                    <span className="whitespace-nowrap font-label-sm text-label-sm text-on-surface-variant">
                                        {new Date(kb.createdAt).toLocaleDateString(language, { dateStyle: 'medium' })}
                                    </span>
                                    <ActionMenu label={`${t('kbActions')}: ${kb.name}`} actions={actionsFor(kb)} align="end" />
                                </>
                            )}
                        />
                    ))}
                </Grid>
            )}

            {unpublishTarget && (
                <AdminUnpublishDialog
                    kbId={unpublishTarget.id}
                    kbName={unpublishTarget.name}
                    currentUserId={user.id}
                    busy={unpublishBusy}
                    error={unpublishError}
                    onCancel={() => { if (!unpublishBusy) setUnpublishTarget(null); }}
                    onConfirm={handleUnpublishConfirm}
                />
            )}

            <AdminCategoriesSection />
        </>
    );
}
