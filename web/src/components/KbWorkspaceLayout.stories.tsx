import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor, within } from 'storybook/test';
import { AppShellLayout, Button, SidebarPanel, Logo, type MobilePaneTab } from '@ki4jlu/design-system';
import { ArrowLeft, History, MessageSquare, Settings } from 'lucide-react';
import { WorkspaceSearchField } from './WorkspaceSearch';
import { apiMockHistory } from '../../.storybook/mockApi';
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
 * WHAT IS REAL HERE: the shell, the stylesheets, Chromium's box model — and,
 * since both columns became the design system's `SidebarPanel`, the column
 * frame itself. `HistoryPanel` and `SourcesPanel` render exactly this
 * component with their headings as `title`, so nothing about the nesting is
 * copied any more; only the column contents (which cannot move a heading)
 * are left out.
 * ------------------------------------------------------------------------- */

/** The left column, as `HistoryPanel` renders it: a DS `SidebarPanel`. */
const HistoryHeading = () => (
  <SidebarPanel title={<span data-testid="left-heading">Verlauf</span>} />
);

/** The right column, as `SourcesPanel` renders it: the same `SidebarPanel`. */
const SourcesHeading = () => (
  <SidebarPanel title={<span data-testid="right-heading">Quellen hinzufügen</span>} />
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

/* ---------------------------------------------------------------------------
 * ACCEPTANCE: the workspace bar WITH the topic-scoped search, CENTRED
 * (cards KI-838, KI-844; design-system 0.44.1).
 *
 * WHAT IT GUARDS. The bar carries four things — back button and title
 * (`pageLabel`), the search (`search`, the centre slot) and the system-prompt
 * gear (`headerActions`). The search must sit on the bar's centre (developer,
 * 2026-09-29: „the combobox has to sit centred in the KB view"), the bar has
 * to stay 64px (`Toast.css`'s `top: 76px`), the title must keep at least 120px,
 * nothing may overlap, and the open list must hang under the field without the
 * bar clipping it. jsdom performs no layout; only Chromium can say any of that.
 *
 * NEGATIVE CONTROL (recorded, KI-838 blocker, same story, same case, the same
 * `search`-slot placement on design-system 0.44.0): label region 16px, title
 * **0px**, the 448px centre region overlapped by the back button and the gear
 * by 4px each. 0.44.0's centre was `w-full max-w-md min-w-0` and never gave
 * way; 0.44.1 (DS KI-842) shrinks it 28rem → 8rem first, still centred, while
 * both side regions keep an 11rem floor. For this case that is
 * 560 − 2×24 gutter − 2×16 gap − 2×176 floor = 128px of search.
 *
 * WHAT IS REAL: the shell, the stylesheets, `WorkspaceSearchField` — the exact
 * markup `KbWorkspaceLayout` puts in the `search` slot, minus the context
 * reads — `GlobalSearch`, the DS Combobox, and `GET /api/search` through the
 * story API mock. The pageLabel and gear are rebuilt from the same DS
 * `Button`s `KbWorkspaceLayout.tsx` uses; the title is a deliberately LONG
 * name, the worst case for width.
 *
 * THE MEASURED CASE is the one that failed: the runner's fixed 1280px viewport
 * (vitest.config.ts) with both columns open at the app's default 320px
 * (`useSidebarResize`). Below `lg` the slot is not rendered at all.
 * // TODO: re-measure at exactly `lg` (1024px) with both columns open — not
 * // yet confirmed.
 *
 * ORACLES: Chromium's layout (`getBoundingClientRect`, `elementFromPoint`,
 * `scrollWidth`), the bar's own centre (computed from the bar's box, not from
 * anything the app reports), the constant 64 in `Toast.css`, the 120px title
 * minimum, the API mock's request log for `kb_id`, `document.activeElement`.
 * ------------------------------------------------------------------------- */

const LONG_TOPIC = 'Prüfungs- und Studienordnungen des Fachbereichs Wirtschaftswissenschaften';

const WorkspaceBarHarness = () => {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  return (
    <AppShellLayout
      logo={<Logo product="RAG" />}
      nav={<HistoryHeading />}
      navLabel="Verlauf"
      pageLabel={
        <span className="flex min-w-0 items-center gap-2">
          <Button type="button" variant="ghost" size="icon" aria-label="Zurück zur Übersicht" className="shrink-0">
            <ArrowLeft size={20} aria-hidden="true" />
          </Button>
          <span className="truncate" data-testid="topic-title">{LONG_TOPIC}</span>
        </span>
      }
      search={
        <WorkspaceSearchField
          kbId="kb-1"
          kbName={LONG_TOPIC}
          onOpenTopic={fn()}
          onOpenSource={fn()}
          onOpenChat={fn()}
        />
      }
      headerActions={
        <Button type="button" variant="ghost" size="icon" aria-label="System-Prompt">
          <Settings size={20} aria-hidden="true" />
        </Button>
      }
      leftOpen={leftOpen}
      onLeftOpenChange={setLeftOpen}
      leftWidth={320}
      rightPanel={{
        content: <SourcesHeading />,
        label: 'Quellen',
        isOpen: rightOpen,
        onOpenChange: setRightOpen,
        width: 320,
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

export const WorkspaceBarWithScopedSearch: StoryObj<typeof WorkspaceBarHarness> = {
  render: () => <WorkspaceBarHarness />,
  beforeEach: () => {
    localStorage.setItem('language', 'de');
  },
  parameters: {
    api: {
      search: {
        query: 'Mo', kbId: 'kb-1', topics: [],
        sources: [{ id: 'f-1', name: 'Modulhandbuch.pdf', type: 'pdf', kbId: 'kb-1', kbName: LONG_TOPIC, match: 'prefix' }],
        chats: [{ id: 'c-1', title: 'Modulwahl', type: 'chat', kbId: 'kb-1', kbName: LONG_TOPIC, updatedAt: '2026-09-20T10:00:00Z', match: 'prefix' }],
        messages: [{ id: 'm-1', chatId: 'c-2', chatTitle: 'Pflichtmodule', chatType: 'chat', kbId: 'kb-1', kbName: LONG_TOPIC, role: 'assistant', snippet: 'die \uE000Module\uE001 A und B', createdAt: '2026-09-20T10:00:00Z' }],
      },
    },
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const doc = canvasElement.ownerDocument;
    const body = within(doc.body);
    const wrapper = canvas.getByTestId('workspace-search');
    const bar = wrapper.closest('header') as HTMLElement;
    await expect(bar).not.toBeNull();
    await expect(bar.getBoundingClientRect().height).toBe(64);
    const barBox = bar.getBoundingClientRect();

    const back = canvas.getByRole('button', { name: 'Zurück zur Übersicht' }).getBoundingClientRect();
    const title = canvas.getByTestId('topic-title').getBoundingClientRect();
    const field = wrapper.getBoundingClientRect();
    const gear = canvas.getByRole('button', { name: 'System-Prompt' }).getBoundingClientRect();
    const describe = `bar ${JSON.stringify(barBox)} back ${JSON.stringify(back)} title ${JSON.stringify(title)} field ${JSON.stringify(field)} gear ${JSON.stringify(gear)}`;

    // The title stays readable: at least 120px (PM acceptance criterion).
    await expect(title.width, describe).toBeGreaterThanOrEqual(120);
    // All four are real boxes inside the bar…
    for (const box of [back, title, field, gear]) {
      await expect(box.width, describe).toBeGreaterThan(0);
      await expect(box.left, describe).toBeGreaterThanOrEqual(barBox.left);
      await expect(box.right, describe).toBeLessThanOrEqual(barBox.right + 0.5);
    }
    // The search is centred on the BAR (not in the space the label leaves).
    const offset = (field.left + field.right) / 2 - (barBox.left + barBox.right) / 2;
    await expect(Math.abs(offset), describe).toBeLessThanOrEqual(1);
    // …in this order, with no overlap between neighbours.
    await expect(back.right, describe).toBeLessThanOrEqual(title.left + 0.5);
    await expect(title.right, describe).toBeLessThanOrEqual(field.left + 0.5);
    await expect(field.right, describe).toBeLessThanOrEqual(gear.left + 0.5);
    // Nothing overflows the bar horizontally.
    await expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);

    // The scope is in the accessible name.
    const input = canvas.getByRole('combobox', { name: `In „${LONG_TOPIC}“ suchen…` });
    await userEvent.type(input, 'Mo');
    const listbox = await body.findByRole('listbox', { name: 'Suchergebnisse' });
    const options = await within(listbox).findAllByRole('option');

    // ORACLE: the request log — the scoped request carried kb_id.
    const history = apiMockHistory();
    await expect(history?.get.map((r) => r.url).filter((u) => u?.includes('/api/search'))).toEqual([
      expect.stringMatching(/\/api\/search\?q=Mo&kb_id=kb-1$/),
    ]);

    // Open: still 64px; the list is outside the bar, BELOW the field, centred
    // under it (`align="center"`), and stays in the viewport.
    await expect(bar.getBoundingClientRect().height).toBe(64);
    await expect(bar.contains(listbox)).toBe(false);
    const inputBox = input.getBoundingClientRect();
    const popup = (listbox.closest('[data-radix-popper-content-wrapper]') ?? listbox) as HTMLElement;
    const popupBox = popup.getBoundingClientRect();
    await expect(popupBox.top).toBeGreaterThanOrEqual(inputBox.bottom);
    await expect(Math.abs((popupBox.left + popupBox.right) / 2 - (inputBox.left + inputBox.right) / 2)).toBeLessThanOrEqual(1);
    await expect(popupBox.left).toBeGreaterThanOrEqual(0);
    await expect(popupBox.right).toBeLessThanOrEqual(doc.documentElement.clientWidth);
    // …and wider than the (at this width 128px) field, so a row is readable.
    await expect(popupBox.width).toBeGreaterThan(inputBox.width);

    // Not clipped or covered: the browser hit-tests the last option.
    const last = options[options.length - 1];
    await expect(last).toHaveAccessibleName('In allen Themen suchen');
    last.scrollIntoView({ block: 'nearest' });
    const lastBox = last.getBoundingClientRect();
    await expect(lastBox.top).toBeGreaterThan(bar.getBoundingClientRect().bottom);
    const hit = doc.elementFromPoint(lastBox.left + lastBox.width / 2, lastBox.top + lastBox.height / 2);
    await expect(last.contains(hit)).toBe(true);
    await expect(doc.activeElement).toBe(input);

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(body.queryByRole('listbox')).toBeNull());
    await expect(bar.getBoundingClientRect().height).toBe(64);
  },
};
