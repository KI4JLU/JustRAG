import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Switch,
} from '@ki4jlu/design-system';
import type { KbCategory } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { CategoryDot } from './CategoryPill';

/* ---------------------------------------------------------------------------
 * The categories of the filter row: the platform's (admin-curated) ones, each
 * with an „Im Filter" switch that hides its chip (developer, 30.10.2026).
 *
 * The user's own categories are not offered for now (developer, 30.10.2026):
 * nothing in the UI attaches one to a topic yet, so a chip for one could only
 * ever filter to an empty list. Their endpoints (`/api/kb-user-categories`)
 * stay; the dialog gains a second section when assigning them is built.
 *
 * IT OWNS NO STATE. The list and the hidden set belong to `useTopicFilters`,
 * so the chip row and this dialog cannot disagree.
 * ------------------------------------------------------------------------- */

export interface CategoryManagerModalProps {
  show: boolean;
  onClose: () => void;
  /** The platform's categories, with their colour. */
  categories: KbCategory[];
  /** Ids hidden from the chip row. */
  hiddenIds: ReadonlySet<string>;
  onSetHidden: (id: string, hidden: boolean) => void;
}

export function CategoryManagerModal({ show, onClose, categories, hiddenIds, onSetHidden }: CategoryManagerModalProps) {
  const { t } = useTheme();

  return (
    <Dialog open={show} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('manageCategoriesTitle')}</DialogTitle>
          <DialogDescription>{t('manageCategoriesBody')}</DialogDescription>
        </DialogHeader>

        {categories.length === 0 ? (
          <p className="m-0 text-on-surface-variant">{t('noCategoriesYet')}</p>
        ) : (
          <div className="flex flex-col gap-stack-sm">
            {/* The switches' column label. */}
            <div aria-hidden="true" className="flex justify-end text-xs font-medium text-on-surface-variant">
              {t('categoryInFilter')}
            </div>
            <ul className="m-0 flex max-h-80 list-none flex-col gap-stack-sm overflow-y-auto p-0">
              {categories.map((category) => (
                <li key={category.id} className="flex min-h-9 items-center gap-stack-sm">
                  <CategoryDot category={category} />
                  <span className="min-w-0 flex-1 truncate text-on-surface">{category.name}</span>
                  {/* On = the category has a chip. Named per row, so a screen
                      reader hears which category the switch is for. */}
                  <Switch
                    aria-label={t('showCategoryInFilter').replace('{name}', category.name)}
                    checked={!hiddenIds.has(category.id)}
                    onCheckedChange={(on) => onSetHidden(category.id, !on)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
