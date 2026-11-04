import { describe, expect, it } from 'vitest';
import { applyOrder, moveId, placeAfter } from './useKbOrder';
import { fittingLines } from './useFittingLineClamp';

const kbs = (...ids: string[]) => ids.map(id => ({ id }));
const ids = (items: { id: string }[]) => items.map(i => i.id);

describe('applyOrder', () => {
  it('keeps the server order while nothing was dragged', () => {
    expect(ids(applyOrder(kbs('a', 'b', 'c'), []))).toEqual(['a', 'b', 'c']);
  });

  it('sorts by the stored order and puts topics it does not know first', () => {
    // 'd' is new since the last drag, 'x' is gone.
    expect(ids(applyOrder(kbs('a', 'b', 'c', 'd'), ['c', 'x', 'a', 'b']))).toEqual(['d', 'c', 'a', 'b']);
  });
});

describe('moveId', () => {
  it('moves down onto the target and up before it', () => {
    expect(moveId(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveId(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves among the visible ids the same way when hidden ones sit between', () => {
    // A filter shows a, c, e; dragging e onto a puts it first among them.
    const next = moveId(['a', 'b', 'c', 'd', 'e'], 'e', 'a');
    expect(next).toEqual(['e', 'a', 'b', 'c', 'd']);
    expect(next.filter(id => ['a', 'c', 'e'].includes(id))).toEqual(['e', 'a', 'c']);
  });

  it('leaves the order alone for an unknown id or a drop on itself', () => {
    expect(moveId(['a', 'b'], 'a', 'a')).toEqual(['a', 'b']);
    expect(moveId(['a', 'b'], 'z', 'a')).toEqual(['a', 'b']);
  });
});

describe('fittingLines', () => {
  it('counts whole lines, with half a pixel of slack, never fewer than one', () => {
    expect(fittingLines(80, 20)).toBe(4);
    expect(fittingLines(79.6, 20)).toBe(4);
    expect(fittingLines(70, 20)).toBe(3);
    expect(fittingLines(5, 20)).toBe(1);
    expect(fittingLines(80, 0)).toBe(1);
  });
});

describe('placeAfter', () => {
  it('puts the id right after the anchor, or first without one', () => {
    expect(placeAfter(['a', 'b', 'c', 'd'], 'd', 'a')).toEqual(['a', 'd', 'b', 'c']);
    expect(placeAfter(['a', 'b', 'c'], 'c', null)).toEqual(['c', 'a', 'b']);
  });
});
