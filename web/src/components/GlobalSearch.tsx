import { forwardRef, useState, type ReactNode } from 'react';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxLoading,
} from '@ki4jlu/design-system';
import { BookOpen, Compass, FileText, MessageSquare, Search, TextQuote } from 'lucide-react';
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

export interface GlobalSearchProps {
  /** The field text. Held by the caller so it survives a remount. */
  query: string;
  onQueryChange: (next: string) => void;
  /** Restrict every group to one topic (KI-838's workspace search). */
  scopeKbId?: string;
  onOpenTopic: (hit: SearchTopicHit) => void;
  onOpenSource: (hit: SearchSourceHit) => void;
  onOpenChat: (hit: SearchChatHit) => void;
  onOpenMessage: (hit: SearchMessageHit) => void;
  /**
   * The Topics group's last row, „show all matching topics in Discover".
   * Omitted → no row (a scoped search has no catalog to hand over to).
   */
  onShowAllTopics?: (query: string) => void;
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
  { query, onQueryChange, scopeKbId, onOpenTopic, onOpenSource, onOpenChat, onOpenMessage, onShowAllTopics },
  ref,
) {
  const { t } = useTheme();
  const { state, search, hasSearched } = useGlobalSearch({ scopeKbId });
  const [open, setOpen] = useState(false);

  const handleQuery = (next: string) => {
    onQueryChange(next);
    search(next);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    // A fresh instance can hold remembered text it never searched for (the
    // chrome was rebuilt after the Discover row). ↓ then opens the list, so
    // ask for results rather than opening onto nothing. Typing never reaches
    // this branch: `ComboboxInput` fires `onValueChange` — and so `search` —
    // before it asks to open.
    if (next && !hasSearched()) search(query);
  };

  /** Leaves the chrome for a hit: the text has done its job. */
  const leaveWith = (go: () => void) => {
    onQueryChange('');
    search('');
    go();
  };

  const trimmed = query.trim();
  const results = state.status === 'done' ? state.results : null;

  return (
    <Combobox
      shouldFilter={false}
      open={open && isSearchableQuery(query)}
      onOpenChange={handleOpenChange}
    >
      <ComboboxInput
        ref={ref}
        aria-label={t('globalSearchPlaceholder')}
        placeholder={t('globalSearchPlaceholder')}
        leadingIcon={<Search aria-hidden="true" />}
        value={query}
        onValueChange={handleQuery}
      />
      <ComboboxContent>
        {state.status === 'loading' ? (
          <ComboboxLoading label={t('globalSearchLoading')}>{t('globalSearchLoading')}</ComboboxLoading>
        ) : null}
        {state.status === 'rate-limited' ? (
          <p role="status" className="m-0 px-3 py-6 text-center text-sm text-on-surface-variant">
            {t('globalSearchRateLimited')}
          </p>
        ) : null}
        {state.status === 'error' ? (
          <p role="status" className="m-0 px-3 py-6 text-center text-sm text-on-surface-variant">
            {t('globalSearchError')}
          </p>
        ) : null}
        {results ? (
          <ComboboxEmpty>{t('globalSearchNoResults').replace('{query}', trimmed)}</ComboboxEmpty>
        ) : null}
        <ComboboxList label={t('globalSearchResults')}>
          {results ? (
            <>
              {results.topics.length > 0 ? (
                <ComboboxGroup heading={t('globalSearchGroupTopics')}>
                  {results.topics.map((hit) => (
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
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
});
