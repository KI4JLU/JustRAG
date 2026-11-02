import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Button, CATEGORY_PALETTE, ColorField } from '@ki4jlu/design-system';
import { API_BASE_URL } from '../../api';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { useModalContext } from '../../contexts/ModalContext';
import type { KbCategory } from '../../types';
import { CategoryPill } from '../CategoryPill';

/**
 * CRUD section for the shared category taxonomy (GET/POST /api/admin/kb-categories,
 * PATCH/DELETE /api/admin/kb-categories/{catId}) — the flat, system-admin curated
 * list the catalog's filter chips and the public-KB category assignment draw from.
 * Each category's colour is picked freely in its row (`color`, migration 0096);
 * one that never had a colour picked shows its palette slot's.
 * Self-contained: owns its own fetch. The „Kategorien" tab of „Vorlagen".
 */
/** How long the colour picker must rest before its value is saved. */
const COLOR_SAVE_DELAY_MS = 400;

export default function AdminCategoriesSection() {
    const { t } = useTheme();
    const toast = useToast();
    const { showPrompt, showConfirm } = useModalContext();
    const [categories, setCategories] = useState<KbCategory[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        axios.get(`${API_BASE_URL}/api/admin/kb-categories`)
            .then(res => setCategories(res.data))
            .catch((err: unknown) => console.error(err))
            .finally(() => setLoading(false));
    }, []);

    const handleCreate = async () => {
        const name = await showPrompt(t('categoryNamePrompt'));
        if (!name) return;
        try {
            const res = await axios.post(`${API_BASE_URL}/api/admin/kb-categories`, { name, sortOrder: categories.length });
            setCategories(prev => [...prev, res.data]);
        } catch (err: unknown) {
            console.error(err);
            toast.error(t('categorySaveError'));
        }
    };

    /* Every PATCH of a category runs through one queue per category, so the
       server applies renames and colour picks in the order they were made;
       and each PATCH sends the category's latest saved name and order, so a
       queued colour save never undoes a rename that went before it. */
    const saveChains = useRef(new Map<string, Promise<unknown>>());
    const savedFields = useRef(new Map<string, { name: string; sortOrder: number }>());
    const enqueue = <T,>(id: string, run: () => Promise<T>): Promise<T> => {
        const next = (saveChains.current.get(id) ?? Promise.resolve()).catch(() => undefined).then(run);
        saveChains.current.set(id, next);
        return next;
    };
    const fieldsOf = (cat: KbCategory) => savedFields.current.get(cat.id) ?? { name: cat.name, sortOrder: cat.sortOrder };

    const handleRename = async (cat: KbCategory) => {
        const name = await showPrompt(t('categoryNamePrompt'), cat.name);
        if (!name || name === cat.name) return;
        try {
            const res = await enqueue(cat.id, async () => {
                const r = await axios.patch(`${API_BASE_URL}/api/admin/kb-categories/${cat.id}`, { name, sortOrder: fieldsOf(cat).sortOrder });
                savedFields.current.set(cat.id, { name: r.data.name, sortOrder: r.data.sortOrder });
                return r;
            });
            // A colour picked meanwhile and not yet saved stays on the row.
            setCategories(prev => prev.map(c => (c.id === cat.id ? { ...res.data, color: pendingColors.current.has(cat.id) ? c.color : res.data.color } : c)));
        } catch (err: unknown) {
            console.error(err);
            toast.error(t('categorySaveError'));
        }
    };

    /* A colour picker reports every step of a drag, so the row shows each one
       at once and the save waits until the picking pauses — one PATCH per
       pick, not per pixel. Only the last pick's answer (or failure) touches
       the row. Leaving the section (closing the dialog, switching tabs) sends
       a pick still waiting, so none is lost. */
    const pendingColors = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; save: () => Promise<unknown> }>());
    const latestPick = useRef(new Map<string, number>());
    useEffect(() => {
        const pending = pendingColors.current;
        return () => pending.forEach(({ timer, save }) => {
            clearTimeout(timer);
            void save().catch((err: unknown) => console.error(err));
        });
    }, []);
    const handleColor = (cat: KbCategory, picked: string) => {
        const color = picked.toLowerCase();
        const pick = (latestPick.current.get(cat.id) ?? 0) + 1;
        latestPick.current.set(cat.id, pick);
        setCategories(prev => prev.map(c => (c.id === cat.id ? { ...c, color } : c)));
        clearTimeout(pendingColors.current.get(cat.id)?.timer);
        const save = () => enqueue(cat.id, () =>
            axios.patch(`${API_BASE_URL}/api/admin/kb-categories/${cat.id}`, { ...fieldsOf(cat), color }));
        const timer = setTimeout(() => {
            pendingColors.current.delete(cat.id);
            const current = () => latestPick.current.get(cat.id) === pick;
            save()
                .then(res => { if (current()) setCategories(prev => prev.map(c => (c.id === cat.id ? res.data : c))); })
                .catch((err: unknown) => {
                    console.error(err);
                    if (!current()) return;
                    setCategories(prev => prev.map(c => (c.id === cat.id ? { ...c, color: cat.color } : c)));
                    toast.error(t('categorySaveError'));
                });
        }, COLOR_SAVE_DELAY_MS);
        pendingColors.current.set(cat.id, { timer, save });
    };

    const handleDelete = async (cat: KbCategory) => {
        if (!await showConfirm(t('categoryDeleteConfirm'))) return;
        try {
            await axios.delete(`${API_BASE_URL}/api/admin/kb-categories/${cat.id}`);
            setCategories(prev => prev.filter(c => c.id !== cat.id));
        } catch (err: unknown) {
            console.error(err);
            toast.error(t('categoryDeleteError'));
        }
    };

    return (
        <section className="admin-content flex flex-col gap-4">
            {loading ? (
                <p className="m-0 text-on-surface-variant">{t('loading')}</p>
            ) : categories.length === 0 ? (
                <p className="m-0 text-sm text-on-surface-variant">{t('noCategories')}</p>
            ) : (
                <div className="flex flex-col gap-2">
                    {categories.map(cat => (
                        <div key={cat.id} className="result-card flex items-center justify-between gap-2 px-4 py-2.5">
                            {/* As the topic's title card shows it: colour dot and name in a pill. */}
                            <span className="text-sm"><CategoryPill category={cat} /></span>
                            <div className="flex gap-1.5">
                                <ColorField
                                    label={t('categoryColorChange').replace('{name}', cat.name)}
                                    value={cat.color ?? CATEGORY_PALETTE[(cat.colorSlot ?? 1) - 1] ?? CATEGORY_PALETTE[0]}
                                    onChange={(picked: string) => handleColor(cat, picked)}
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleRename(cat)}
                                    aria-label={`${t('edit')}: ${cat.name}`}
                                >
                                    <Pencil size={14} />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost-destructive"
                                    size="icon"
                                    onClick={() => handleDelete(cat)}
                                    aria-label={`${t('delete')}: ${cat.name}`}
                                >
                                    <Trash2 size={14} />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {/* Adding is an action inside the list, so it sits under it (as "Modell hinzufügen"
              * does in the config form) rather than in the section header. */}
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={handleCreate}>
                <Plus size={16} /> {t('create')}
            </Button>
        </section>
    );
}
