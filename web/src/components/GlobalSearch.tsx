import { forwardRef, useCallback, useEffect, useRef, useState, type ForwardedRef, type ReactNode } from 'react';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxLoading,
  ComboboxSeparator,
  Kbd,
  KbdGroup,
} from '@ki4jlu/design-system';
import { BookOpen, Compass, FileText, Globe, MessageSquare, Search, TextQuote } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { isSearchableQuery, useGlobalSearch } from '../hooks/useGlobalSearch';
import { splitSnippet } from '../utils/searchSnippet';
import type { SearchChatHit, SearchMessageHit, SearchSourceHit, SearchTopicHit } from '../types';

/* ---------------------------------------------------------------------------
 * The shell header's global search (card KI-837): topics, sources, chats and
 * chat-content hits in one grouped dropdown under the field.
 *
 * BUILT ON THE DS `Combobox` (design-system 0.44.0, KI-839), in its server
 * mode: `shouldFilter={false}` because `GET /api/search` already filtered, and
 * everything the component leaves to the consumer is done here or in
 * `useGlobalSearch` — the one debounce, the minimum length (through the
 * controlled `open`), the loading / empty states and dropping stale answers.
 * No listbox, highlight or keyboard handling is written here; cmdk + Radix own
 * all of that, including `role="combobox"`, `aria-expanded`,
 * `aria-activedescendant`, ↑/↓, Enter and Escape.
 *
 * WHAT IT DOES NOT OWN. The query text and the navigation. The text is a
 * prop because it has to survive the chrome being rebuilt (the Discover row
 * swaps the whole view branch — see `KbSearchContext`), and every `onOpen…`
 * is a prop so this component knows nothing about views, hooks or ordering:
 * `useSearchNavigation` does the sequencing. That keeps it reusable as-is for
 * the workspace search (KI-838) through `scopeKbId`.
 *
 * STRINGS. Every label goes through `t()`, including the ones the DS would
 * otherwise default to in German (`ComboboxList`'s and `ComboboxLoading`'s
 * accessible names).
 * ------------------------------------------------------------------------- */

/* The result list's width: 30rem preferred, never below 33vw nor above
   100vw — `clamp(min, preferred, max)` — centred under the field, whatever
   width the field has. Both search fields sit in `AppShellLayout`'s
   centred `search` slot, which gives way before the side regions and can
   shrink to its 8rem floor — too narrow for a two-line result row — while a
   wide slot made the list a long, sparse strip. A caller's `contentClassName`
   still wins (tailwind-merge in the DS). */
const DEFAULT_LIST_CLASS = 'w-[clamp(33vw,30rem,100vw)]';

/** One row of the list shown while the field is empty. */
export interface SearchDefaultItem {
  /** Unique across all default groups (cmdk keys the option by it). */
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

export interface SearchDefaultGroup {
  heading: string;
  items: SearchDefaultItem[];
}

export interface GlobalSearchProps {
  /** The field text. Held by the caller so it survives a remount. */
  query: string;
  onQueryChange: (next: string) => void;
  /**
   * Restrict every group to one topic (KI-838's workspace search). The
   * Topics group is then omitted, and a „search all topics" row at the end of
   * the list repeats the same text without the scope — for the current query
   * only: typing again, or reopening the list, searches scoped again.
   */
  scopeKbId?: string;
  /** The scoped topic's name, for the field's accessible name and placeholder. */
  scopeLabel?: string;
  /**
   * Layout-only overrides for the list's popover: a width utility and where
   * it aligns under the field. Default: 30rem, clamped to 33vw–100vw,
   * centred (`DEFAULT_LIST_CLASS`).
   */
  contentClassName?: string;
  contentAlign?: 'start' | 'center' | 'end';
  onOpenTopic: (hit: SearchTopicHit) => void;
  onOpenSource: (hit: SearchSourceHit) => void;
  onOpenChat: (hit: SearchChatHit) => void;
  onOpenMessage: (hit: SearchMessageHit) => void;
  /**
   * The Topics group's last row, „show all matching topics in Discover".
   * Omitted → no row (a scoped search has no catalog to hand over to).
   */
  onShowAllTopics?: (query: string) => void;
  /**
   * What the list offers while the field is EMPTY — navigation, actions,
   * recent items — the command-palette pattern: focusing the empty field
   * (click, Tab or ⌘K) opens the list on these. Typing replaces them with
   * search results. Omitted or all-empty → the empty field opens nothing.
   */
  defaultGroups?: SearchDefaultGroup[];
}

/* ⌘K on Apple platforms, Ctrl+K elsewhere — the convention of every
   command-palette search (GitHub, Slack, Linear, the shadcn docs). Read once:
   the platform does not change while the page is open. */
const IS_APPLE = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

function isSearchShortcut(e: KeyboardEvent): boolean {
  return e.key.toLowerCase() === 'k'
    && (IS_APPLE ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)
    && !e.altKey && !e.shiftKey;
}

/** Writes the field element to both the internal and the caller's ref. */
function assignRef<T>(ref: ForwardedRef<T>, el: T | null) {
  if (typeof ref === 'function') ref(el);
  else if (ref) ref.current = el;
}

/** A snippet's highlight runs as text nodes inside `<mark>` — never markup. */
function Snippet({ text }: { text: string }) {
  return (
    <>
      {splitSnippet(text).map((part, i) =>
        part.highlight ? (
          <mark key={i} className="rounded-sm bg-primary-container text-on-primary-container">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** Name on top, one muted line under it. Layout lives on the span, not the DS item. */
function HitText({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate">{primary}</span>
      {secondary ? <span className="truncate text-xs text-on-surface-variant">{secondary}</span> : null}
    </span>
  );
}

export const GlobalSearch = forwardRef<HTMLInputElement, GlobalSearchProps>(function GlobalSearch(
  {
    query, onQueryChange, scopeKbId, scopeLabel, contentClassName = DEFAULT_LIST_CLASS, contentAlign = 'center',
    onOpenTopic, onOpenSource, onOpenChat, onOpenMessage, onShowAllTopics, defaultGroups,
  },
  ref,
) {
  const { t } = useTheme();
  const { state, search, hasSearched } = useGlobalSearch();

  /* ⌘K / Ctrl+K focuses the field from anywhere on the page. The shell header
     and a topic workspace each mount their own instance, in different views,
     so only one is mounted at a time; a field inside a hidden or inert
     subtree ignores the key all the same. */
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const setFieldRef = useCallback((el: HTMLInputElement | null) => {
    fieldRef.current = el;
    assignRef(ref, el);
  }, [ref]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const field = fieldRef.current;
      if (e.defaultPrevented || !isSearchShortcut(e) || !field || field.closest('[hidden], [inert]')) return;
      e.preventDefault();
      field.focus();
      field.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const [open, setOpen] = useState(false);
  /* Widened past `scopeKbId` for the current query (KI-838). Mirrored in a
     ref because `ComboboxInput` calls `onValueChange` and then
     `onOpenChange` in ONE event, before a re-render: the open handler must
     see the reset the keystroke just made, not the value it closed over. */
  const [widened, setWidenedState] = useState(false);
  const widenedRef = useRef(false);
  const setWidened = (next: boolean) => {
    widenedRef.current = next;
    setWidenedState(next);
  };
  /* The widen row is a `ComboboxItem`, and the DS closes the list after every
     item's `onSelect`. For that one row the close is refused here — the whole
     point is to show the widened results in the same open list. */
  const keepOpen = useRef(false);
  const scoped = !!scopeKbId && !widened;

  const handleQuery = (next: string) => {
    onQueryChange(next);
    setWidened(false);
    search(next, scopeKbId);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && keepOpen.current) {
      keepOpen.current = false;
      return;
    }
    const reopening = next && !open;
    setOpen(next);
    if (!next) return;
    // A fresh instance can hold remembered text it never searched for (the
    // chrome was rebuilt after the Discover row). ↓ then opens the list, so
    // ask for results rather than opening onto nothing. Typing never reaches
    // this branch: `ComboboxInput` fires `onValueChange` — and so `search` —
    // before it asks to open.
    if (!hasSearched()) {
      search(query, scopeKbId);
      return;
    }
    // Widening lasts for one query: reopening the list starts scoped again.
    if (reopening && widenedRef.current) {
      setWidened(false);
      search(query, scopeKbId);
    }
  };

  const widen = () => {
    keepOpen.current = true;
    setWidened(true);
    search(query);
  };

  /** Leaves the chrome for a hit: the text has done its job. */
  const leaveWith = (go: () => void) => {
    onQueryChange('');
    setWidened(false);
    search('');
    go();
  };

  const trimmed = query.trim();
  const defaults = (defaultGroups ?? []).filter((g) => g.items.length > 0);
  const showDefaults = trimmed === '' && defaults.length > 0;
  /* The empty field opens onto the defaults on focus and on a click into an
     already-focused field (after Escape closed the list). With text in it,
     focus keeps today's behaviour: ↓ or typing opens the list. */
  const openDefaults = () => {
    if (showDefaults && !open) setOpen(true);
  };
  const results = !showDefaults && state.status === 'done' ? state.results : null;
  // Scoped mode drops the Topics group: every hit is in the one topic anyway.
  const topics = results && !scoped ? results.topics : [];
  const nothingFound = !!results && topics.length + results.sources.length
    + results.chats.length + results.messages.length === 0;
  // The row is offered once a scoped request has settled, found or not —
  // an empty topic and a vanished one are exactly when it helps most.
  const offerWiden = !showDefaults && scoped && (state.status === 'done' || state.status === 'not-found');
  const fieldLabel = scoped && scopeLabel
    ? t('workspaceSearchPlaceholder').replace('{topic}', scopeLabel)
    : t('globalSearchPlaceholder');

  return (
    <Combobox
      shouldFilter={false}
      open={open && (isSearchableQuery(query) || showDefaults)}
      onOpenChange={handleOpenChange}
    >
      <ComboboxInput
        ref={setFieldRef}
        aria-label={fieldLabel}
        aria-keyshortcuts={IS_APPLE ? 'Meta+K' : 'Control+K'}
        placeholder={fieldLabel}
        leadingIcon={<Search aria-hidden="true" />}
        shortcutHint={(
          <KbdGroup>
            <Kbd>{IS_APPLE ? '⌘' : t('kbdCtrl')}</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        )}
        value={query}
        onValueChange={handleQuery}
        onFocus={openDefaults}
        onClick={openDefaults}
      />
      <ComboboxContent className={contentClassName} align={contentAlign}>
        {!showDefaults && state.status === 'loading' ? (
          <ComboboxLoading label={t('globalSearchLoading')}>{t('globalSearchLoading')}</ComboboxLoading>
        ) : null}
        {!showDefaults && state.status === 'rate-limited' ? (
          <p role="status" className="m-0 px-3 py-6 text-center text-sm text-on-surface-variant">
            {t('globalSearchRateLimited')}
          </p>
        ) : null}
        {!showDefaults && state.status === 'not-found' ? (
          <p role="status" className="m-0 px-3 py-6 text-center text-sm text-on-surface-variant">
            {t('workspaceSearchTopicUnavailable')}
          </p>
        ) : null}
        {/* Scoped and empty: the widen row is still an option, so the DS
            `ComboboxEmpty` (which renders only for zero options) cannot say it. */}
        {offerWiden && nothingFound ? (
          <p role="status" className="m-0 px-3 py-6 text-center text-sm text-on-surface-variant">
            {t('workspaceSearchNoResults').replace('{query}', trimmed)}
          </p>
        ) : null}
        {!showDefaults && state.status === 'error' ? (
          <p role="status" className="m-0 px-3 py-6 text-center text-sm text-on-surface-variant">
            {t('globalSearchError')}
          </p>
        ) : null}
        {results && !offerWiden ? (
          <ComboboxEmpty>{t('globalSearchNoResults').replace('{query}', trimmed)}</ComboboxEmpty>
        ) : null}
        <ComboboxList label={t('globalSearchResults')}>
          {showDefaults ? defaults.map((group) => (
            <ComboboxGroup key={group.heading} heading={group.heading}>
              {group.items.map((item) => (
                <ComboboxItem key={item.id} value={`default:${item.id}`} onSelect={item.onSelect}>
                  {item.icon}
                  <HitText primary={item.label} />
                </ComboboxItem>
              ))}
            </ComboboxGroup>
          )) : null}
          {results ? (
            <>
              {topics.length > 0 ? (
                <ComboboxGroup heading={t('globalSearchGroupTopics')}>
                  {topics.map((hit) => (
                    <ComboboxItem
                      key={hit.id}
                      value={`topic:${hit.id}`}
                      onSelect={() => leaveWith(() => onOpenTopic(hit))}
                    >
                      <BookOpen aria-hidden="true" />
                      <HitText primary={hit.name} secondary={hit.description ?? undefined} />
                    </ComboboxItem>
                  ))}
                  {onShowAllTopics ? (
                    <ComboboxItem
                      value="topic:show-all-in-discover"
                      onSelect={() => onShowAllTopics(trimmed)}
                    >
                      <Compass aria-hidden="true" />
                      <HitText primary={t('globalSearchShowAllInDiscover')} />
                    </ComboboxItem>
                  ) : null}
                </ComboboxGroup>
              ) : null}
              {results.sources.length > 0 ? (
                <ComboboxGroup heading={t('globalSearchGroupSources')}>
                  {results.sources.map((hit) => (
                    <ComboboxItem
                      key={hit.id}
                      value={`source:${hit.id}`}
                      onSelect={() => leaveWith(() => onOpenSource(hit))}
                    >
                      <FileText aria-hidden="true" />
                      <HitText primary={hit.name} secondary={hit.kbName} />
                    </ComboboxItem>
                  ))}
                </ComboboxGroup>
              ) : null}
              {results.chats.length > 0 ? (
                <ComboboxGroup heading={t('globalSearchGroupChats')}>
                  {results.chats.map((hit) => (
                    <ComboboxItem
                      key={hit.id}
                      value={`chat:${hit.id}`}
                      onSelect={() => leaveWith(() => onOpenChat(hit))}
                    >
                      <MessageSquare aria-hidden="true" />
                      <HitText primary={hit.title} secondary={hit.kbName} />
                    </ComboboxItem>
                  ))}
                </ComboboxGroup>
              ) : null}
              {results.messages.length > 0 ? (
                <ComboboxGroup heading={t('globalSearchGroupMessages')}>
                  {results.messages.map((hit) => (
                    <ComboboxItem
                      key={hit.id}
                      value={`message:${hit.id}`}
                      onSelect={() => leaveWith(() => onOpenMessage(hit))}
                    >
                      <TextQuote aria-hidden="true" />
                      <HitText primary={hit.chatTitle} secondary={<Snippet text={hit.snippet} />} />
                    </ComboboxItem>
                  ))}
                </ComboboxGroup>
              ) : null}
            </>
          ) : null}
          {offerWiden ? (
            <>
              {!nothingFound ? <ComboboxSeparator alwaysRender /> : null}
              <ComboboxItem value="scope:all-topics" onSelect={widen}>
                <Globe aria-hidden="true" />
                <HitText primary={t('workspaceSearchAllTopics')} />
              </ComboboxItem>
            </>
          ) : null}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
});
