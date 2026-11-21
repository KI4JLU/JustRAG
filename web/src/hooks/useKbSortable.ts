import { useMemo } from 'react';
import type { Announcements } from '@dnd-kit/core';
import type { KnowledgeBase } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { PINNED_GROUP, type TopicGridPageProps } from '../components/TopicGridPage';
import { placeAfter, moveId, type KbOrder } from './useKbOrder';

export interface KbSortableInput {
  order: KbOrder;
  /** The displayed favorites and the displayed rest — the two groups. */
  favorites: KnowledgeBase[];
  rest: KnowledgeBase[];
  /** The whole ordered list the chip filter took them from (favorites first). */
  all: KnowledgeBase[];
  /** Flips a topic's favorite flag (optimistic, see `useKnowledgeBases`). */
  onToggleFavorite: (kb: KnowledgeBase) => void;
}

/**
 * The topic grid's `sortable` prop. A drop within a group reorders; a drop
 * into the OTHER group also makes the topic a favorite (into the favorites)
 * or no longer one (into the rest) — and places it where it was dropped.
 * Orders are computed over `all`, so a drop under a filter keeps the hidden
 * topics in place.
 */
export function useKbSortable({ order, favorites, rest, all, onToggleFavorite }: KbSortableInput): NonNullable<TopicGridPageProps['sortable']> {
  const { t } = useTheme();
  return useMemo(() => {
    const shown = [...favorites, ...rest];
    const byId = new Map(shown.map(kb => [kb.id, kb]));
    const allIds = all.map(kb => kb.id);
    const groupLabel = (group: string) => t(group === PINNED_GROUP ? 'kbGroupFavorites' : 'kbGroupOthers');
    const isGroup = (id: string | number) => String(id).startsWith('group:');

    const fill = (key: string, id: string | number, at?: string | number) => {
      const ids = (byId.get(String(at ?? id))?.isFavorite ? favorites : rest).map(kb => kb.id);
      return t(key)
        .replace('{name}', byId.get(String(id))?.name ?? '')
        .replace('{group}', at !== undefined && isGroup(at) ? groupLabel(String(at).slice(6)) : '')
        .replace('{n}', String(ids.indexOf(String(at ?? id)) + 1))
        .replace('{total}', String(ids.length));
    };
    const announcements: Announcements = {
      onDragStart: ({ active }) => fill('kbDragStart', active.id),
      onDragOver: ({ active, over }) => {
        if (!over) return undefined;
        return fill(isGroup(over.id) ? 'kbDragOverGroup' : 'kbDragOver', active.id, over.id);
      },
      onDragEnd: ({ active, over }) => fill(over && isGroup(over.id) ? 'kbDragEndGroup' : 'kbDragEnd', active.id, over?.id),
      onDragCancel: ({ active }) => fill('kbDragCancel', active.id),
    };

    return {
      ids: rest.map(kb => kb.id),
      pinnedIds: favorites.map(kb => kb.id),
      dropZoneLabel: t('kbDropToFavorite'),
      restDropZoneLabel: t('kbDropToUnfavorite'),
      onMove: (activeId: string, overId: string) => order.move(allIds, activeId, overId),
      onMoveToGroup: (activeId: string, group: string, overId: string | null) => {
        const kb = byId.get(activeId);
        if (!kb) return;
        const toFavorites = group === PINNED_GROUP;
        // Onto a card: where it stands. Onto the free area: after the last
        // favorite, or at the end of the rest.
        let next: string[];
        if (overId) next = moveId(allIds, activeId, overId);
        else if (toFavorites) next = placeAfter(allIds, activeId, favorites.at(-1)?.id ?? null);
        else next = [...allIds.filter(id => id !== activeId), activeId];
        order.set(next);
        if (!!kb.isFavorite !== toFavorites) onToggleFavorite(kb);
      },
      announcements,
      screenReaderInstructions: { draggable: t('kbDragInstructions') },
    };
  }, [order, favorites, rest, all, onToggleFavorite, t]);
}
