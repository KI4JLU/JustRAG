import { useEffect, useState } from 'react';
import axios from 'axios';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@ki4jlu/design-system';
import { API_BASE_URL } from '../../api';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { useModalContext } from '../../contexts/ModalContext';
import type { KbCategory } from '../../types';

/**
 * CRUD section for the shared category taxonomy (GET/POST /api/admin/kb-categories,
 * PATCH/DELETE /api/admin/kb-categories/{catId}) — the flat, system-admin curated
 * list the catalog's filter chips and the public-KB category assignment draw from.
 * Self-contained: owns its own fetch, independent of the KB list above it.
 */
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

    const handleRename = async (cat: KbCategory) => {
        const name = await showPrompt(t('categoryNamePrompt'), cat.name);
        if (!name || name === cat.name) return;
        try {
            const res = await axios.patch(`${API_BASE_URL}/api/admin/kb-categories/${cat.id}`, { name, sortOrder: cat.sortOrder });
            setCategories(prev => prev.map(c => (c.id === cat.id ? res.data : c)));
        } catch (err: unknown) {
            console.error(err);
            toast.error(t('categorySaveError'));
        }
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
        <section className="admin-content mt-8 flex flex-col gap-4">
            <h3 className="m-0 text-on-surface">{t('categories')}</h3>
            {loading ? (
                <p className="m-0 text-on-surface-variant">{t('loading')}</p>
            ) : categories.length === 0 ? (
                <p className="m-0 text-sm text-on-surface-variant">{t('noCategories')}</p>
            ) : (
                <div className="flex flex-col gap-2">
                    {categories.map(cat => (
                        <div key={cat.id} className="result-card flex items-center justify-between gap-2 px-4 py-2.5">
                            <span className="text-sm">{cat.name}</span>
                            <div className="flex gap-1.5">
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
