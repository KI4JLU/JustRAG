import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Grid } from '@ki4jlu/design-system';
import { CreateCell, PrivateKbCard } from './KbCard';
import { TopicGridPage } from './TopicGridPage';
import { translations } from '../translations';
import { expectFooterInsideCard, expectUniformCardHeights } from '../test/kbCardGeometry';
import type { KnowledgeBase } from '../types';

/* ---------------------------------------------------------------------------
 * GEOMETRY stories for the KB card's footer (bug card KI-843).
 *
 * THE BUG, from the developer's screenshot: on „Mein Wissen" the footer chips
 * (files, messages, and the freshness chip the upstream merge ported in) plus
 * the „Privat" badge were wider than the card, and the badge was pushed out
 * over the neighbouring card. The footer is an unlayered `display: flex`
 * without wrap, and the chip group in it was `shrink-0` without wrap.
 *
 * WHAT IS REAL: `PrivateKbCard` itself, its stylesheet (`HomeView.css`, the
 * unlayered legacy rules included — they are half of the bug), the design
 * system's `Grid cols="auto"` that `TopicGridPage` lays the cards out with,
 * and Chromium's box model. Only the handlers are spies.
 *
 * THE NARROWEST CARD. `Grid cols="auto"` is
 * `repeat(auto-fill, minmax(min(17.5rem, 100%), 1fr))`: a track is never
 * narrower than 280px (unless the whole grid is), so 280px is the floor of
 * every card width the grid renders at any viewport, 1280px included. The
 * grid below is given exactly 280px, which yields exactly that one track.
 * The page-level cases (the real grid on „Mein Wissen" at the runner's width,
 * cards and list rows) are `CardFooterInsideCard` and `ListRowChipsInsideRow`
 * in `MyTopicsView.stories.tsx`.
 *
 * ORACLE: Chromium's layout via `getBoundingClientRect()` / `scrollWidth`,
 * compared against the CARD's own box measured in the same frame — never a
 * number copied from the stylesheet. NEGATIVE CONTROL: on the claim-base code
 * (55631d78) this story fails; see the card for the recorded run.
 * ------------------------------------------------------------------------- */

const t = (k: string) => (translations as Record<string, { de: string }>)[k]?.de ?? k;
const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });

function kb(over: Partial<KnowledgeBase> & { id: string; name: string }): KnowledgeBase {
  return {
    description: null,
    userId: 'user-1',
    createdAt: '2026-01-05T09:00:00Z',
    isPro: false,
    aiConfigId: null,
    chatModel: null,
    embeddingModel: null,
    rerankModel: null,
    ttsModel: null,
    visibility: 'private',
    memberCount: 1,
    myRole: 'owner',
    ...over,
  };
}

/** The screenshot's case: files, messages, freshness, „Privat". */
const SCREENSHOT_KB = kb({
  id: 'kb-1', name: 'Mikrobiologie Notizen', fileCount: 36, turnCount: 1284,
  lastActivityAt: new Date(Date.now() - 86_400_000).toISOString(),
  newestFileAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
});
/** A wider badge („Geteilt (12)") and a processing chip on top: the worst case. */
const WORST_KB = kb({
  id: 'kb-2', name: 'Prüfungsordnungen des Fachbereichs', fileCount: 1204, turnCount: 98765,
  processingFileCount: 3, newestFileAt: '2019-03-01T00:00:00Z', memberCount: 12,
});

function Card({ item, compact = false }: { item: KnowledgeBase; compact?: boolean }) {
  return (
    <PrivateKbCard
      kb={item}
      currentUserId="user-1"
      systemRole="user"
      removingKb={false}
      rtf={rtf}
      t={t}
      language="de"
      compact={compact}
      onSelectKB={fn()}
      onOpenShare={fn()}
      onToggleFavourite={fn()}
      onOpenKbSettings={fn()}
      onRenameKB={fn()}
      onDeleteKB={fn()}
    />
  );
}

function Frame({ width, children }: { width: number; children: ReactNode }) {
  return <div style={{ width }} data-testid="frame">{children}</div>;
}

const meta = {
  title: 'Views/KbCard',
  component: Card,
  parameters: { layout: 'padded' },
  beforeEach: () => {
    localStorage.setItem('language', 'de');
  },
} satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Two cards at the grid's narrowest track (280px): the screenshot and the worst case. */
export const FooterInsideCardAtNarrowestTrack: Story = {
  args: { item: SCREENSHOT_KB },
  render: () => (
    <Frame width={280}>
      <Grid cols="auto" gap="gutter">
        <Card item={SCREENSHOT_KB} />
        <Card item={WORST_KB} />
      </Grid>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const cards = Array.from(canvasElement.querySelectorAll<HTMLElement>('.home-view__kb-card'));
    await expect(cards).toHaveLength(2);
    for (const card of cards) {
      // The track really is the 280px floor, not a wider accident.
      await expect(Math.round(card.getBoundingClientRect().width)).toBe(280);
      await expectFooterInsideCard(card);
    }
  },
};

/* ---------------------------------------------------------------------------
 * The developer's mockup (card KI-848): title + ⋮, then „Genutzt gestern",
 * „Aktualisiert vor 7 Tagen", and a footer of count chips left and „Privat"
 * right. Rendered in `TopicGridPage` with `uniformRows` — the exact grid
 * „Mein Wissen" and „Geteiltes Wissen" use — next to the three other shapes a
 * card can take: shared (with the owner line), no files (no „Aktualisiert"
 * line, no chips) and the create tile. Four cells, so at least two rows.
 *
 * ORACLES: Chromium's layout through the two shared helpers — everything
 * inside each card, meta lines above the footer, the badge right-aligned, one
 * height for all cells across rows and the footers at one distance from the
 * bottom (`expectFooterInsideCard`, `expectUniformCardHeights`) — plus the
 * visible label text, spelled out in German here.
 * ------------------------------------------------------------------------- */

const now = Date.now();
const MOCKUP_KB = kb({
  id: 'kb-m1', name: 'FAQ Test', fileCount: 36, turnCount: 53,
  lastActivityAt: new Date(now - 86_400_000).toISOString(),
  newestFileAt: new Date(now - 7 * 86_400_000).toISOString(),
});
const SHARED_KB = kb({
  id: 'kb-m2', name: 'Fakultätsprotokolle', userId: 'user-9', myRole: 'edit', memberCount: 3,
  ownerFirstName: 'Ada', ownerLastName: 'Lovelace', fileCount: 8, turnCount: 2,
  lastActivityAt: new Date(now - 3 * 3_600_000).toISOString(),
  newestFileAt: new Date(now - 40 * 86_400_000).toISOString(),
});
const NO_FILES_KB = kb({ id: 'kb-m3', name: 'Neues leeres Thema' });

export const MockupCardsInUniformGrid: Story = {
  args: { item: MOCKUP_KB },
  render: () => (
    <Frame width={900}>
      <TopicGridPage
        id="kb-card-mockup"
        title="Mein Wissen"
        uniformRows
        createCell={<CreateCell onClick={fn()} label="Neues Thema" text="Neues Thema" />}
        items={[MOCKUP_KB, SHARED_KB, NO_FILES_KB].map((item) => <Card key={item.id} item={item} />)}
      />
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const cards = Array.from(canvasElement.querySelectorAll<HTMLElement>('.home-view__kb-card'));
    await expect(cards).toHaveLength(3);
    for (const card of cards) await expectFooterInsideCard(card);
    await expectUniformCardHeights(canvasElement);

    const [mockup, shared, noFiles] = cards;
    // The mockup's two lines, label then value.
    await expect(mockup.querySelector('[data-testid="kb-meta-used"]')).toHaveTextContent(/^Genutzt gestern$/);
    await expect(mockup.querySelector('[data-testid="kb-meta-updated"]')).toHaveTextContent(/^Aktualisiert vor 7 Tagen$/);
    await expect(mockup.querySelector('.home-view__badge')).toHaveTextContent('Privat');
    // Shared: the owner line; no files: no „Aktualisiert" line and no chips.
    await expect(shared.querySelector('[data-testid="kb-meta-owner"]')).toHaveTextContent('von Ada Lovelace');
    await expect(noFiles.querySelector('[data-testid="kb-meta-updated"]')).toBeNull();
    await expect(noFiles.querySelectorAll('.home-view__chip')).toHaveLength(0);
  },
};
