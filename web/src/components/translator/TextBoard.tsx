import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeftRightIcon, LanguagesIcon, WandSparklesIcon, XIcon } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { Badge, Button, Card, cn, Label, Stack, Textarea } from '@ki4jlu/design-system';
import { BOARD_INSET, boardTextSize, sourceBoardHtml } from './boardHtml';
import { CopyButton, IconAction } from './CopyButton';
import { LanguageMenu } from './LanguageMenu';
import { isTranslateShortcut, textErrorMessage } from './languages';
import { OutputBoard } from './OutputBoard';
import { splitIntoSentences } from './sentences';
import type { TranslatorStore } from './translatorStore';

interface TextBoardProps {
  id: string;
  store: TranslatorStore;
}

/** A count in the browser's number format. */
const count = (length: number): string => length.toLocaleString();

/**
 * Translating and rewriting: the languages on top, the source
 * and the editable result side by side with their counts and actions below, and the main button
 * across the foot of the card. The button only works when something changed since the result;
 * live editing needs none and hides it. The rules between the card's parts are borders in the
 * divider token (`outline-variant`).
 */
export function TextBoard({ id, store }: TextBoardProps) {
  const { t } = useTheme();
  const state = store.getState();
  const mode = store.textMode;
  const buffer = store.buffer;
  const translating = mode === 'translate';
  const textRef = useRef<HTMLTextAreaElement>(null);
  const replacedAll = useRef(false);
  const [focused, setFocused] = useState(false);
  const [hoveringSource, setHoveringSource] = useState(false);
  const [hoveredSource, setHoveredSource] = useState<number | null>(null);
  const [activeSource, setActiveSource] = useState<number | null>(null);
  // The result the source board was put away for, by pointing at or into the source.
  const [dismissed, setDismissed] = useState<object | null>(null);

  const target = store.targetText;
  const textMax = store.limits.textMax;
  const small = buffer.source.length > 50 || target.length > 50;
  const canRun = store.hasChanges;
  const run = (): void => {
    if (canRun) void store.run();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!isTranslateShortcut(event)) return;
    event.preventDefault();
    run();
  };

  // A result lays the source out as the sentences it was made from, until the
  // pointer or the focus goes into the source; the sentence a result sentence belongs to is
  // marked there while that one is pointed at. So a swap whose request failed still shows the
  // text the result was made from.
  const processed = state.processed[mode];
  const unchanged = buffer.source.trim() === (processed?.text ?? '');
  const marked = activeSource ?? hoveredSource;
  const showSourceBoard =
    !focused &&
    !hoveringSource &&
    !!target &&
    ((marked !== null && unchanged) || (processed !== null && dismissed !== processed));

  // An emptied field starts over on any input event of an emptied field, also one a script sends without a
  // change of the value, which React does not report.
  useEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const onInput = (): void => {
      if (!element.value.trim()) store.setSource(element.value);
    };
    element.addEventListener('input', onInput);
    return () => element.removeEventListener('input', onInput);
  }, [store]);
  const error = state.error ? textErrorMessage(state.error, mode, t) : null;

  return (
    <Card className="@container overflow-hidden">
      {/* The swap button in the middle: both languages take an equal share beside it. */}
      <Stack
        direction="row"
        gap="sm"
        align="center"
        justify="center"
        className="min-h-14 border-b border-outline-variant p-stack-sm"
      >
        <div className={cn('flex min-w-0', translating && 'flex-1 justify-end')}>
          <LanguageMenu
            label={t('translatorSource')}
            allowAuto
            value={buffer.sourceLang}
            onChange={(language) => store.setSourceLang(language)}
          />
        </div>
        {translating ? (
          <>
            <IconAction label={t('translatorSwap')} disabled={state.loading} onClick={() => store.swap()}>
              <ArrowLeftRightIcon aria-hidden="true" className="size-4" />
            </IconAction>
            <div className="flex min-w-0 flex-1 justify-start">
              <LanguageMenu
                label={t('translatorTarget')}
                value={buffer.targetLang}
                onChange={(language) => store.setTargetLang(language)}
              />
            </div>
          </>
        ) : null}
      </Stack>
      <div className="grid @2xl:grid-cols-2">
        <div className="flex min-w-0 flex-col">
          <div
            className="relative flex min-h-0 flex-1 flex-col"
            onMouseEnter={() => {
              setHoveringSource(true);
              setDismissed(processed);
            }}
            onMouseLeave={() => setHoveringSource(false)}
          >
            <Label htmlFor={`${id}-text`} className="sr-only">
              {t(translating ? 'translatorText' : 'translatorRephraseText')}
            </Label>
            <Textarea
              ref={textRef}
              id={`${id}-text`}
              variant="inline"
              value={buffer.source}
              maxLength={textMax}
              dir="auto"
              lang={buffer.sourceLang === 'auto' ? undefined : buffer.sourceLang}
              aria-describedby={`${id}-count ${id}-hint`}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              onBeforeInput={() => {
                const element = textRef.current;
                replacedAll.current =
                  !!element &&
                  element.value.length > 0 &&
                  element.selectionStart === 0 &&
                  element.selectionEnd === element.value.length;
              }}
              onChange={(event) => {
                store.setSource(event.target.value, replacedAll.current);
                replacedAll.current = false;
              }}
              onKeyDown={onKeyDown}
              onFocus={() => {
                setFocused(true);
                setDismissed(processed);
              }}
              onBlur={() => setFocused(false)}
              className={cn('min-h-72 flex-1 resize-none', BOARD_INSET, boardTextSize(small))}
            />
            {showSourceBoard ? (
              <div
                aria-hidden="true"
                // Over the field, which stays there for the keyboard and screenreaders. It takes
                // the field's (Card's) surface to cover its text, and its insets and size.
                className={cn(
                  'pointer-events-none absolute inset-0 overflow-hidden bg-surface-container-lowest whitespace-pre-wrap break-words text-on-surface',
                  BOARD_INSET,
                  boardTextSize(small),
                )}
                // Escaped in `sourceBoardHtml`.
                dangerouslySetInnerHTML={{
                  __html: sourceBoardHtml(
                    unchanged ? buffer.source : buffer.lastSourceText,
                    unchanged ? splitIntoSentences(buffer.source.trim()) : buffer.sourceSentences,
                    activeSource,
                    hoveredSource,
                  ),
                }}
              />
            ) : null}
            {buffer.source ? null : (
              // The placeholder is drawn over the empty field, in the placeholder's colour.
              <div
                id={`${id}-hint`}
                className={cn(
                  'pointer-events-none absolute inset-x-0 top-0 grid gap-gutter text-outline',
                  BOARD_INSET,
                  boardTextSize(false),
                )}
              >
                <p className="m-0">{t('translatorPlaceholder')}</p>
              </div>
            )}
            {buffer.source ? (
              <IconAction
                label={t('translatorClear')}
                onClick={() => {
                  store.clearSource();
                  textRef.current?.focus();
                }}
                className="absolute end-3 top-3"
              >
                <XIcon aria-hidden="true" className="size-4" />
              </IconAction>
            ) : null}
          </div>
          <PaneFooter>
            <Badge id={`${id}-count`} appearance="text" tone="neutral">
              {t('translatorCount')
                .replace('{length}', count(buffer.source.length))
                .replace('{max}', textMax.toLocaleString('de-DE'))}
            </Badge>
            <CopyButton text={buffer.source || undefined} whenEmpty="confirm" />
          </PaneFooter>
        </div>
        <div className="flex min-w-0 flex-col border-t border-outline-variant @2xl:border-t-0 @2xl:border-l">
          <OutputBoard
            id={`${id}-result`}
            store={store}
            label={t(translating ? 'translatorResult' : 'translatorRephrased')}
            language={translating ? buffer.targetLang : buffer.sourceLang === 'auto' ? undefined : buffer.sourceLang}
            small={small}
            onSourceHover={setHoveredSource}
            onSourceActive={setActiveSource}
          />
          <PaneFooter>
            <Badge appearance="text" tone="neutral">
              {t('translatorResultCount').replace('{length}', count(target.length))}
            </Badge>
            <Stack direction="row" gap="sm" align="center">
              {target && translating ? (
                <IconAction
                  label={t('translatorImproveResult')}
                  onClick={() => store.improveTarget()}
                  disabled={state.loading}
                >
                  <WandSparklesIcon aria-hidden="true" className="size-4" />
                </IconAction>
              ) : null}
              {target && !translating ? (
                <IconAction
                  label={t('translatorTranslateResult')}
                  onClick={() => store.translateTarget()}
                  disabled={state.loading}
                >
                  <LanguagesIcon aria-hidden="true" className="size-4" />
                </IconAction>
              ) : null}
              <CopyButton text={store.outputText || undefined} whenEmpty="confirm" />
            </Stack>
          </PaneFooter>
        </div>
      </div>
      {error ? (
        <div role="alert" className="border-t border-outline-variant px-stack-md py-stack-sm">
          <Badge appearance="text" tone="error">
            {error}
          </Badge>
        </div>
      ) : null}
      {/* A bar across the foot of the card, edge to edge; the card's rounded corners clip it. */}
      {store.liveActive ? null : (
        <Button
          type="button"
          disabled={!canRun}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          onClick={run}
          className="min-h-14 w-full rounded-none shadow-none active:scale-100"
        >
          {t(translating ? 'translatorTranslate' : 'translatorRephrase')}
        </Button>
      )}
    </Card>
  );
}

/** The foot of a pane: its character count and what can be done with its text. */
function PaneFooter({ children }: { children: React.ReactNode }) {
  return (
    <Stack
      direction="row"
      gap="sm"
      align="center"
      justify="between"
      className="min-h-14 border-t border-outline-variant px-stack-md py-stack-sm"
    >
      {children}
    </Stack>
  );
}
