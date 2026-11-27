import { useId, useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import {
  Button,
  DialogFooter,
  FileDropzone,
  Grid,
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
import { importGlossary } from './api';
import { GLOSSARY_LIMITS } from './glossaryLimits';
import type { GlossaryLanguage } from './types';

interface GlossaryImportFormProps {
  /** The languages a term can be in. */
  languages: readonly GlossaryLanguage[];
  onDone: () => void;
  /** A glossary was made; the list is read again. */
  onSaved: () => void;
}

/** "Glossar aus CSV importieren": name, description, the two languages and the file (a private glossary of the caller's). */
export function GlossaryImportForm({ languages, onDone, onSaved }: GlossaryImportFormProps) {
  const { t } = useTheme();
  const toast = useToast();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  // The user's choice; until there is one, the languages on offer decide (German to English).
  const [chosenSource, setSourceLanguage] = useState<GlossaryLanguage | null>(null);
  const [chosenTarget, setTargetLanguage] = useState<GlossaryLanguage | null>(null);
  const preferred = (chosen: GlossaryLanguage | null, language: GlossaryLanguage): GlossaryLanguage | undefined =>
    chosen ?? (languages.includes(language) ? language : languages[0]);
  const sourceLanguage = preferred(chosenSource, 'de');
  const targetLanguage = preferred(chosenTarget, 'en');
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pick = (picked: File | undefined): void => {
    if (!picked) return;
    setFile(picked);
    // The file's name is a good first name for the glossary.
    if (!name.trim()) setName(picked.name.replace(/\.[^/.]+$/, ''));
  };

  const submit = async (): Promise<void> => {
    if (saving) return;
    if (!name.trim()) return setProblem(t('translatorGlossaryNameRequired'));
    if (!file) return setProblem(t('translatorGlossaryFileRequired'));
    // No language on offer (the list is not read): nothing can be imported.
    if (!sourceLanguage || !targetLanguage) return setProblem(t('translatorGlossaryImportFailed'));
    // Refused here rather than after the upload: the server stops at the same size (413).
    if (file.size > GLOSSARY_LIMITS.importMaxBytes) {
      return setProblem(userErrorMessage({ status: 413 }, t, { name: file.name }));
    }
    setProblem(null);
    setSaving(true);
    try {
      await importGlossary({
        file,
        name: name.trim(),
        description: description.trim(),
        sourceLanguage,
        targetLanguage,
      });
      toast.success(t('translatorGlossaryCreated'));
      onSaved();
      onDone();
    } catch (err: unknown) {
      setProblem(userErrorMessage(err, t, { name: file.name, fallbackKey: 'translatorGlossaryImportFailed' }));
    } finally {
      setSaving(false);
    }
  };

  const languageName = (language: GlossaryLanguage): string =>
    `${t(`translatorGlossaryLanguage_${language}`)} (${language.toUpperCase()})`;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="grid gap-stack-md"
    >
      <PanelSection title={t('translatorGlossaryImportTitle')} />
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-name`}>{t('translatorGlossaryImportName')}</Label>
        <Input
          id={`${id}-name`}
          value={name}
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
          placeholder={t('translatorGlossaryDescriptionPlaceholder')}
          onChange={(event) => setDescription(event.target.value)}
          className="min-h-20"
        />
      </div>
      <Grid cols={2} gap="md">
        {(
          [
            ['source', sourceLanguage, setSourceLanguage],
            ['target', targetLanguage, setTargetLanguage],
          ] as const
        ).map(([side, value, set]) => (
          <div key={side} className="flex flex-col gap-1">
            <Label htmlFor={`${id}-${side}`}>
              {t(side === 'source' ? 'translatorGlossarySourceLanguage' : 'translatorGlossaryTargetLanguage')}
            </Label>
            <Select
              value={value}
              onValueChange={(next) => {
                const language = languages.find((option) => option === next);
                if (language) set(language);
              }}
            >
              <SelectTrigger id={`${id}-${side}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {languages.map((language) => (
                  <SelectItem key={language} value={language}>
                    {languageName(language)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </Grid>
      <FileDropzone
        icon={<Upload />}
        title={t('translatorGlossaryCsvDrop')}
        hint={file ? file.name : t('translatorGlossaryCsvFormat')}
        onBrowse={() => inputRef.current?.click()}
        onFiles={(files) => pick(files.find((item) => /\.(csv|txt)$/i.test(item.name)))}
        className="min-h-36"
      />
      {/* The file picker behind the dropzone, never shown itself. */}
      <Input
        ref={inputRef}
        type="file"
        accept=".csv,.txt"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          pick(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {problem ? (
        <p role="alert" className="m-0 text-sm text-error">
          {problem}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('translatorBack')}
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
          {t('translatorGlossaryImportSubmit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
