import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { AppShellLayout, Logo, type MobilePaneTab } from '@ki4jlu/design-system';
import { History, MessageSquare } from 'lucide-react';
import './sidebar-primitives.css';
import './history/HistoryPanel.css';
import './sidebar/SourcesGrid.css';
import './sources/SourcesPanel.css';

/* ---------------------------------------------------------------------------
 * GEOMETRY story for the two KB columns (no card — ad-hoc developer request,
 * 18.09.2026).
 *
 * WHAT IT GUARDS. „Verlauf" heads the left column, „Quellen hinzufügen" heads
 * the right one, and they are meant to sit on ONE baseline. Nothing in the
 * repo could see whether they do: jsdom performs no layout, so the unit suite
 * reads both as `top: 0`, and a class-name assertion passes against a rule
 * that compiled to nothing.
 *
 * WHY THE TWO SIDES NEEDED DIFFERENT NUMBERS — the thing this story exists to
 * pin. The design system pads the two slots differently, and neither number is
 * this repo's:
 *   - `AppShellLayout` wraps `nav` in `<nav class="… p-4">` (16px), and
 *     `.history-panel` adds 1.5rem (24px) of its own = 40px.
 *   - `AppShell` wraps a panel's `content` in a plain `<div>` with NO padding,
 *     so `.sources-grid` starts at 0 and has to supply all 40px itself.
 * A change to either — a design-system bump that re-pads a slot, or someone
 * "tidying" `.history-panel` — moves one heading and not the other. That is
 * what the offset below catches.
 *
 * ORACLE: Chromium's own layout, read back through `getBoundingClientRect()`.
 * The expected value is not a number written down here: it is the OTHER
 * heading's position, measured in the same frame. So the story cannot agree
 * with a wrong layout the way a hardcoded 40 could.
 *
 * THE HONEST CAVEAT, because it limits what a green run means. The heading
 * markup below is REBUILT, not imported: `HistoryPanel` and `SourcesGrid` each
 * pull half a dozen contexts, and wiring those up would put more of this
 * story's own code between the stylesheet and the measurement, not less. What
 * is real here is the shell, the stylesheets and Chromium's box model; what is
 * copied is the element nesting. If either component changes its wrapper
 * structure, this story keeps passing while the app moves — so the nesting
 * below is repeated verbatim from those two files and must be updated with
 * them.
 * // TODO: mounting the real components behind provider decorators would close
 * // that gap and is not done here.
 * ------------------------------------------------------------------------- */

/** The left column's heading row, as `HistoryPanel` nests it. */
const HistoryHeading = () => (
  <div className="history-panel">
    <div className="sidebar-ui__section-header">
      <h2 className="sidebar-ui__section-title" data-testid="left-heading">Verlauf</h2>
    </div>
  </div>
);

/** The right column's heading, as `SourcesGrid` nests it inside `SourcesPanel`. */
const SourcesHeading = () => (
  <div className="sidebar-left__sources" style={{ height: '100%' }}>
    <div className="sources-grid">
      <h2 className="sources-grid__title" data-testid="right-heading">Quellen hinzufügen</h2>
    </div>
  </div>
);

const mobileTabs: MobilePaneTab[] = [
  { id: 'history', icon: <History aria-hidden="true" />, label: 'Verlauf', pane: 'left' },
  { id: 'chat', icon: <MessageSquare aria-hidden="true" />, label: 'Chat', pane: 'main' },
];

const Harness = () => {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  return (
    <AppShellLayout
      logo={<Logo product="RAG" />}
      nav={<HistoryHeading />}
      navLabel="Verlauf"
      pageLabel={<span>TEST</span>}
      leftOpen={leftOpen}
      onLeftOpenChange={setLeftOpen}
      rightPanel={{
        content: <SourcesHeading />,
        label: 'Quellen',
        isOpen: rightOpen,
        onOpenChange: setRightOpen,
        // Keine Breite — wie in KbWorkspaceLayout.tsx, damit beide Spalten die
        // des Design-Systems nehmen.
        expandLabel: 'Quellenleiste ausklappen',
        collapseLabel: 'Quellenleiste einklappen',
      }}
      mobileTabs={mobileTabs}
      activeMobileTab="chat"
      onMobileTabChange={() => {}}
      mobileTabBarLabel="Bereich wechseln"
    />
  );
};

const meta: Meta<typeof Harness> = {
  title: 'KB/KbWorkspaceLayout',
  component: Harness,
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Harness>;

export const KbColumnHeadingBaseline: Story = {
  play: async ({ canvas }) => {
    const left = canvas.getByTestId('left-heading');
    const right = canvas.getByTestId('right-heading');

    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();

    // Both are real boxes. A heading collapsed to zero height would be
    // "aligned" with anything, which is how this assertion could lie.
    await expect(leftRect.height).toBeGreaterThan(0);
    await expect(rightRect.height).toBeGreaterThan(0);

    // And they really are in two different columns, not stacked — otherwise
    // any vertical comparison between them would be meaningless.
    await expect(rightRect.left).toBeGreaterThan(leftRect.right);

    /* ORACLE: each heading is checked against the OTHER one, measured in the
     * same frame — never against a number copied out of the stylesheet. So
     * this cannot agree with a wrong layout the way a hardcoded 85.5 could.
     *
     * Vertical CENTRES, not tops: both headings now sit in a 32px row, so
     * equal centres is what „same baseline" means for two boxes of one type.
     *
     * WHAT IT TOOK, and it was one number on each side. The left column had
     * `.history-panel`'s own 1.5rem ON TOP of the `p-4` that `AppShellLayout`
     * already gives the nav slot — 40px where the right column had 0. The
     * right column then had to pick up that `p-4` by hand (`.sources-grid`),
     * because `AppShell` wraps a panel's `content` in a <div> with no padding
     * at all, plus the 32px row height the left gets for free from its
     * „Neuer Chat" button. A design-system bump that re-pads either slot moves
     * one heading and not the other, which is what this catches.
     *
     * TOLERANCE: 1px for sub-pixel rounding. The two defects it caught while
     * being written were 40px and 5.5px.
     */
    const leftCentre = leftRect.top + leftRect.height / 2;
    const rightCentre = rightRect.top + rightRect.height / 2;
    await expect(Math.abs(leftCentre - rightCentre)).toBeLessThanOrEqual(1);

    /* GLEICHE SPALTENBREITE und GLEICHE SEITLICHE EINRÜCKUNG.
     *
     * Beides ist aus derselben Ecke schiefgegangen: bis Design-System 0.35.0
     * reichte `AppShellLayout` für die linke Spalte KEINE Breite durch (sie
     * war die 256px des Design-Systems) und legt ihren Inhalt in `p-4`,
     * während `AppShell` den `content` einer Spalte in ein <div> ohne
     * Polsterung legt. Ungeprüft standen hier 256px gegen 500px und 16px
     * gegen 24px. Seit 0.36.0 gibt es `leftWidth`/`leftResize` und beide
     * Spalten sind ziehbar; die App startet beide bei 320px
     * (`useSidebarResize`). Diese Story lässt beide Breiten weg und misst den
     * Fall „keine Breite gesetzt" — die Aussage ist, dass die Shell beide
     * Spalten gleich behandelt, wenn die App nichts vorgibt.
     *
     * ORACLE: die eine Seite gegen die andere, in derselben Messung.
     */
    const leftPanel = left.closest('aside');
    const rightPanel = right.closest('aside');
    await expect(leftPanel).not.toBeNull();
    await expect(rightPanel).not.toBeNull();

    const lp = (leftPanel as HTMLElement).getBoundingClientRect();
    const rp = (rightPanel as HTMLElement).getBoundingClientRect();
    await expect(lp.width).toBe(rp.width);

    // Abstand der Überschrift zum jeweils eigenen Spaltenrand: links vom
    // linken Rand, rechts vom linken Rand der rechten Spalte.
    await expect(Math.abs((leftRect.left - lp.left) - (rightRect.left - rp.left))).toBeLessThanOrEqual(1);
  },
};
