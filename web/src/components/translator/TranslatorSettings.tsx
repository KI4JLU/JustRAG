import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, BookMarked, Bookmark, ChevronRight, Eye, RefreshCw, Settings } from 'lucide-react';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Checkbox,
  Label,
  NavItem,
  PanelSection,
  Spinner,
  Switch,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import type { TranslatorState } from './translatorStore';
import {
  REPHRASE_STYLES,
  REPHRASE_TONES,
  type Formality,
  type Glossary,
  type RephraseStyle,
  type RephraseTone,
} from './types';

const ICON = { 'aria-hidden': true, className: 'size-4' } as const;

type Subview = 'glossaries' | 'style' | null;

export interface TranslatorSettingsProps {
  id: string;
  state: TranslatorState;
  /** The glossaries the user can open; `undefined` while they load. */
  glossaries: readonly Glossary[] | undefined;
  /** The list could not be read: it shows that, with a retry, instead of loading for ever. */
  glossariesFailed?: boolean;
  onRetryGlossaries?: () => void;
  onLive: (live: boolean) => void;
  onShowChanges: (show: boolean) => void;
  onGlossaries: (ids: string[]) => void;
  onManageGlossaries: () => void;
  onStyle: (style: RephraseStyle) => void;
  onTone: (tone: RephraseTone) => void;
  onFormality: (formality: Exclude<Formality, 'default'>) => void;
  onResetStyle: () => void;
}

/**
 * The translator's settings, in the column beside the work area: the tools of the mode and the
 * adjustments. Glossaries and writing style open views of their own within the column,
 * with a heading and a way back.
 */
export function TranslatorSettings(props: TranslatorSettingsProps) {
  const { t } = useTheme();
  const { id, state } = props;
  const [subview, setSubview] = useState<Subview>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const mode = state.mode;

  const open = (view: Exclude<Subview, null>, trigger: HTMLButtonElement): void => {
    opener.current = trigger;
    setSubview(view);
  };
  const close = (): void => {
    setSubview(null);
    // Back where the view was opened from, once the main view is there again.
    requestAnimationFrame(() => opener.current?.focus());
  };

  const styleValue = state.style
    ? t(`translatorStyle_${state.style}`)
    : state.tone
      ? t(`translatorTone_${state.tone}`)
      : state.formality !== 'default'
        ? t(`translatorFormality_${state.formality}`)
        : t('translatorStyleDefault');
  const glossaryCount = `${state.glossaryIds.length}/${props.glossaries?.length ?? 0}`;

  return (
    <>
      {/* Kept while a view is open, so the row that opened it can take the focus back. */}
      <div hidden={subview !== null} className="flex flex-col gap-stack-lg">
        <PanelSection title={t('translatorTools')}>
          <ToggleRow
            id={`${id}-live`}
            icon={<RefreshCw {...ICON} />}
            label={t(mode === 'rephrase' ? 'translatorLiveRephrase' : 'translatorLive')}
            checked={state.live}
            onChange={props.onLive}
          />
          {mode === 'rephrase' ? (
            <ToggleRow
              id={`${id}-changes`}
              icon={<Eye {...ICON} />}
              label={t('translatorShowChanges')}
              checked={state.showChanges}
              onChange={props.onShowChanges}
            />
          ) : null}
        </PanelSection>

        <PanelSection title={t('translatorOptions')}>
          {mode === 'translate' ? (
            <SettingsRowLink
              icon={<BookMarked {...ICON} />}
              label={t('translatorGlossariesTitle')}
              value={glossaryCount}
              onOpen={(trigger) => open('glossaries', trigger)}
            />
          ) : null}
          <SettingsRowLink
            icon={<Bookmark {...ICON} />}
            label={t('translatorStyleTitle')}
            value={styleValue}
            onOpen={(trigger) => open('style', trigger)}
          />
        </PanelSection>
      </div>

      {subview === 'glossaries' ? (
        <Subview
          title={t('translatorGlossariesTitle')}
          aside={glossaryCount}
          hint={props.glossaries?.length === 0 ? t('translatorGlossariesNone') : undefined}
          onBack={close}
          footer={
            <Button type="button" variant="outline" onClick={props.onManageGlossaries} className="w-full">
              <Settings {...ICON} />
              {t('translatorGlossariesManage')}
            </Button>
          }
        >
          {props.glossaries === undefined ? (
            props.glossariesFailed ? (
              <Alert tone="error">
                <AlertDescription>{t('translatorGlossariesLoadFailed')}</AlertDescription>
                <Button type="button" variant="outline" size="sm" onClick={props.onRetryGlossaries}>
                  {t('translatorGlossariesRetry')}
                </Button>
              </Alert>
            ) : (
              <Spinner label={t('translatorGlossariesLoading')} className="self-center" />
            )
          ) : props.glossaries.length > 0 ? (
            <GlossaryChoice
              id={id}
              glossaries={props.glossaries}
              selected={state.glossaryIds}
              onChange={props.onGlossaries}
            />
          ) : null}
        </Subview>
      ) : null}

      {subview === 'style' ? (
        <Subview title={t('translatorStyleTitle')} onBack={close}>
          <StylePanel
            state={state}
            full={mode === 'rephrase'}
            onStyle={(style) => {
              props.onStyle(style);
              close();
            }}
            onTone={(tone) => {
              props.onTone(tone);
              close();
            }}
            onFormality={(formality) => {
              props.onFormality(formality);
              close();
            }}
            onReset={props.onResetStyle}
          />
        </Subview>
      ) : null}
    </>
  );
}

/** A row that opens a view of the column: icon, label, the current value, a chevron. */
function SettingsRowLink({
  icon,
  label,
  value,
  onOpen,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  return (
    <NavItem type="button" level="sub" onClick={(event) => onOpen(event.currentTarget)}>
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {value ? <Badge className="shrink-0">{value}</Badge> : null}
      <ChevronRight {...ICON} />
    </NavItem>
  );
}

/** A switch with its icon and label. */
function ToggleRow({
  id,
  icon,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  icon: ReactNode;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    // The switch comes first, so the label greys out with it (`peer-disabled`); shown reversed.
    <div className="flex min-h-10 flex-row-reverse items-center justify-between gap-3 px-3">
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} className="peer" />
      <Label htmlFor={id} className="flex min-w-0 items-center gap-3">
        {icon}
        <span className="truncate">{label}</span>
      </Label>
    </div>
  );
}

/** A view within the column: a way back, then its heading and content. */
function Subview({
  title,
  aside,
  hint,
  onBack,
  footer,
  children,
}: {
  title: string;
  aside?: string;
  /** Muted text under the heading, as when there is nothing to choose. */
  hint?: string;
  onBack: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTheme();
  const back = useRef<HTMLButtonElement>(null);
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => back.current?.focus(), []);
  // Escape goes back, from wherever in the view the focus is.
  useEffect(() => {
    const element = region.current;
    if (!element) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onBack();
    };
    element.addEventListener('keydown', onKeyDown);
    return () => element.removeEventListener('keydown', onKeyDown);
  }, [onBack]);
  return (
    <div ref={region} role="region" aria-label={title} className="flex flex-col items-start gap-stack-md">
      <Button ref={back} type="button" variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft {...ICON} />
        {t('translatorBack')}
      </Button>
      <PanelSection title={title} aside={aside} hint={hint} className="self-stretch">
        {children}
      </PanelSection>
      {footer}
    </div>
  );
}

/** The glossaries with a checkbox each; several can be on at once. */
function GlossaryChoice({
  id,
  glossaries,
  selected,
  onChange,
}: {
  id: string;
  glossaries: readonly Glossary[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTheme();
  return (
    <ul className="m-0 grid list-none grid-cols-1 gap-1 p-0">
      {glossaries.map((glossary) => {
        const checkboxId = `${id}-glossary-${glossary.id}`;
        return (
          <li key={glossary.id} className="flex min-h-10 items-center gap-3 px-3">
            <Checkbox
              id={checkboxId}
              checked={selected.includes(glossary.id)}
              onCheckedChange={(value) =>
                onChange(
                  value === true ? [...selected, glossary.id] : selected.filter((other) => other !== glossary.id),
                )
              }
            />
            <Label htmlFor={checkboxId} className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate">{glossary.name}</span>
              <span className="shrink-0">{`• ${t(glossary.entryCount === 1 ? 'translatorGlossaryTermOne' : 'translatorGlossaryTerms').replace('{count}', String(glossary.entryCount))}`}</span>
            </Label>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Writing style, tone and formality, one at a time: "Standard" clears them. Translating offers
 * the formality alone; rewriting offers all three.
 */
function StylePanel({
  state,
  full,
  onStyle,
  onTone,
  onFormality,
  onReset,
}: {
  state: TranslatorState;
  full: boolean;
  onStyle: (style: RephraseStyle) => void;
  onTone: (tone: RephraseTone) => void;
  onFormality: (formality: Exclude<Formality, 'default'>) => void;
  onReset: () => void;
}) {
  const { t } = useTheme();
  const standard = !state.style && !state.tone && state.formality === 'default';
  return (
    <>
      <ChoiceRow label={t('translatorStyleDefault')} active={standard} onSelect={onReset} />
      {full ? (
        <>
          <ChoiceGroup
            title={t('translatorStyle')}
            options={REPHRASE_STYLES.map((style) => ({
              key: style,
              label: t(`translatorStyle_${style}`),
              active: state.style === style,
              onSelect: () => onStyle(style),
            }))}
          />
          <ChoiceGroup
            title={t('translatorTone')}
            options={REPHRASE_TONES.map((tone) => ({
              key: tone,
              label: t(`translatorTone_${tone}`),
              active: state.tone === tone,
              onSelect: () => onTone(tone),
            }))}
          />
        </>
      ) : null}
      <ChoiceGroup
        title={t('translatorFormality')}
        options={(['formal', 'informal'] as const).map((formality) => ({
          key: formality,
          label: t(`translatorFormality_${formality}`),
          active: state.formality === formality,
          onSelect: () => onFormality(formality),
        }))}
      />
    </>
  );
}

function ChoiceGroup({
  title,
  options,
}: {
  title: string;
  options: Array<{ key: string; label: string; active: boolean; onSelect: () => void }>;
}) {
  return (
    <PanelSection title={title}>
      {options.map((option) => (
        <ChoiceRow key={option.key} label={option.label} active={option.active} onSelect={option.onSelect} />
      ))}
    </PanelSection>
  );
}

/** One choice of the style view, pressed while it is the current one. */
function ChoiceRow({ label, active, onSelect }: { label: string; active: boolean; onSelect: () => void }) {
  return (
    <NavItem
      type="button"
      level="sub"
      active={active}
      aria-pressed={active}
      // A setting, not the current page: `aria-pressed` tells which one is on.
      aria-current={undefined}
      onClick={onSelect}
    >
      <span>{label}</span>
    </NavItem>
  );
}
