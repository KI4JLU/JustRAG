import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ArrowLeftToLineIcon, Undo2Icon, WandSparklesIcon, XIcon } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { Badge, Button, Card, cn, MenuItem, Separator, Spinner } from '@ki4jlu/design-system';
import { BOARD_CLASSES } from './boardHtml';
import { IconAction } from './CopyButton';
import { diffWords } from './diff';
import { sentenceTokens } from './sentences';
import type { SuggestionTarget, TranslatorStore } from './translatorStore';

/** Where a sentence of the result was clicked, relative to the board. */
export interface MenuAnchor {
  index: number;
  /** The clicked word, if the click hit one. */
  tokenIndex: number | null;
  word: string | null;
  /** Whether the sentence came from the source; the user's own ones can go into it. */
  hasSource: boolean;
  top: number;
  bottom: number;
  left: number;
}

interface SentenceMenuProps {
  store: TranslatorStore;
  anchor: MenuAnchor;
  containerRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

/**
 * The menu over a clicked sentence of the result: undo the user's change of it, move a sentence
 * of their own into the source, ask for other wordings of the sentence or other words for the
 * clicked word. Suggestions open below it; picking one puts it in.
 *
 * Both are Cards placed at the measured sentence (hence the inline position). Popover and
 * DropdownMenu portal to the end of the page, where the Tab key from the board would not reach
 * them, and close on Escape, which this menu does not; so the panels stay in the board and take
 * Card's surface (`shadow-card`, not the floating `shadow-overlay`).
 */
export function SentenceMenu({ store, anchor, containerRef, onClose }: SentenceMenuProps) {
  const { t } = useTheme();
  const menu = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<SuggestionTarget['kind'] | null>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState({ menu: 42, container: 0 });
  const request = useRef<AbortController | null>(null);
  // Whether there is a change to undo, as the menu opened: undoing does not look again.
  const [changed] = useState(() => store.isSentenceChanged(anchor.index));

  useLayoutEffect(() => {
    setSize({
      menu: menu.current?.offsetHeight ?? 42,
      container: containerRef.current?.offsetHeight ?? 0,
    });
  }, [containerRef]);

  // Closes on a click anywhere else; Escape leaves it open and "Schließen" closes
  // it. The latest `onClose` is used, so the listener (and a request on its way) outlive the
  // parent's renders.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (menu.current?.contains(target) || list.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.('.sentence-item')) return;
      close.current();
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, []);
  useEffect(() => () => request.current?.abort(), []);

  const target = (which: SuggestionTarget['kind']): SuggestionTarget => ({
    index: anchor.index,
    tokenIndex: anchor.tokenIndex,
    kind: which,
  });

  const load = async (which: SuggestionTarget['kind'], more = false): Promise<void> => {
    setKind(which);
    setFailed(false);
    const cached = more ? undefined : store.cachedSuggestions(target(which));
    if (cached) {
      setSuggestions(cached);
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    if (!more) setSuggestions(null);
    try {
      const next = await store.loadSuggestions(target(which), more, controller.signal);
      if (!controller.signal.aborted) setSuggestions(next);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (request.current === controller) setLoading(false);
    }
  };

  const apply = (text: string): void => {
    if (!kind) return;
    const which = target(kind);
    onClose();
    void store.applySuggestion(which, text);
  };

  const height = size.menu;
  // Above the sentence, over the language bar if need be; below it where even that is short.
  const above = anchor.top - height - 12;
  const top = above >= -48 ? above : Math.min(anchor.bottom + 8, Math.max(0, size.container - height));
  const original = kind ? store.suggestionOriginal(target(kind)) : '';
  const options = suggestions?.filter((suggestion) => suggestion && suggestion !== original) ?? [];

  return (
    <>
      <Card
        ref={menu}
        role="toolbar"
        aria-label={t('translatorSentenceMenu')}
        style={{ top, left: anchor.left }}
        className="absolute z-20 flex items-center gap-0.5 p-1"
      >
        {anchor.hasSource ? (
          <IconAction
            label={t('translatorSentenceUndo')}
            disabled={!changed}
            // The menu stays open over the sentence put back.
            onClick={() => store.undoSentence(anchor.index)}
          >
            <Undo2Icon aria-hidden="true" className="size-4" />
          </IconAction>
        ) : (
          <IconAction
            label={t('translatorSentencePushToSource')}
            onClick={() => {
              onClose();
              void store.pushToSource(anchor.index);
            }}
          >
            <ArrowLeftToLineIcon aria-hidden="true" className="size-4" />
          </IconAction>
        )}
        <Separator orientation="vertical" className="mx-0.5 h-5" />
        {/* A ghost Button shows itself pressed by its `aria-pressed`. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={kind === 'sentence'}
          onClick={() => void load('sentence')}
        >
          {t('translatorSentenceRephrase')}
        </Button>
        <Separator orientation="vertical" className="mx-0.5 h-5" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={kind === 'word'}
          disabled={anchor.tokenIndex === null}
          onClick={() => void load('word')}
        >
          {t('translatorSentenceReplaceWord')}
        </Button>
        <Separator orientation="vertical" className="mx-0.5 h-5" />
        <IconAction label={t('translatorSentenceClose')} onClick={onClose}>
          <XIcon aria-hidden="true" className="size-4" />
        </IconAction>
      </Card>
      {kind ? (
        <Card
          ref={list}
          role="listbox"
          aria-label={t(kind === 'word' ? 'translatorSentenceWords' : 'translatorSentenceAlternatives')}
          aria-busy={loading}
          style={{ top: top + height + 4, left: anchor.left }}
          // As wide as the board allows, keeping its inset on the right, up to 32 rem.
          className="absolute right-4 z-20 flex max-w-lg flex-col overflow-hidden py-1"
        >
          <Proposal text={original} kind={kind} store={store} anchor={anchor} original onPick={() => apply(original)} />
          <Separator />
          {options.map((option) => (
            <Proposal
              key={option}
              text={option}
              compareTo={original}
              kind={kind}
              store={store}
              anchor={anchor}
              onPick={() => apply(option)}
            />
          ))}
          {/* The status rows sit on the MenuItems' insets. */}
          {loading ? (
            <div className="px-3 py-2">
              <Badge appearance="text" tone="neutral">
                <Spinner size="sm" />
                <span className={BOARD_CLASSES.loading}>{original || '...'}</span>
              </Badge>
            </div>
          ) : failed ? (
            <div role="alert" className="px-3 py-2">
              <Badge appearance="text" tone="error">
                {t('translatorSentenceFailed')}
              </Badge>
            </div>
          ) : (
            <MenuItem type="button" onClick={() => void load(kind, true)}>
              <WandSparklesIcon aria-hidden="true" className="size-4" />
              <span>{t('translatorSentenceMore')}</span>
            </MenuItem>
          )}
        </Card>
      ) : null}
    </>
  );
}

/**
 * One suggestion: a sentence with its new words highlighted, or the word in its context with the
 * new word in bold. The first one is the text as it is.
 */
function Proposal({
  text,
  compareTo,
  kind,
  store,
  anchor,
  original,
  onPick,
}: {
  text: string;
  compareTo?: string;
  kind: SuggestionTarget['kind'];
  store: TranslatorStore;
  anchor: MenuAnchor;
  original?: boolean;
  onPick: () => void;
}) {
  let content: React.ReactNode;
  // Cut contexts are marked with three dots.
  if (kind === 'word' && anchor.tokenIndex !== null) {
    const tokens = sentenceTokens(store.buffer.targetSentences[anchor.index] ?? '');
    const from = Math.max(0, anchor.tokenIndex - 2);
    const to = Math.min(tokens.length, anchor.tokenIndex + 3);
    content = (
      <>
        {'„'}
        {from > 0 ? '...' : null}
        {tokens
          .slice(from, to)
          .map((token, index) => (from + index === anchor.tokenIndex ? <b key={index}>{text}</b> : token))}
        {to < tokens.length ? '...' : null}
        {'“'}
      </>
    );
  } else if (compareTo !== undefined && compareTo !== text) {
    content = diffWords(compareTo, text)
      .filter((part) => part.type !== 'delete')
      .map((part, index) =>
        part.type === 'insert' ? (
          <span key={index} className={BOARD_CLASSES.inserted}>
            {part.text}
          </span>
        ) : (
          part.text
        ),
      );
  } else {
    content = `„${text.trim()}“`;
  }
  return (
    <MenuItem type="button" role="option" aria-selected={false} onClick={onPick}>
      {/* The text as it is, muted. */}
      <span className={cn('block', original && 'text-on-surface-variant')}>{content}</span>
    </MenuItem>
  );
}
