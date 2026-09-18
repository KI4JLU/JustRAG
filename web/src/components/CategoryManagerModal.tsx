import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from '@ki4jlu/design-system';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { KbUserCategory } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';

/* ---------------------------------------------------------------------------
 * Manage the caller's own filter categories: add, rename, delete.
 *
 * WHY IT REPLACED A PROMPT. „+" used to call `showPrompt` — one string, one
 * category, and no way back: a typo was permanent and an unwanted category
 * could not be removed, because nothing in the UI called the `PATCH` and
 * `DELETE` endpoints that already existed. A create-only control over a
 * mutable list is a dead end by construction.
 *
 * BOTH DESTRUCTIVE STEPS CONFIRM IN PLACE rather than through `showConfirm`.
 * This is already a dialog, and the app's confirm is itself a modal: stacking
 * one on the other puts two focus traps on the page and leaves the question
 * „which Escape closes what" with no good answer. The row turns into its own
 * question instead, which cannot be dismissed by accident and needs no second
 * layer.
 *
 * IT OWNS NO CATEGORY STATE. Every mutation goes back out through the hook that
 * owns the list, so the chip row above and this dialog cannot disagree about
 * what exists. What it does own is the DRAFT — the half-typed new name, the row
 * being edited — which is the only state that dies with the dialog.
 * ------------------------------------------------------------------------- */

export interface CategoryManagerModalProps {
  show: boolean;
  onClose: () => void;
  categories: KbUserCategory[];
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function CategoryManagerModal({
  show, onClose, categories, onCreate, onRename, onDelete,
}: CategoryManagerModalProps) {
  const { t } = useTheme();
  const toast = useToast();

  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* One wrapper for all three calls: each is a request that can fail, and each
     failure means the same thing to the user — the list is unchanged and the
     name is probably taken (the server enforces it unique per user, case
     insensitively). Duplicating that per handler is how one of them ends up
     silently swallowing an error. */
  const run = async (fn: () => Promise<void>, after: () => void) => {
    setBusy(true);
    try {
      await fn();
      after();
    } catch {
      toast.error(t('categoryActionError'));
    } finally {
      setBusy(false);
    }
  };

  const submitDraft = () => {
    const name = draft.trim();
    if (!name) return;
    void run(() => onCreate(name), () => setDraft(''));
  };

  const submitRename = (id: string) => {
    const name = editingName.trim();
    if (!name) return;
    void run(() => onRename(id, name), () => setEditingId(null));
  };

  return (
    <Dialog open={show} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('manageCategoriesTitle')}</DialogTitle>
          <DialogDescription>{t('manageCategoriesBody')}</DialogDescription>
        </DialogHeader>

        {/* A form, so Enter submits — a one-field add that needed the mouse
            would be slower than the prompt this replaced. */}
        <form
          className="flex items-center gap-stack-sm"
          onSubmit={(e) => { e.preventDefault(); submitDraft(); }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('newCategoryPrompt')}
            aria-label={t('newCategoryPrompt')}
          />
          <Button type="submit" size="sm" disabled={busy || draft.trim() === ''}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('add')}
          </Button>
        </form>

        {categories.length === 0 ? (
          <p className="m-0 text-on-surface-variant">{t('noCategoriesYet')}</p>
        ) : (
          <ul className="m-0 flex max-h-80 list-none flex-col gap-stack-sm overflow-y-auto p-0">
            {categories.map((category) => (
              <li key={category.id} className="flex items-center gap-stack-sm">
                {editingId === category.id ? (
                  <>
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      aria-label={t('renameCategory')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); submitRename(category.id); }
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || editingName.trim() === ''}
                      aria-label={t('save')}
                      onClick={() => submitRename(category.id)}
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={t('cancel')} onClick={() => setEditingId(null)}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </>
                ) : confirmingId === category.id ? (
                  <>
                    {/* The row asks its own question — no second modal. */}
                    <span className="min-w-0 flex-1 truncate text-on-surface">
                      {t('confirmDeleteCategory')}
                    </span>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void run(() => onDelete(category.id), () => setConfirmingId(null))}
                    >
                      {t('delete')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)}>
                      {t('cancel')}
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-on-surface">{category.name}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`${t('renameCategory')}: ${category.name}`}
                      onClick={() => { setEditingId(category.id); setEditingName(category.name); }}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`${t('deleteCategory')}: ${category.name}`}
                      onClick={() => setConfirmingId(category.id)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
