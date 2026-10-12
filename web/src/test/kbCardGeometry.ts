import { expect } from 'storybook/test';

/* Shared by the KB-card geometry stories (bug card KI-843): the card-level
 * story at the grid's narrowest track (`KbCard.stories.tsx`) and the page-level
 * one on „Mein Wissen" (`MyTopicsView.stories.tsx`). ORACLE: Chromium's layout,
 * each element compared with the CARD's own box measured in the same frame. */

/**
 * Asserts that every meta line, chip and the badge of `card` lie inside the
 * card's box (meta lines above the footer),
 * that the badge overlaps no chip and sits at the footer's right edge, and
 * that neither the card nor its footer overflows horizontally.
 */
export async function expectFooterInsideCard(card: HTMLElement) {
  const footer = card.querySelector<HTMLElement>('.home-view__card-footer');
  await expect(footer).not.toBeNull();
  const box = card.getBoundingClientRect();
  const footerBox = footer!.getBoundingClientRect();
  const chips = Array.from(footer!.querySelectorAll<HTMLElement>('.home-view__chip'));
  const badge = footer!.querySelector<HTMLElement>('.home-view__badge');
  // KI-848: the meta lines („Genutzt", „Aktualisiert", owner) must be inside
  // the card too. Chips are optional — a topic with no files and no messages
  // has none, and the badge alone must still sit right.
  const metaLines = Array.from(card.querySelectorAll<HTMLElement>('[data-testid^="kb-meta-"]'));
  await expect(metaLines.length).toBeGreaterThan(0);
  await expect(badge).not.toBeNull();
  const badgeBox = badge!.getBoundingClientRect();
  const where = (el: HTMLElement) => `${el.textContent} ${JSON.stringify(el.getBoundingClientRect())} in card ${JSON.stringify(box)}`;

  for (const el of [...metaLines, ...chips, badge!]) {
    const r = el.getBoundingClientRect();
    await expect(r.width, where(el)).toBeGreaterThan(0);
    await expect(r.left, where(el)).toBeGreaterThanOrEqual(box.left - 0.5);
    await expect(r.right, where(el)).toBeLessThanOrEqual(box.right + 0.5);
    await expect(r.top, where(el)).toBeGreaterThanOrEqual(box.top - 0.5);
    await expect(r.bottom, where(el)).toBeLessThanOrEqual(box.bottom + 0.5);
  }
  // The badge overlaps no chip, and it is right-aligned in the footer.
  for (const chip of chips) {
    const r = chip.getBoundingClientRect();
    const overlaps = r.left < badgeBox.right && r.right > badgeBox.left && r.top < badgeBox.bottom && r.bottom > badgeBox.top;
    await expect(overlaps, `${where(chip)} vs badge ${where(badge!)}`).toBe(false);
  }
  await expect(Math.abs(badgeBox.right - footerBox.right), where(badge!)).toBeLessThanOrEqual(1);
  await expect(footer!.scrollWidth).toBeLessThanOrEqual(footer!.clientWidth);
  await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
  // Every meta line sits above the footer, not over it.
  for (const line of metaLines) {
    await expect(line.getBoundingClientRect().bottom, where(line)).toBeLessThanOrEqual(footerBox.top + 0.5);
  }
}


/**
 * „All cards always the same height" (developer, KI-843 scope addition): every
 * KB card AND the create tile in the grid share one height, across rows, and
 * every card's footer sits at the same distance from its card's bottom edge.
 * Requires at least two grid rows, so a single stretched row cannot pass it.
 *
 * ORACLE: Chromium's layout. The expected height is not a number written here —
 * it is the FIRST cell's height, measured in the same frame; tolerance ±0.5px.
 */
export async function expectUniformCardHeights(root: HTMLElement) {
  const cards = Array.from(root.querySelectorAll<HTMLElement>('.home-view__kb-card'));
  const create = root.querySelector<HTMLElement>('.home-view__create-card');
  const cells = create ? [create, ...cards] : cards;
  await expect(cards.length).toBeGreaterThanOrEqual(3);
  const boxes = cells.map((el) => el.getBoundingClientRect());
  const rows = new Set(boxes.map((b) => Math.round(b.top)));
  await expect(rows.size, `row tops ${[...rows].join(', ')}`).toBeGreaterThanOrEqual(2);

  const heights = boxes.map((b) => b.height);
  const report = cells.map((el, i) => `${el.textContent?.slice(0, 24)}: ${heights[i].toFixed(2)}`).join(' | ');
  for (const h of heights) {
    await expect(Math.abs(h - heights[0]), report).toBeLessThanOrEqual(0.5);
  }

  // Footers pinned to the bottom: the same gap to the card's bottom edge.
  const gaps = cards.map((card) => {
    const footer = card.querySelector<HTMLElement>('.home-view__card-footer')!;
    return card.getBoundingClientRect().bottom - footer.getBoundingClientRect().bottom;
  });
  for (const g of gaps) {
    await expect(Math.abs(g - gaps[0]), `footer gaps ${gaps.map((x) => x.toFixed(2)).join(', ')}`).toBeLessThanOrEqual(0.5);
  }
}
