import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Grid } from '@ki4jlu/design-system';
import { PrivateKbCard } from './KbCard';
import { translations } from '../translations';
import { expectFooterInsideCard } from '../test/kbCardGeometry';
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
  oldestFileAt: '2025-06-01T00:00:00Z',
});
/** A wider badge („Geteilt (12)") and a processing chip on top: the worst case. */
const WORST_KB = kb({
  id: 'kb-2', name: 'Prüfungsordnungen des Fachbereichs', fileCount: 1204, turnCount: 98765,
  processingFileCount: 3, oldestFileAt: '2019-03-01T00:00:00Z', memberCount: 12,
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
