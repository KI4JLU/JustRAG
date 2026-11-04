import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, MouseSensor, TouchSensor, closestCenter, pointerWithin,
  useDndContext, useDroppable, useSensor, useSensors,
  type Active, type Announcements, type Collision, type CollisionDetection, type DragEndEvent, type Over, type ScreenReaderInstructions,
} from '@dnd-kit/core';
import {
  SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripHorizontal } from 'lucide-react';
import { Button } from '@ki4jlu/design-system';

/* ---------------------------------------------------------------------------
 * Drag-to-reorder for grids of cards, in one or more GROUPS (the favorites and
 * the rest). A card sorts within its group; dropped into another group it
 * MOVES there, and the caller decides what that means (favorite / not).
 *
 * THE WHOLE CARD IS THE MOUSE/TOUCH HANDLE. A mouse drag starts after 6px of
 * movement, so a click still opens the card. Touch takes a LONG PRESS: a swipe
 * still scrolls the page and a tap still opens the card. While the finger
 * holds, the card sinks a little over the press time, so the user sees the
 * press being counted; when the drag starts the phone gives a short buzz
 * (where `navigator.vibrate` exists — not on iOS). The press must not turn into
 * the browser's own long-press: text selection, the iOS callout and Android's
 * context menu are off on the cells. The click a drag ends with is swallowed —
 * otherwise dropping a card would also open it.
 *
 * THE KEYBOARD HANDLE IS A BUTTON IN THE CARD (`SortableHandle`), not the cell:
 * the cell holds the card's own buttons, and a focusable cell around them would
 * nest interactive controls. dnd-kit only starts a keyboard drag on the node
 * registered as the activator, so Space on the title or the star stays theirs.
 * The handle reaches the card through context, which keeps the card free of
 * dnd-kit and renders nothing outside a sortable grid.
 *
 * THE DRAGGED CARD IS AN OVERLAY. It follows the pointer in a layer of its own
 * while its cell stays behind, faded: so it can cross into the other group's
 * grid, and a drop zone that appears on drag start cannot move it away from
 * the pointer.
 * ------------------------------------------------------------------------- */

/** A group's drop target is its whole area, under this id. */
const dropId = (group: string) => `group:${group}`;
const groupOfDrop = (id: string | number) => (String(id).startsWith('group:') ? String(id).slice(6) : null);

const groupOf = (entry: Active | Over | null): string | null => {
  if (!entry) return null;
  return groupOfDrop(entry.id) ?? (entry.data.current?.sortable?.containerId as string | undefined) ?? null;
};

interface HandleProps {
  setRef: (node: HTMLElement | null) => void;
  attributes: Record<string, unknown>;
}

const HandleContext = createContext<HandleProps | null>(null);

interface BoardState {
  /** When the last drop happened — the click right after it is swallowed. */
  droppedAt: React.RefObject<number>;
  /** The card a finger is long-pressing, before the drag starts. */
  pressingId: string | null;
}
const BoardContext = createContext<BoardState | null>(null);

/** The long press that starts a touch drag. */
const LONG_PRESS_MS = 300;

/** The keyboard handle; `null` outside a sortable grid. */
export function SortableHandle({ label, className }: { label: string; className?: string }) {
  const handle = useContext(HandleContext);
  if (!handle) return null;
  const { setRef, attributes } = handle;
  return (
    <Button
      ref={setRef}
      variant="ghost"
      size="icon"
      {...attributes}
      className={className}
      aria-label={label}
      title={label}
      // A click on the grip must not open the card.
      onClick={e => e.stopPropagation()}
    >
      <GripHorizontal size={16} aria-hidden="true" />
    </Button>
  );
}

function SortableCell({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id });
  const board = useContext(BoardContext);
  const pressing = board?.pressingId === id;

  /* iOS Safari starts its own long-press gesture — selecting the word under
     the finger (the card title) — unless the selection is refused: CSS alone
     (`user-select: none`) does not stop it on every iOS version, a cancelled
     `selectstart` does. React has no `onSelectStart`, hence the listener. */
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const setRefs = useCallback((node: HTMLDivElement | null) => {
    nodeRef.current = node;
    setNodeRef(node);
  }, [setNodeRef]);
  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const refuse = (e: Event) => e.preventDefault();
    node.addEventListener('selectstart', refuse);
    return () => node.removeEventListener('selectstart', refuse);
  }, []);
  // Mouse and touch start on the whole cell. Events from a portaled menu still
  // bubble through the React tree; only presses inside the cell's own DOM count.
  const { onKeyDown, ...pointerListeners } = listeners ?? {};
  const fromInside = (handler: unknown) => (e: React.SyntheticEvent) => {
    if (typeof handler === 'function' && e.currentTarget.contains(e.target as Node)) handler(e);
  };
  const handle = useMemo<HandleProps>(
    () => ({ setRef: setActivatorNodeRef, attributes: { ...attributes, onKeyDown } }),
    [setActivatorNodeRef, attributes, onKeyDown],
  );
  return (
    <div
      ref={setRefs}
      style={{
        transform: CSS.Translate.toString(transform),
        // The sort shift's own transition, plus the press (scale) and the fade.
        transition: [transition, `scale ${pressing ? LONG_PRESS_MS : 150}ms ease-out`, 'opacity 150ms ease-out'].filter(Boolean).join(', '),
      }}
      className={[
        // No text selection, iOS callout, tap highlight or scroll delay on a
        // long press — on the cell AND every descendant, since WebKit does not
        // carry `user-select` into every control (the title is a <button>).
        'touch-manipulation select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none]',
        '[&_*]:select-none [&_*]:[-webkit-touch-callout:none]',
        // The press being counted: the card sinks over the press time.
        pressing ? 'scale-[0.96]' : '',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
      data-dragging={isDragging || undefined}
      // Mouse convenience only, like the card's own click; the keyboard path
      // is the handle.
      role="presentation"
      onMouseDown={fromInside(pointerListeners.onMouseDown)}
      onTouchStart={fromInside(pointerListeners.onTouchStart)}
      onClickCapture={e => {
        if (!board || performance.now() - board.droppedAt.current > 300) return;
        e.stopPropagation();
        e.preventDefault();
      }}
      // Android opens its context menu on a long press; while this card is
      // being pressed or dragged the press is ours.
      onContextMenu={e => { if (pressing || isDragging) e.preventDefault(); }}
    >
      <HandleContext.Provider value={handle}>{children}</HandleContext.Provider>
    </div>
  );
}

/** Whether a card from ANOTHER group is over `group` — the drop would move it here. */
function useForeignOver(group: string): boolean {
  const { active, over } = useDndContext();
  return !!active && groupOf(active) !== group && groupOf(over) === group;
}

const FOREIGN_OVER = 'rounded-xl outline-2 outline-offset-8 outline-dashed outline-primary';

export interface SortableGroupProps {
  /** Unique within the board. */
  id: string;
  /** One id per item, in the order the items are rendered. */
  ids: string[];
  /** The items; `items[i]` belongs to `ids[i]`. */
  items: ReactNode[];
  /**
   * Renders the grid around the cells (the page's `Grid`). `ref` and
   * `className` go on the grid itself: its area is the group's drop target,
   * and no wrapper box comes between the page and its grid.
   */
  children: (cells: ReactNode[], ref: (node: HTMLElement | null) => void, className?: string) => ReactNode;
}

/** One sortable grid of a board. Its whole area takes drops from other groups. */
export function SortableGroup({ id, ids, items, children }: SortableGroupProps) {
  const { setNodeRef } = useDroppable({ id: dropId(id) });
  const foreignOver = useForeignOver(id);
  return (
    <SortableContext id={id} items={ids} strategy={rectSortingStrategy}>
      {children(
        items.map((item, i) => <SortableCell key={ids[i]} id={ids[i]}>{item}</SortableCell>),
        setNodeRef,
        foreignOver ? FOREIGN_OVER : undefined,
      )}
    </SortableContext>
  );
}

/**
 * A drop target for a group that has no cards yet, shown only while a card is
 * dragged — so an empty group can still be dropped into.
 */
export function SortableDropZone({ group, label }: { group: string; label: string }) {
  const { active } = useDndContext();
  const { setNodeRef } = useDroppable({ id: dropId(group) });
  const foreignOver = useForeignOver(group);
  if (!active) return null;
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-20 items-center justify-center rounded-xl border-2 border-dashed p-4 text-sm transition-colors ${foreignOver ? 'border-primary bg-primary/5 text-primary' : 'border-outline-variant text-on-surface-variant'}`}
    >
      {label}
    </div>
  );
}

export interface SortableBoardProps {
  /** A drop inside the card's own group, onto another card. */
  onMove: (activeId: string, overId: string) => void;
  /** A drop into another group: onto a card of it (`overId`) or its free area. */
  onMoveToGroup: (activeId: string, group: string, overId: string | null) => void;
  /** The dragged card, drawn in the overlay. */
  renderOverlay: (id: string) => ReactNode;
  announcements?: Announcements;
  screenReaderInstructions?: ScreenReaderInstructions;
  children: ReactNode;
}

export function SortableBoard({
  onMove, onMoveToGroup, renderOverlay, announcements, screenReaderInstructions, children,
}: SortableBoardProps) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A finger that moves 8px during the press is scrolling, not dragging.
    useSensor(TouchSensor, { activationConstraint: { delay: LONG_PRESS_MS, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pressingId, setPressingId] = useState<string | null>(null);

  /* Under the pointer, a CARD wins over a group's area. Over the gaps of its
     own group a card snaps to the nearest card of that group (the area would
     read as „no move" and the grid would flicker back); over another group's
     area it targets that group. Without a pointer (keyboard) the arrow keys
     have already moved the card onto a target's top-left corner — a card, or
     an empty group's drop zone — so the target is the one whose corner it
     sits on; a card wins the tie with its own group's area. */
  const collision: CollisionDetection = args => {
    if (!args.pointerCoordinates) {
      const { left, top } = args.collisionRect;
      let best: Collision | null = null;
      let bestDistance = Infinity;
      for (const container of args.droppableContainers) {
        const rect = args.droppableRects.get(container.id);
        if (!rect) continue;
        const distance = Math.hypot(rect.left - left, rect.top - top);
        const isCard = groupOfDrop(container.id) === null;
        const tie = Math.abs(distance - bestDistance) < 1;
        if ((!tie && distance < bestDistance) || (tie && isCard && best && groupOfDrop(best.id) !== null)) {
          best = { id: container.id, data: { droppableContainer: container, value: distance } };
          bestDistance = distance;
        }
      }
      return best ? [best] : [];
    }
    const hits = pointerWithin(args);
    const cardHit = hits.find(h => groupOfDrop(h.id) === null);
    if (cardHit) return [cardHit];
    const areaHit = hits.find(h => groupOfDrop(h.id) !== null);
    // Outside every grid and drop zone: no target, so a release there cancels.
    if (!areaHit) return [];
    const own = groupOf(args.active);
    if (groupOfDrop(areaHit.id) !== own) return [areaHit];
    const sameGroup = args.droppableContainers.filter(c =>
      groupOfDrop(c.id) === null && (c.data.current?.sortable?.containerId as string | undefined) === own);
    return closestCenter({ ...args, droppableContainers: sameGroup });
  };

  // The click that ends a mouse drag lands on the card; swallow a click that
  // follows a drop within a moment. A time window rather than a flag, because
  // a drop released outside every card is followed by no click to reset it.
  const droppedAt = useRef(0);
  const board = useMemo<BoardState>(() => ({ droppedAt, pressingId }), [pressingId]);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    droppedAt.current = performance.now();
    setActiveId(null);
    setPressingId(null);
    if (!over) return;
    const from = groupOf(active);
    const to = groupOf(over);
    const overCard = groupOfDrop(over.id) === null ? String(over.id) : null;
    if (to && from !== to) onMoveToGroup(String(active.id), to, overCard);
    else if (overCard && overCard !== active.id) onMove(String(active.id), overCard);
  };

  return (
    <BoardContext.Provider value={board}>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        // A drop zone appears on drag start and moves the grid below it.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        // Pending fires for the mouse's 6px too; only a delay is a long press.
        onDragPending={({ id, constraint }) => { if ('delay' in constraint) setPressingId(String(id)); }}
        onDragAbort={() => setPressingId(null)}
        onDragStart={({ active, activatorEvent }) => {
          setActiveId(String(active.id));
          setPressingId(null);
          if (typeof TouchEvent !== 'undefined' && activatorEvent instanceof TouchEvent) navigator.vibrate?.(10);
        }}
        onDragCancel={() => { setActiveId(null); setPressingId(null); }}
        onDragEnd={onDragEnd}
        // The live region and the instructions go to <body>, not after the
        // grid: inline they would become the page container's last children.
        accessibility={{ announcements, screenReaderInstructions, container: document.body }}
      >
        {children}
        {/* Lifted: a little larger, with a shadow — under a finger the card
            would otherwise read as not moving at all. The scale sits one level
            down: dnd-kit measures the overlay's only child, and a scaled one
            would put the keyboard's target corners 3px off the cards'. */}
        <DragOverlay>
          {activeId ? (
            <div className="h-full">
              <div className="h-full scale-[1.03] rounded-xl shadow-xl">{renderOverlay(activeId)}</div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </BoardContext.Provider>
  );
}
