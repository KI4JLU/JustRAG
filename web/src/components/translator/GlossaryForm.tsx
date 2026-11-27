import { useId, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  DialogFooter,
  Input,
  Label,
  PanelSection,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { userErrorMessage } from '../../utils/userErrors';
import { createGlossary, updateGlossary } from './api';
import { IconAction } from './CopyButton';
import { GLOSSARY_LIMITS } from './glossaryLimits';
import type { GlossaryDetail, GlossaryEntry, GlossaryLanguage } from './types';

/** A pair of terms; a language the user did not choose (`null`) follows the languages on offer. */
interface TermRow {
  key: string;
  sourceLanguage: GlossaryLanguage | null;
  sourceTerm: string;
  targetLanguage: GlossaryLanguage | null;
  targetTerm: string;
}

const newRow = (): TermRow => ({
  key: crypto.randomUUID(),
  sourceLanguage: null,
  sourceTerm: '',
  targetLanguage: null,
  targetTerm: '',
});

/** The language of a term: the one chosen, else the preferred one when on offer, else the first. */
const termLanguage = (
  chosen: GlossaryLanguage | null,
  languages: readonly GlossaryLanguage[],
  preferred: GlossaryLanguage,
): GlossaryLanguage | undefined => chosen ?? (languages.includes(preferred) ? preferred : languages[0]);

interface GlossaryFormProps {
  /** The glossary being edited; `null` for a new one. */
  glossary: GlossaryDetail | null;
  /** The languages a term can be in. */
  languages: readonly GlossaryLanguage[];
  /** The caller may read the entries only (the viewer): nothing can be changed or saved. */
  readOnly?: boolean;
  /** Back to the list. */
  onDone: () => void;
  /** A glossary was made or changed; the list is read again. */
  onSaved: () => void;
}

/**
 * A new glossary, or one being edited: name, description, category and its term pairs. Whoever
 * may only read it (the viewer) sees the same, locked.
 */
export function GlossaryForm({ glossary, languages, readOnly = false, onDone, onSaved }: GlossaryFormProps) {
  const { t } = useTheme();
  const toast = useToast();
  const id = useId();
  const [name, setName] = useState(glossary?.name ?? '');
  const [description, setDescription] = useState(glossary?.description ?? '');
  const [category, setCategory] = useState(glossary?.category ?? '');
  const [rows, setRows] = useState<TermRow[]>(() =>
    glossary && glossary.entries.length > 0
      ? glossary.entries.map((entry) => ({ key: crypto.randomUUID(), ...entry }))
      : [newRow()],
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patchRow = (key: string, patch: Partial<TermRow>): void =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const submit = async (): Promise<void> => {
    if (saving || readOnly) return;
    const entries: GlossaryEntry[] = [];
    for (const row of rows) {
      if (!row.sourceTerm.trim() || !row.targetTerm.trim()) continue;
      const sourceLanguage = termLanguage(row.sourceLanguage, languages, 'de');
      const targetLanguage = termLanguage(row.targetLanguage, languages, 'en');
      // No language on offer (the list is not read): nothing can be saved.
      if (!sourceLanguage || !targetLanguage) return setProblem(t('translatorGlossarySaveFailed'));
      entries.push({ sourceLanguage, sourceTerm: row.sourceTerm.trim(), targetLanguage, targetTerm: row.targetTerm.trim() });
    }
    if (!name.trim()) return setProblem(t('translatorGlossaryNameRequired'));
    if (entries.length === 0) return setProblem(t('translatorGlossaryTermRequired'));
    setProblem(null);
    setSaving(true);
    try {
      const input = { name: name.trim(), description: description.trim(), category: category.trim(), entries };
      if (glossary) await updateGlossary(glossary.id, input);
      else await createGlossary({ ...input, visibility: 'private' });
      toast.success(t(glossary ? 'translatorGlossaryUpdated' : 'translatorGlossaryCreated'));
      onSaved();
      onDone();
    } catch (err: unknown) {
      setProblem(userErrorMessage(err, t, { fallbackKey: 'translatorGlossarySaveFailed' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="grid gap-stack-md"
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-name`}>{t('translatorGlossaryNameLabel')}</Label>
        <Input
          id={`${id}-name`}
          value={name}
          readOnly={readOnly}
          maxLength={GLOSSARY_LIMITS.nameMax}
          placeholder={t('translatorGlossaryNamePlaceholder')}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-description`}>{t('translatorGlossaryDescriptionLabel')}</Label>
        <Textarea
          id={`${id}-description`}
          value={description}
          readOnly={readOnly}
          placeholder={t('translatorGlossaryDescriptionPlaceholder')}
          onChange={(event) => setDescription(event.target.value)}
          className="min-h-20"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-category`}>{t('translatorGlossaryCategory')}</Label>
        <Input
          id={`${id}-category`}
          value={category}
          readOnly={readOnly}
          maxLength={GLOSSARY_LIMITS.categoryMax}
          placeholder={t('translatorGlossaryCategoryPlaceholder')}
          onChange={(event) => setCategory(event.target.value)}
        />
      </div>
      {/* A group named by its title and described by its hint, as a fieldset would be. */}
      <PanelSection
        role="group"
        title={t('translatorGlossaryTermsLabel')}
        hint={<span id={`${id}-terms-hint`}>{t('translatorGlossaryCaseHint')}</span>}
        aria-describedby={`${id}-terms-hint`}
      >
        {rows.map((row, index) => (
          <div key={row.key} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <TermLanguage
              label={t('translatorGlossarySourceLanguageOf').replace('{number}', String(index + 1))}
              options={languages}
              value={termLanguage(row.sourceLanguage, languages, 'de')}
              disabled={readOnly}
              onChange={(sourceLanguage) => patchRow(row.key, { sourceLanguage })}
            />
            <Input
              aria-label={t('translatorGlossarySourceTermOf').replace('{number}', String(index + 1))}
              value={row.sourceTerm}
              readOnly={readOnly}
              placeholder={t('translatorGlossarySourceTerm')}
              onChange={(event) => patchRow(row.key, { sourceTerm: event.target.value })}
              className="min-w-0 flex-1"
            />
            <span aria-hidden="true">→</span>
            <TermLanguage
              label={t('translatorGlossaryTargetLanguageOf').replace('{number}', String(index + 1))}
              options={languages}
              value={termLanguage(row.targetLanguage, languages, 'en')}
              disabled={readOnly}
              onChange={(targetLanguage) => patchRow(row.key, { targetLanguage })}
            />
            <Input
              aria-label={t('translatorGlossaryTargetTermOf').replace('{number}', String(index + 1))}
              value={row.targetTerm}
              readOnly={readOnly}
              placeholder={t('translatorGlossaryTargetTerm')}
              onChange={(event) => patchRow(row.key, { targetTerm: event.target.value })}
              className="min-w-0 flex-1"
            />
            {readOnly ? null : (
              <IconAction
                label={t('translatorGlossaryRemovePair')}
                onClick={() =>
                  // The last pair is emptied, not removed: there is always one to fill in.
                  rows.length > 1
                    ? setRows((current) => current.filter((other) => other.key !== row.key))
                    : patchRow(row.key, { sourceTerm: '', targetTerm: '' })
                }
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </IconAction>
            )}
          </div>
        ))}
        {readOnly ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRows((current) => [...current, newRow()])}
            className="self-start"
          >
            <Plus aria-hidden="true" className="size-4" />
            {t('translatorGlossaryAddPair')}
          </Button>
        )}
      </PanelSection>
      {problem ? (
        <p role="alert" className="m-0 text-sm text-error">
          {problem}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('translatorBack')}
        </Button>
        {readOnly ? null : (
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            {t(glossary ? 'translatorGlossaryUpdate' : 'translatorGlossaryCreate')}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}

/** The language of a term, as its code (DE, EN). */
function TermLanguage({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: readonly GlossaryLanguage[];
  value: GlossaryLanguage | undefined;
  disabled?: boolean;
  onChange: (language: GlossaryLanguage) => void;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const language = options.find((option) => option === next);
        if (language) onChange(language);
      }}
    >
      <SelectTrigger aria-label={label} className="w-20 shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((language) => (
          <SelectItem key={language} value={language}>
            {language.toUpperCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
