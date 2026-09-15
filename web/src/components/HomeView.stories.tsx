import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, waitFor, within } from 'storybook/test';
import { HomeView } from './HomeView';
import { AuthProvider } from '../contexts/AuthContext';
import { ModalProvider } from '../contexts/ModalContext';
import { AppNavProvider } from '../contexts/AppNavContext';
import { SharingProvider } from '../contexts/SharingContext';
import { useSharing } from '../hooks/useSharing';
import { apiMockHistory } from '../../.storybook/mockApi';
import type { KnowledgeBase, User } from '../types';

/* ---------------------------------------------------------------------------
 * CHARACTERIZATION stories for the KB overview (card KI-774).
 *
 * They are not here to show that the overview is right. They are here to
 * state, in assertions a browser can re-check, what it does TODAY — so that
 * the two refactors queued behind this card (KI-770, the 38-prop rewrite, and
 * KI-696, the move onto the design system's AppShellLayout) can be judged
 * behaviour-preserving instead of eyeballed. Where current behaviour looks
 * wrong it is still pinned, and the doubt is written on the card rather than
 * repaired here.
 *
 * WHAT IS THE SEAM, AND WHAT IS THE CHARACTERIZATION.
 * `HomeView` takes 38 props today; KI-770 replaces most of them with context.
 * A story bound to those 38 names would therefore have to be rewritten by the
 * very refactor it is supposed to guard, and "the stories still pass" would
 * mean nothing. So the wiring lives in `HomeViewHarness` below — one component
 * whose body is expected to change with the refactor — and the characterization
 * lives in the play functions, which are expected NOT to. When KI-770 or KI-696
 * lands, the harness may be rewritten; an edit to a play function is a
 * behaviour change and needs a reason on the card.
 *
 * WHAT THE HARNESS MAY NOT DO, and this is the part worth reading twice.
 * It supplies providers and it supplies data. It does not supply BEHAVIOUR.
 * The one place that distinction nearly broke down is `onOpenShare`: the
 * production handler (`useSharing.handleOpenShare`, src/hooks/useSharing.ts:26)
 * opens with `e.stopPropagation()`, and it has to, because the share button
 * sits inside a card whose own onClick selects the KB. `HomeView` does not stop
 * that propagation itself — it delegates it to whoever supplies the handler.
 *
 * UPDATE (KI-770, the refactor this file was written to guard). The handler is
 * no longer a prop: it arrives through `SharingContext`, and the harness now
 * mounts the REAL `useSharing()` hook instead of the five `useState`s and the
 * hand-copied `stopPropagation()` line it used to carry. That removes the
 * mirror rather than re-pointing it — the story exercises production's own
 * handler, so the coupling can no longer be faithfully reproduced and wrong at
 * the same time. `SharingDoesNotAlsoOpenTheKb` is the story that pins it, and
 * it was the one behaviour named in advance as able to break silently. The
 * only members the harness still overrides are the clipboard pair,
 * `copyUserId` and `copySuccess` — see `StorySharingProvider` for why those
 * two cannot be the app's own in a test runner.
 *
 * UPDATE (KI-776, the SECOND refactor this file was written to guard — the move
 * onto `AppShellLayout` + `SectionedGridLayout`). The harness is unchanged: the
 * view still takes the same 18 props and the same two contexts. Every edit
 * below is in a play function, which the header above says needs a reason on
 * the card — so here is the shape of them, and KI-776 carries the detail.
 *
 * Of the assertions that moved, all but two are LOCATOR changes: the same fact,
 * read off a different element, because the shell owns the `<main>`, the
 * disclosure panels are the template's, the section count badge is a `Badge`,
 * and four of the six action-row controls are `menuitem`s inside a closed Radix
 * dropdown. The two that are genuinely BEHAVIOUR changes are stated as such at
 * the assertion:
 *   - the overview's own theme button is DELETED and the design system's
 *     three-option `ThemeToggle` is the only colour-scheme control left. That
 *     deletion is this card's whole point, and `THEME_CONTROL_NAME` — written
 *     before the migration precisely to span both vocabularies — is what turns
 *     it into evidence rather than a green run;
 *   - the layout envelope moved: one 1440px `Container` instead of a 1000px box
 *     per section, and the card grid steps down to two tracks below 1280px.
 *     Both numbers are pinned with their reason rather than quietly adjusted.
 *
 * The four behavioural oracles named in advance as MUST-NOT-CHANGE did not: the
 * owned/shared split, the unmount-on-collapse property including the second
 * `/api/kb/catalog` request, `SharingDoesNotAlsoOpenTheKb`, and the
 * single-`<h1>` count. `SharingDoesNotAlsoOpenTheKb` and
 * `ShareDialogLoadingFallback` are untouched byte-for-byte.
 *
 * MOCKING IS AT THE NETWORK BOUNDARY, per the pattern KI-728 established
 * (.storybook/mockApi.ts). `HomeView` itself issues no request — its two KB
 * lists arrive as props — but two of its children do, and both are answered
 * there rather than replaced: the discovery panel (`/api/kb-categories`,
 * `/api/kb/catalog`) and the lazily loaded members dialog
 * (`/api/kb/{id}/members`, `/api/kb/{id}/invite-links`).
 *
 * THE TWO CONTEXTS ARE THE REAL ONES. `HomeView` reads `useTheme` and
 * `useAuth`. `ThemeProvider` comes from .storybook/preview.tsx and runs the
 * app's own `useThemeAndLanguage` hook, storage seeding and all. `AuthProvider`
 * is mounted by the harness because it takes its user and its site config as
 * PROPS — there is no request behind it to intercept, so passing fixtures to
 * the real provider is the network boundary for it. Neither hook is stubbed.
 * That differs from the sibling unit suite: `HomeView.test.tsx` replaces both
 * `../contexts/ThemeContext` and `../contexts/AuthContext` with `vi.mock`
 * factories (HomeView.test.tsx:77 and :99). That is reported on card KI-774,
 * not extended here, and nothing in this file mocks the toast context.
 *
 * WHAT A STORY IN THIS FILE STRUCTURALLY CANNOT CATCH. Storybook renders a
 * component under whatever .storybook/preview.tsx supplies, so it can never
 * tell you whether the real app mounts the same providers on the route this
 * view is reached by. That is exactly how KI-740's crash passed both suites and
 * was found in a browser. These stories lower the manual QA burden for KI-770
 * and KI-696; they do not remove it, and no PASS here is evidence about the
 * assembled app.
 *
 * TIME-DEPENDENT OUTPUT IS DELIBERATELY NOT PINNED. Each card renders
 * `lastActiveLabel`, which formats `Date.now()` minus the KB's timestamp
 * through `Intl.RelativeTimeFormat`. Any fixture for it drifts with how long
 * the suite takes to reach the assertion, so the freshness line is rendered
 * but never asserted on. Pinning it would buy a flaky test, not coverage.
 *
 * A NOTE FROM KI-728 THAT APPLIES TO EVERY FILE HERE: Tailwind 4 scans story
 * sources, comments included, and a word that happens to name a utility adds a
 * rule to the production stylesheet. The build output was fingerprinted before
 * and after this file (147 files, identical aggregate digest) and the numbers
 * are on the card.
 * ------------------------------------------------------------------------- */

/* ===========================================================================
 * Fixtures
 *
 * `KnowledgeBase` and `User` are imported rather than mirrored, unlike the
 * admin stories: here they are the PROP types of the component under test, so
 * a structural copy would need a cast at the call site and a cast is exactly
 * what hides a changed contract. The mirrors below (`StoryCatalogEntry`) are
 * for wire shapes the component does not name, where a copy costs nothing and
 * keeps the fixture from following the code.
 * ======================================================================== */

const USER: User = { id: 'user-1', username: 'grace', role: 'user' };
const SYSTEM_ADMIN: User = { id: 'user-1', username: 'grace', role: 'admin' };

/** No `logo_path`, so the header falls to its icon; `imprint` makes the footer render. */
const SITE_CONFIGS: Record<string, string> = {
  imprint: 'Impressum · Justus-Liebig-Universitaet Giessen',
};

function privateKb(over: Partial<KnowledgeBase> & { id: string; name: string }): KnowledgeBase {
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

const OWNED_ONE = privateKb({ id: 'kb-own-1', name: 'Mikrobiologie Notizen', fileCount: 12, turnCount: 34 });
const OWNED_TWO = privateKb({ id: 'kb-own-2', name: 'Pruefungsprotokolle' });
const OWNED_THREE = privateKb({ id: 'kb-own-3', name: 'Seminar Datenethik' });

/**
 * A KB somebody else owns. `myRole` is what the overview splits on, and the
 * differing `userId` is what makes the owner line render on the card.
 */
const SHARED_ONE = privateKb({
  id: 'kb-shared-1',
  name: 'Fakultaetsprotokolle',
  myRole: 'edit',
  userId: 'user-9',
  ownerFirstName: 'Ada',
  ownerLastName: 'Lovelace',
  memberCount: 3,
});

function publicKb(over: Partial<KnowledgeBase> & { id: string; name: string }): KnowledgeBase {
  return {
    ...privateKb(over),
    visibility: 'public',
    isPublished: true,
    myRole: undefined,
    userId: null,
    ...over,
  };
}

const PUBLIC_ONE = publicKb({ id: 'kb-pub-1', name: 'Campus Handbuch', headerText: 'Alles zum Studienstart' });
const PUBLIC_TWO = publicKb({ id: 'kb-pub-2', name: 'IT-Sicherheitsmeldungen' });

/** Structural mirror of one `GET /api/kb/catalog` row. */
interface StoryCatalogEntry {
  id: string;
  name: string;
  description: string | null;
  subscribed: boolean;
  categoryIds: string[];
}

const CATALOG: StoryCatalogEntry[] = [
  { id: 'kb-cat-1', name: 'Bibliothek Bestandskatalog', description: 'Alle Praesenzbestaende', subscribed: false, categoryIds: [] },
  { id: 'kb-cat-2', name: 'Mensa Speiseplaene', description: null, subscribed: true, categoryIds: [] },
];

/* ===========================================================================
 * The harness
 * ======================================================================== */

/** Handlers no assertion in this file reads. Kept as spies so the Actions panel still shows them. */
const idle = () => fn();

interface HomeViewStoryArgs {
  kbs: KnowledgeBase[];
  globalKbs: KnowledgeBase[];
  user: User;
  siteConfigs: Record<string, string>;
  copySuccess: boolean;
  removingKb: boolean;
  onCopyUserId: () => void;
  onViewProfile: () => void;
  onViewAgents: () => void;
  onViewAdmin: () => void;
  onViewSharedKbs: () => void;
  onLogout: () => void;
  onCreateKB: () => void;
  onSelectKB: (kb: KnowledgeBase) => void;
  onOpenKbById: (id: string) => void;
}

/**
 * Runs the production `useSharing()` hook and publishes it, with the one
 * override a story needs to be able to drive.
 *
 * It is a separate component because the hook calls `useToast()` and
 * `useTheme()`, both of which .storybook/preview.tsx mounts ABOVE the story —
 * so the hook has to run inside that tree, not beside it.
 *
 * EXACTLY TWO MEMBERS ARE OVERRIDDEN, and both for the same reason: they are
 * the CLIPBOARD pair. `copyUserId` writes to `navigator.clipboard`, which the
 * runner does not grant and which would make the assertion a statement about
 * browser permissions; `copySuccess` is the 2s-timer flag that write sets, so
 * no interaction a story can perform reaches the confirmed state either. Both
 * were already spies/args before KI-770 and stay exactly as faithful as they
 * were. Everything else — `handleOpenShare` and its `e.stopPropagation()`
 * above all — is the app's own.
 */
function StorySharingProvider({ username, copySuccess, onCopyUserId, children }: {
  username: string;
  copySuccess: boolean;
  onCopyUserId: () => void;
  children: React.ReactNode;
}) {
  const sharing = useSharing({ username });
  return (
    <SharingProvider value={{ ...sharing, copySuccess, copyUserId: onCopyUserId }}>
      {children}
    </SharingProvider>
  );
}

/**
 * Supplies what `AuthenticatedApp.tsx`'s `view === 'home'` branch supplies, and
 * nothing else — as of KI-770 that is 18 props plus two contexts.
 *
 * `showSettings` is the one piece of state still owned here, and only because
 * the prop pair still exists. Everything that is genuinely the parent's
 * business — creating, deleting, renaming, opening settings — stays a spy,
 * because a story that faked those outcomes would be inventing behaviour
 * rather than recording this component's.
 */
function HomeViewHarness(args: HomeViewStoryArgs) {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <AuthProvider
      user={args.user}
      token="story-token"
      logout={args.onLogout}
      updateUser={idle()}
      siteConfigs={args.siteConfigs}
    >
      <ModalProvider>
        <StorySharingProvider
          username={args.user.username}
          copySuccess={args.copySuccess}
          onCopyUserId={args.onCopyUserId}
        >
          <AppNavProvider
            value={{
              /* `onViewHome` is an `idle()` spy and not an arg: on THIS view
                 the Overview row is the current page, so pressing it is a
                 no-op by construction and no story has anything to assert
                 about it. `onViewSharedKbs` IS an arg — it is the one jump
                 KI-783 added that leads somewhere from here. */
              onViewHome: idle(),
              onViewSharedKbs: args.onViewSharedKbs,
              onViewProfile: args.onViewProfile,
              onViewAdmin: args.onViewAdmin,
              onViewAgents: args.onViewAgents,
            }}
          >
            <HomeView
              kbs={args.kbs}
              globalKbs={args.globalKbs}
              currentKb={null}
              availableConfigs={[]}
              onCreateKB={args.onCreateKB}
              onSelectKB={args.onSelectKB}
              onDeleteKB={idle()}
              removingKb={args.removingKb}
              onCreateGlobalKB={idle()}
              onSubscriptionChange={idle()}
              onOpenKbById={args.onOpenKbById}
              onDeleteGlobalKB={idle()}
              onOpenGlobalKbSettings={idle()}
              onOpenKbSettings={idle()}
              onRenameKB={idle()}
              onUpdateKBSettings={idle()}
              showSettings={showSettings}
              setShowSettings={setShowSettings}
            />
          </AppNavProvider>
        </StorySharingProvider>
      </ModalProvider>
    </AuthProvider>
  );
}

/* ===========================================================================
 * Helpers shared by the play functions
 * ======================================================================== */

type Canvas = ReturnType<typeof within>;

/** The four section ids, i.e. the localStorage keys `useSectionOpen` persists. */
const SECTION_IDS = ['favorites', 'discover', 'shared', 'mine'] as const;
const SECTION_STORAGE_KEYS = SECTION_IDS.map((id) => `justrag.home.section.${id}`);

/**
 * Every accessible name a colour-scheme control carries in this codebase or in
 * the design system, in one pattern.
 *
 * The union is the point. Today the overview renders its own theme button
 * (`switchToDark` / `switchToLight`); KI-696 deletes it, because
 * `AppShellLayout` mounts the DS `ThemeToggle` unconditionally — a segmented
 * light / system / dark group whose three options are named "Helles Design",
 * "Systemdesign" and "Dunkles Design" (checked against the installed
 * v0.25.0 typings). A pattern that knew only this repo's two labels would go
 * quiet after that swap instead of reporting it, and the failure mode the
 * count exists to catch is precisely the screen that ships BOTH.
 */
const THEME_CONTROL_NAME =
  /Wechsle zum (Dunkel|Hell)-Modus|Switch to (Dark|Light) Mode|Helles Design|Systemdesign|Dunkles Design/;

/**
 * What that pattern finds AFTER the shell migration (KI-776): the design
 * system's `ThemeToggle`, which `AppShellLayout` renders in the page-label bar
 * — a segmented light / system / dark group, in DOM order.
 *
 * The three labels are GERMAN in an English session too, and that is not a
 * mistake in this file: `AppShellLayout` forwards none of `ThemeToggle`'s four
 * label props, so a bilingual consumer cannot translate them. Design-system
 * card `nhyfbxcfggpr`; deliberately not worked around locally.
 */
const DS_THEME_CONTROL_NAMES = ['Helles Design', 'Systemdesign', 'Dunkles Design'];

function themeControlNames(canvas: Canvas): string[] {
  // Annotated rather than inferred: `within` is generic, so `Canvas` above
  // widens its query results and the callback parameter would be implicitly
  // `any` — which `tsc -b` rejects and, worse, would silently accept a typo.
  const controls: HTMLElement[] = canvas.queryAllByRole('button', { name: THEME_CONTROL_NAME });
  return controls.map((el) => el.getAttribute('aria-label') ?? el.textContent ?? '');
}

/**
 * One accordion header, found by the title it shows.
 *
 * The accessible name is title + count + the sr-only expand/collapse hint, so
 * the match is anchored at the start rather than exact. Reaching for the
 * heading text is deliberate: it is what a user reads, and it survives the
 * markup changes KI-696 makes around it.
 */
function sectionTrigger(canvas: Canvas, title: string): HTMLElement {
  return canvas.getByRole('button', { name: new RegExp(`^${title}`) });
}

/**
 * The count badge rendered next to a section title, or null when the section
 * has no count.
 *
 * LOCATOR CHANGE ONLY (KI-776): the badge used to be
 * `.home-view__accordion-count`, a class this repo owned; it is now the design
 * system's `Badge`, whose class names are cva output and none of a consumer's
 * business. So it is read as the trailing number of the trigger's text — the
 * same element, found the way a user sees it. The four section titles contain
 * no digits, so a title can never be mistaken for a count.
 */
function sectionCount(canvas: Canvas, title: string): string | null {
  const match = (sectionTrigger(canvas, title).textContent ?? '').trim().match(/(\d+)$/);
  return match === null ? null : match[1];
}

/**
 * The disclosure panel belonging to one section, found through the trigger's
 * own `aria-controls` rather than through an id this repo composes.
 *
 * The id moved from `home-section-panel-<id>` to `` `${useId()}-<id>-panel` ``
 * when `SectionedGridLayout` took over, and a `useId()` value is deliberately
 * not predictable from the outside. Following the ARIA reference is also the
 * stronger locator: if it ever dangled, this helper would fail rather than
 * silently look somewhere else.
 */
function sectionPanel(canvas: Canvas, canvasElement: HTMLElement, title: string): HTMLElement {
  const id = sectionTrigger(canvas, title).getAttribute('aria-controls');
  const panel = id === null ? null : canvasElement.querySelector(`#${CSS.escape(id)}`);
  if (panel === null) throw new Error(`no panel for section "${title}"`);
  return panel as HTMLElement;
}

/**
 * Asserts a section's collapsed/expanded state through the panel, not the class.
 *
 * WHAT "COLLAPSED" MEANS NOW, and why the assertion had to change shape. The
 * old `KbAccordion` removed the panel element from the document. The template
 * keeps it — an `aria-controls` pointing at an id that exists only while open
 * would be a dangling reference — and carries `hidden`, while UNMOUNTING its
 * children. The load-bearing half is the unmount (it is what makes expanding
 * „KBs entdecken" re-read the catalog), so both halves are stated here.
 */
async function expectSectionState(panel: HTMLElement, open: boolean) {
  await expect(panel.hasAttribute('hidden')).toBe(!open);
  if (open) {
    await expect(panel.childElementCount).toBeGreaterThan(0);
  } else {
    await expect(panel.childElementCount).toBe(0);
  }
}

/**
 * Where the six controls of the deleted `home-view__actions` row live now.
 *
 * Four of them are `DropdownMenuItem`s in the sidebar's `SidebarUserMenu`, in
 * DOM order. The fifth, „Meine Agenten", became a sidebar `NavItem` and is an
 * ordinary button on the page — it is asserted separately. The sixth was the
 * overview's own theme button, and it is GONE rather than relocated: that is
 * this card's required deletion, and `THEME_CONTROL_NAME` above is what proves
 * the screen does not ship two colour-scheme controls.
 *
 * The language control's German label is an English sentence, because the
 * label names the language it switches to. Pinned as it stands.
 */
const USER_MENU_NAMES = [
  'Benutzername kopieren',
  'Mein Profil',
  'Switch to English',
  'Abmelden',
];

/**
 * Opens the sidebar's user menu and scopes queries to it.
 *
 * `screen` and not `canvas`: `DropdownMenuContent` renders through a Radix
 * PORTAL, so the open menu is a child of `document.body` and outside the
 * story's canvas element entirely. The trigger is matched on the username
 * because that is what `SidebarUserMenu` puts in its accessible name.
 */
async function openUserMenu(
  canvas: Canvas,
  userEvent: { click: (el: Element) => Promise<void> },
): Promise<Canvas> {
  await userEvent.click(canvas.getByRole('button', { name: /^@grace/ }));
  return within(await screen.findByRole('menu'));
}

/**
 * Asserts the page frame KI-776 put in place: one h1, one main, ONE navigation
 * landmark, no banner, and the skip link pointing at the content landmark.
 *
 * ORACLE, unchanged: the WAI-ARIA role mappings for `h1`, `main`, `nav`,
 * `header`, `footer` and `section[aria-label]`, resolved by
 * @testing-library/dom's implementation of them — not by anything this repo
 * computes. The counts are still what make it directional; three of them moved,
 * and each moved for a reason that is a fact about the templates:
 *
 *  - `navigation` 0 -> 1. `AppShellLayout` mounts a `Sidebar`, and a `Sidebar`
 *    is a `<nav aria-label>`. The overview genuinely had none before.
 *  - `banner` 1 -> 0. This view's own `<header>` is deleted, and `AppShell`'s
 *    top bar is `lg:hidden`, i.e. `display:none` at the runner's 1280px and out
 *    of the accessibility tree. `PageHeader`'s `<header>` sits inside
 *    `<section>`/`<main>`, which HTML-AAM maps to `generic`, not `banner`.
 *  - the skip link's TARGET is no longer the `<main>`. `AppShell` owns the
 *    `<main>` and spreads consumer props onto its root `<div>`, so the id can
 *    only be hung on `SectionedGridLayout`'s `<section>`. That the anchor still
 *    resolves — and resolves to the content landmark — is asserted, which the
 *    old version did not do.
 *
 * `main` 1 and `contentinfo` 1 are unchanged, and the `<h1>` is still the page
 * title — it is `SectionedGridLayout`'s `PageHeader` rather than this view's own
 * heading now, and there is still exactly one on the screen.
 */
async function expectPageFrame(canvas: Canvas, canvasElement: HTMLElement) {
  await expect(canvas.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  await expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('Meine Knowledge Bases');

  await expect(canvas.getAllByRole('main')).toHaveLength(1);

  await expect(canvas.getAllByRole('navigation')).toHaveLength(1);
  await expect(canvas.getByRole('navigation')).toHaveAccessibleName('Hauptnavigation');

  /* `banner` is deliberately NOT a count any more, and the reason is a
   * measurement rather than a preference.
   *
   * The view's own `<header>` (logo box, `<h1>`, subtitle) is deleted. Two
   * `<header>`s remain and neither is this repo's: `AppShell`'s below-lg top
   * bar and `PageHeader`'s. A count over them would be a statement about the
   * HARNESS, not about the page, for two measured reasons:
   *   1. @testing-library maps `<header>` to `banner` unconditionally — it does
   *      not apply HTML-AAM's „not inside main/section" scoping — so
   *      `PageHeader`'s header counts here although Chromium maps it to
   *      `generic`;
   *   2. in this runner the shell's top bar is NOT hidden: measured in the
   *      story pipeline, Tailwind's dev output emits `.lg\:hidden` BEFORE
   *      `.flex` (rule 623 vs 694), so `.flex` wins on source order and the bar
   *      renders at every width. The production stylesheet has them the right
   *      way round (byte 42387 vs 13506 in `dist/assets/index-*.css`), so this
   *      is a dev-mode JIT ordering artifact and not a defect in the app — but
   *      it does mean no story in this file can assert a `lg:` breakpoint.
   *
   * What replaces it is the fact the deletion was FOR, and it holds in both
   * environments: the page heading is inside the content landmark, not in a
   * page header above it. That is the design system's heading rule verbatim —
   * „the page heading belongs to the content template hung inside the shell".
   */
  await expect(canvas.getByRole('region', { name: 'Meine Knowledge Bases' }))
    .toContainElement(canvas.getByRole('heading', { level: 1 }));

  await expect(canvas.getAllByRole('contentinfo')).toHaveLength(1);

  /* The Home nav row's label is NOT `myKBs`. The developer decided that on
   * 2026-09-14: the page `<h1>` and the „Meine KBs" section title already carry
   * that name, and a third element with it would be both an a11y problem and an
   * ambiguous locator for `sectionTrigger` below. `aria-current` is what marks
   * it as the page one is on, and `NavItem` derives it from `active`. */
  await expect(canvas.getByRole('button', { name: 'Mein Wissen' }))
    .toHaveAttribute('aria-current', 'page');

  // The skip link is the only in-page jump the overview offers; an id rename on
  // one side alone breaks it silently, so the target is resolved, not assumed.
  const skip = canvas.getByRole('link', { name: 'Zum Inhalt springen' });
  await expect(skip).toHaveAttribute('href', '#home-main-content');
  await expect(canvasElement.querySelector('#home-main-content'))
    .toBe(canvas.getByRole('region', { name: 'Meine Knowledge Bases' }));
}

/* ===========================================================================
 * Meta
 * ======================================================================== */

const meta = {
  title: 'Views/HomeView',
  component: HomeViewHarness,
  // The overview is a full page, and two assertions read computed layout off
  // it; the default padded canvas would add an envelope the app never has.
  parameters: { layout: 'fullscreen' },
  /**
   * Determinism for two pieces of state the view reads from localStorage.
   *
   * `useSectionOpen` persists each section's open/closed state under
   * `justrag.home.section.<id>`, so a story that expands a section would
   * otherwise decide the starting state of every story after it — and in the
   * browser runner that storage is shared across the whole origin, not per
   * file. The unit suite hit this exact leak once already
   * (HomeView.test.tsx:20).
   *
   * `language` is the second: `useThemeAndLanguage` initialises it from the
   * same storage and falls back to German, and every string asserted below is
   * a German one. Seeding it here rather than in a decorator is not a style
   * choice — `beforeEach` runs before the story renders, while a decorator body
   * runs INSIDE .storybook/preview.tsx's `ThemeProvider`, i.e. after that
   * provider's state initialiser has already read the key. The same ordering
   * argument preview.tsx makes for the theme global.
   */
  beforeEach: async () => {
    SECTION_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    localStorage.setItem('language', 'de');
    return () => {
      SECTION_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    };
  },
  args: {
    kbs: [],
    globalKbs: [],
    user: USER,
    siteConfigs: SITE_CONFIGS,
    copySuccess: false,
    removingKb: false,
    onCopyUserId: fn(),
    onViewProfile: fn(),
    onViewAgents: fn(),
    onViewAdmin: fn(),
    onViewSharedKbs: fn(),
    onLogout: fn(),
    onCreateKB: fn(),
    onSelectKB: fn(),
    onOpenKbById: fn(),
  },
} satisfies Meta<typeof HomeViewHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/* ===========================================================================
 * State 1 — nothing at all
 * ======================================================================== */

/**
 * A brand-new account: no favourites, nothing shared, no KB of one's own. It
 * carries the frame assertions for the whole file, because it is the state in
 * which nothing but the frame is on the screen.
 */
export const Empty: Story = {
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    await expectPageFrame(canvas, canvasElement);

    /* ORACLE: the German source strings in src/translations.ts, read back out
     * of the rendered document, plus the WAI-ARIA disclosure contract. Four
     * sections, two of them open — and the open ones are the two `HomeView`
     * seeds `useSectionOpen` with `true`. The state is asserted twice over:
     * once on the trigger (`aria-expanded`) and once on the panel it controls
     * (`hidden` + whether its children are mounted), because the second half is
     * the one the discovery section's re-fetch depends on. */
    for (const [title, open] of [
      ['Favoriten', true],
      ['KBs entdecken', false],
      ['Mit mir geteilt', false],
      ['Meine Knowledge Bases', true],
    ] as const) {
      await expect(sectionTrigger(canvas, title))
        .toHaveAttribute('aria-expanded', String(open));
      await expectSectionState(sectionPanel(canvas, canvasElement, title), open);
    }

    // ORACLE: the fixture. Empty lists, so both counted sections read zero.
    await expect(sectionCount(canvas, 'Favoriten')).toBe('0');
    await expect(sectionCount(canvas, 'Mit mir geteilt')).toBe('0');
    await expect(sectionCount(canvas, 'Meine Knowledge Bases')).toBe('0');
    // The discovery section is the one without a count: it never receives one.
    await expect(sectionCount(canvas, 'KBs entdecken')).toBeNull();

    /* ORACLE: src/translations.ts again. Favourites shows its empty-state line;
     * "Meine KBs" has none and shows the create tile instead. The shared
     * section's empty line is ABSENT even though the section is empty, because
     * the section is collapsed and a collapsed section renders nothing at all —
     * the same unmount property the discovery story pins in requests. */
    await expect(canvas.getByText(/^Noch keine Favoriten/)).toBeInTheDocument();
    await expect(
      canvas.queryByText('Dir wurde noch keine Knowledge Base freigegeben.'),
    ).toBeNull();
    await expect(
      canvas.getByRole('button', { name: 'Neue Knowledge Base erstellen' }),
    ).toBeInTheDocument();

    /* ORACLE: WAI-ARIA accessible names. The five surviving controls of the
     * deleted `home-view__actions` row, each reachable by name in its NEW home
     * — which is what this card's acceptance criterion asks for. The totals are
     * what catch one being dropped on the way.
     *
     * The queries are scoped on purpose: „Meine Agenten" must now resolve from
     * the page (it is a sidebar `NavItem`), and the other four only from inside
     * the open user menu. A document-wide query would hide that difference,
     * which is the same reason the old version scoped to `.home-view__actions`.
     *
     * Clicking the nav row FIRST is not cosmetic: the Radix menu is modal, so
     * an outside click while it is open is swallowed by its dismiss layer and
     * would never reach the button. */
    await expect(canvas.getAllByRole('button', { name: 'Meine Agenten' })).toHaveLength(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Meine Agenten' }));
    await expect(args.onViewAgents).toHaveBeenCalledTimes(1);

    /* ORACLE: the union pattern in THEME_CONTROL_NAME, matched against the
     * whole canvas. An exact list rather than a length, so a failure names what
     * it found. The ANSWER is what this card changed: this repo's own two-state
     * button is deleted, and the design system's three-option `ThemeToggle` —
     * which `AppShellLayout` renders unconditionally — is the only
     * colour-scheme control left. A screen that shipped both would return four
     * names here, which is the failure mode this assertion exists for. */
    await expect(themeControlNames(canvas)).toEqual(DS_THEME_CONTROL_NAMES);

    const menu = await openUserMenu(canvas, userEvent);
    for (const name of USER_MENU_NAMES) {
      await expect(menu.getAllByRole('menuitem', { name })).toHaveLength(1);
    }
    await expect(menu.getAllByRole('menuitem')).toHaveLength(4);

    /* ORACLE: the spies in `args`. The click path — real pointer events through
     * the real menu item — is what proves the name resolves to something that
     * acts. Copy comes first because `HomeView` calls `preventDefault()` on its
     * `onSelect` and the menu therefore stays open; „Mein Profil" closes it, so
     * nothing may be asserted through `menu` after it. */
    await userEvent.click(menu.getByRole('menuitem', { name: 'Benutzername kopieren' }));
    await expect(args.onCopyUserId).toHaveBeenCalledTimes(1);
    await userEvent.click(menu.getByRole('menuitem', { name: 'Mein Profil' }));
    await expect(args.onViewProfile).toHaveBeenCalledTimes(1);

    // ORACLE: the fixture user. An ordinary role gets neither the admin
    // floating action nor the create-a-public-KB tile.
    await expect(canvas.queryByRole('button', { name: 'Admin-Einstellungen' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'Globale KB erstellen' })).toBeNull();

    /* THE LAYOUT ENVELOPE, and the reason it is read from the CSSOM.
     *
     * ORACLE, unchanged: Chromium's own computed style. A class-name assertion
     * would pass against a utility that compiles to nothing, which is the
     * failure mode a template swap produces; a computed value cannot.
     *
     * The NUMBERS moved, and the old version of this block said in advance that
     * they would: „SectionedGridLayout inverts that — it owns the measure — so
     * both numbers move, and moving them silently is what this catches." So
     * here is what they moved to, stated rather than dropped:
     *
     *  - the page column is now ONE `Container` inside the content template,
     *    not a 1000px box repeated per section — and its measure is 1440px,
     *    because `SectionedGridLayout` exposes no width prop and its `Container`
     *    falls to the cva default `page`. That regression is known and accepted
     *    for now (design-system card `nhyfbxcfggpr`); forcing it back with a
     *    `max-w-*` at the call site is a documented review FAIL, so the number
     *    is pinned here instead, where the developer's visual QA can weigh it;
     *  - `main` is a flex column that fills the shell, not a bare block;
     *  - the page is no longer centre-aligned text: the templates align start. */
    await expect(canvasElement.querySelector('.home-view')).toBeNull();

    const mainStyle = getComputedStyle(canvas.getByRole('main'));
    await expect(mainStyle.display).toBe('flex');
    await expect(mainStyle.flexDirection).toBe('column');

    const container = canvas
      .getByRole('region', { name: 'Meine Knowledge Bases' })
      .firstElementChild;
    await expect(container).not.toBeNull();
    await expect(getComputedStyle(container as HTMLElement).maxWidth).toBe('1440px');
  },
};

export const EmptyDark: Story = {
  ...Empty,
  globals: { theme: 'dark' },
};

/* ===========================================================================
 * State 2 — only KBs of one's own
 * ======================================================================== */

/**
 * Three KBs, all owned. This is the state that pins the client-side split:
 * `GET /api/kb` is one request and the overview sorts its rows into "Meine
 * KBs" and "Mit mir geteilt" on `myRole === 'owner'` alone (HomeView.tsx:441).
 *
 * The two count badges are the assertion, and they are deliberately read
 * WITHOUT expanding the shared section: a closed accordion still shows its
 * count, so the split can be observed in the state a user actually lands in.
 * Inverting that predicate turns 3/0 into 0/3.
 */
export const OwnedOnly: Story = {
  args: { kbs: [OWNED_ONE, OWNED_TWO, OWNED_THREE] },
  play: async ({ canvas, canvasElement }) => {
    await expectPageFrame(canvas, canvasElement);

    // ORACLE: the fixture — three rows, every one of them `myRole: 'owner'`.
    await expect(sectionCount(canvas, 'Meine Knowledge Bases')).toBe('3');
    await expect(sectionCount(canvas, 'Mit mir geteilt')).toBe('0');
    await expect(sectionCount(canvas, 'Favoriten')).toBe('0');

    // ORACLE: the fixture names, through the accessible name of each card's
    // own open control. The create tile is a fourth item in the same list.
    for (const name of ['Mikrobiologie Notizen', 'Pruefungsprotokolle', 'Seminar Datenethik']) {
      await expect(
        canvas.getByRole('button', { name: `Knowledge Base öffnen: ${name}` }),
      ).toBeInTheDocument();
    }

    /* ORACLE: the role each card exposes, and the asymmetry between the two
     * card kinds. A private card is `role="presentation"` — its click is a
     * mouse convenience and the accessible control is the name button inside.
     * A public card (see `FavoritesPopulated`) is `role="button"` instead. That
     * difference is pinned because it is easy to lose in a rewrite, not
     * because it is right; it is raised on the card. */
    const cards = canvasElement.querySelectorAll('.home-view__kb-card');
    await expect(cards).toHaveLength(3);
    for (const card of cards) {
      await expect(card).toHaveAttribute('role', 'presentation');
    }

    // ORACLE: the fixture. `memberCount: 1` and a private visibility resolve to
    // the "personal" badge; the owner gets the outright-delete label, not the
    // leave-my-view one.
    await expect(canvas.getAllByText('Persönlich')).toHaveLength(3);
    await expect(canvas.getAllByRole('button', { name: 'Knowledge Base löschen' })).toHaveLength(3);
    await expect(canvas.queryByRole('button', { name: 'Aus meiner Ansicht entfernen' })).toBeNull();

    /* ORACLE: Chromium's CSSOM, unchanged. The grid track list is the layout
     * envelope of the card area. It used to be this repo's own
     * `repeat(auto-fill, minmax(280px, 1fr))` on `.home-view__grid`; it is now
     * the design system's `Grid cols={3}`, i.e. a declared column count that
     * collapses at TAILWIND's breakpoints rather than at a width-per-card rule
     * of ours. The grid is located through the panel the section trigger
     * controls, because the class it used to answer to is gone.
     *
     * THE TRACK COUNT MOVED, 3 -> 2, and that is a real visual change rather
     * than a test detail. Measured: the story canvas is 1200px wide (not the
     * 1280 of vitest.config.ts:99 — vitest browser mode renders the story in an
     * iframe narrower than the browser viewport), and `Grid cols={3}` is
     * `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`, whose `xl` step starts at
     * 1280px. The old `repeat(auto-fill, minmax(280px, 1fr))` against a 1000px
     * section fitted three tracks at this width. So between roughly 1024 and
     * 1280px the card grid now reflows one step earlier than it used to; at
     * 1280 and above it is three columns again, which this runner cannot show.
     * Pinned as the measured value, with the reason, rather than quietly
     * adjusted — the developer's visual QA is where that band is judged.
     *
     * The gap is unchanged at 24px: `Grid`'s default `gap-gutter` resolves to
     * the same 1.5rem the hand-written grid used. */
    const grid = sectionPanel(canvas, canvasElement, 'Meine Knowledge Bases').firstElementChild;
    await expect(grid).not.toBeNull();
    const gridStyle = getComputedStyle(grid as HTMLElement);
    await expect(gridStyle.display).toBe('grid');
    await expect(gridStyle.gap).toBe('24px');
    await expect(gridStyle.gridTemplateColumns.split(' ')).toHaveLength(2);
  },
};

/* ===========================================================================
 * State 3 — favourites populated
 * ======================================================================== */

/**
 * Two public KBs in Favoriten, seen by an ordinary user. The section is open by
 * default, so this is what most people meet first.
 */
export const FavoritesPopulated: Story = {
  args: { globalKbs: [PUBLIC_ONE, PUBLIC_TWO], kbs: [OWNED_ONE] },
  play: async ({ canvas, canvasElement }) => {
    await expectPageFrame(canvas, canvasElement);

    // ORACLE: the fixture.
    await expect(sectionCount(canvas, 'Favoriten')).toBe('2');

    /* ORACLE: WAI-ARIA accessible names built from the fixture names, and an
     * ASYMMETRY between the two card kinds that is worth stating precisely.
     *
     * A public card puts `role="button"` on the list item itself and gives it
     * the full "Knowledge Base öffnen: X" name, while the name button nested
     * inside it carries no label at all and is announced as the bare KB name.
     * A private card is the other way round: the item is
     * `role="presentation"` and the nested button carries the full name. So
     * the same KB answers to two DIFFERENT names here and to one there, and
     * two controls on a public card do exactly the same thing.
     *
     * Pinned as it stands; the duplication is written up on card KI-774. */
    for (const name of ['Campus Handbuch', 'IT-Sicherheitsmeldungen']) {
      await expect(
        canvas.getAllByRole('button', { name: `Knowledge Base öffnen: ${name}` }),
      ).toHaveLength(1);
      await expect(canvas.getAllByRole('button', { name })).toHaveLength(1);
    }

    // ORACLE: src/translations.ts. The filled star on a favourite is a pure
    // favourites toggle; one per card, and nothing else on the card offers it.
    await expect(
      canvas.getAllByRole('button', { name: 'Aus Favoriten entfernen' }),
    ).toHaveLength(2);

    // ORACLE: the fixture's `visibility: 'public'`, through `visibilityState`.
    await expect(canvas.getAllByText('Öffentlich')).toHaveLength(2);
    await expect(canvas.getByText('Alles zum Studienstart')).toBeInTheDocument();

    /* ORACLE: the fixture user's role. The publish badge and the two
     * settings/delete controls on a public card are system-admin only, and an
     * ordinary user must see none of them — including on a KB nobody owns. */
    await expect(canvas.queryByText('Veröffentlicht')).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'Einstellungen bearbeiten' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'Globale Knowledge Base löschen' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'Globale KB erstellen' })).toBeNull();

    const favoriteCards = sectionPanel(canvas, canvasElement, 'Favoriten')
      .querySelectorAll('.home-view__kb-card');
    await expect(favoriteCards).toHaveLength(2);
    for (const card of favoriteCards) {
      await expect(card).toHaveAttribute('role', 'button');
    }

    // Still exactly one colour-scheme control once the page carries content —
    // the same assertion as in `Empty`, re-checked in both themes here. One
    // control, three options; not this repo's button beside it.
    await expect(themeControlNames(canvas)).toEqual(DS_THEME_CONTROL_NAMES);
  },
};

export const FavoritesPopulatedDark: Story = {
  ...FavoritesPopulated,
  globals: { theme: 'dark' },
};

/**
 * The same two favourites seen by a system admin — the branch that adds the
 * publish badge, the per-card settings and delete pair, the create tile, and
 * the floating admin action. Four separate `isSystemAdmin` reads in one view,
 * and KI-770 moves the role that drives them out of props into context.
 */
export const FavoritesAsSystemAdmin: Story = {
  args: { globalKbs: [PUBLIC_ONE, PUBLIC_TWO], kbs: [OWNED_ONE], user: SYSTEM_ADMIN },
  play: async ({ canvas, canvasElement }) => {
    await expectPageFrame(canvas, canvasElement);

    // ORACLE: src/translations.ts + the fixture's `isPublished: true`.
    await expect(canvas.getAllByText('Veröffentlicht')).toHaveLength(2);
    await expect(canvas.getAllByRole('button', { name: 'Einstellungen bearbeiten' })).toHaveLength(2);
    await expect(canvas.getAllByRole('button', { name: 'Globale Knowledge Base löschen' })).toHaveLength(2);
    await expect(canvas.getByRole('button', { name: 'Globale KB erstellen' })).toBeInTheDocument();

    /* „Admin-Einstellungen" survives as the SAME accessible name in a new home:
     * it was a floating action button pinned to the page corner, and it is the
     * third sidebar `NavItem` now. The assertion does not move, and that is the
     * point of writing it by name — but the control had to be relocated rather
     * than left in place, because the slot spec puts Admin in the nav and two
     * buttons with one name would make this very query ambiguous. */
    await expect(canvas.getByRole('button', { name: 'Admin-Einstellungen' })).toBeInTheDocument();
    await expect(canvasElement.querySelector('.home-view__admin-fab')).toBeNull();

    // The count is the LIST length and is not raised by the create tile.
    await expect(sectionCount(canvas, 'Favoriten')).toBe('2');

    // Still exactly one colour-scheme control: the admin branch adds a nav row,
    // not a second toggle.
    await expect(themeControlNames(canvas)).toEqual(DS_THEME_CONTROL_NAMES);
  },
};

/* ===========================================================================
 * State 4 — a KB somebody shared with me
 * ======================================================================== */

/**
 * One owned KB and one that arrived through a membership. The shared section is
 * closed on first visit, so this story also records what "closed" means here:
 * the panel is not in the document, and expanding it is a mount.
 */
export const SharedWithMe: Story = {
  args: { kbs: [OWNED_ONE, SHARED_ONE] },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await expectPageFrame(canvas, canvasElement);

    // ORACLE: the fixture — one row with `myRole: 'owner'`, one with 'edit'.
    await expect(sectionCount(canvas, 'Meine Knowledge Bases')).toBe('1');
    await expect(sectionCount(canvas, 'Mit mir geteilt')).toBe('1');

    /* The shared card is not merely hidden while the section is collapsed —
     * unchanged as a PROPERTY, changed in how it is read. The panel element
     * itself now stays in the document (so `aria-controls` never dangles) and
     * only its children are unmounted, so „collapsed" is asserted as `hidden`
     * plus an empty panel, and confirmed a second way through the card's own
     * accessible name being absent from the whole canvas. */
    await expectSectionState(sectionPanel(canvas, canvasElement, 'Mit mir geteilt'), false);
    await expect(canvas.queryByRole('button', { name: /Fakultaetsprotokolle/ })).toBeNull();

    await userEvent.click(sectionTrigger(canvas, 'Mit mir geteilt'));
    await expectSectionState(sectionPanel(canvas, canvasElement, 'Mit mir geteilt'), true);

    // ORACLE: the fixture name, once the section is open.
    await expect(
      await canvas.findByRole('button', { name: 'Knowledge Base öffnen: Fakultaetsprotokolle' }),
    ).toBeInTheDocument();

    /* ORACLE: src/translations.ts (`sharedBy` = "von {name}") composed with the
     * fixture's owner names. The line renders only because the KB's `userId`
     * differs from the signed-in user's — the same comparison the card makes. */
    await expect(canvas.getByText('von Ada Lovelace')).toBeInTheDocument();

    /* ORACLE: the fixture's `memberCount: 3` with a private visibility, which
     * `visibilityBadge` renders with the count appended. */
    await expect(canvas.getByText('Geteilt (3)')).toBeInTheDocument();

    /* ORACLE: the role ladder in src/utils/kbAccess.ts as the CARD applies it.
     * An 'edit' member may neither manage members, nor rename, nor open the
     * advanced settings, and their remove action is "leave", not "delete" —
     * while the owned KB beside it offers the opposite. Both halves are
     * asserted, so a change that widened the gate in either direction fails. */
    await expect(canvas.getAllByRole('button', { name: 'Teilen' })).toHaveLength(1);
    await expect(canvas.getAllByRole('button', { name: 'Knowledge Base umbenennen' })).toHaveLength(1);
    await expect(
      canvas.getByRole('button', { name: 'Aus meiner Ansicht entfernen' }),
    ).toBeInTheDocument();
    await expect(
      canvas.getAllByRole('button', { name: 'Knowledge Base löschen' }),
    ).toHaveLength(1);

    /* ORACLE: `canOpenKbAdvancedSettings` needs a SYSTEM role as well as a KB
     * one, and this fixture user has the plain 'user' role — so the sliders
     * control is offered on neither card, not even the one they own. Asserted
     * because it is the half of that predicate a KB-role-only rewrite would
     * drop without any other story noticing. */
    await expect(
      canvas.queryByRole('button', { name: 'RAG-Einstellungen und Workflow' }),
    ).toBeNull();
  },
};

/* ===========================================================================
 * Two prop-to-DOM mappings KI-770 has to carry across
 *
 * Neither is one of the five states the card enumerates. They are here because
 * the 38-prop rewrite is exactly the kind of change that drops a boolean on
 * the way into context, and a boolean that no longer reaches its control fails
 * silently: the screen still renders, it just stops responding.
 * ======================================================================== */

/**
 * `siteConfigs.logo_path` set and `imprint` unset — the other half of both
 * conditionals in the page frame — together with `copySuccess`, the prop that
 * turns the copy control into its confirmed state.
 */
export const UploadedLogoAndCopyConfirmed: Story = {
  args: {
    siteConfigs: { logo_path: '/logo-test.svg' },
    copySuccess: true,
  },
  play: async ({ canvas, userEvent }) => {
    /* ORACLE: `window.location.origin`, read from the browser. The app builds
     * this src as `API_BASE_URL + logo_path`, and .storybook/env.ts pins
     * API_BASE_URL to the serving origin — so the expected value is composed
     * from the browser's own property and the fixture, never from the app's
     * constant. The file is real (web/public/logo-test.svg), served by the
     * runner's publicDir, so this is a resolving image and not a broken one. */
    /* TWO copies, not one, and that is the shell rather than a bug: `AppShell`
     * renders the `logo` node both in the sidebar header and in the below-lg
     * top bar, and hides one of them per breakpoint with CSS. `getAllBy*` does
     * not filter on visibility, so both are in this result — asserting the
     * count is how that stays a stated fact instead of a surprise. */
    const logos = canvas.getAllByAltText('Website-Logo');
    await expect(logos).toHaveLength(2);
    for (const logo of logos) {
      await expect(logo).toHaveAttribute('src', `${window.location.origin}/logo-test.svg`);
    }

    /* ORACLE: the WAI-ARIA landmark mapping again. With no imprint there is no
     * footer and therefore no contentinfo — the same assertion `expectPageFrame`
     * makes in the opposite direction, which is what makes either of them
     * falsifiable. */
    await expect(canvas.queryAllByRole('contentinfo')).toHaveLength(0);

    /* ORACLE: Chromium's CSSOM, unchanged in kind. `copySuccess` is rendered as
     * colour AND as an icon swap, and both halves are pinned so a partial
     * rewrite that keeps one and drops the other still fails.
     *
     * WHAT MOVED: the control is a `DropdownMenuItem` in the sidebar's user menu
     * now, so the colour is carried by the CHECK ICON (`text-success`, a
     * semantic token) instead of by `.home-view__copy-btn--success` on a button
     * this repo styled. It has to be: colouring a design-system component from
     * the call site is a re-skin the guidelines forbid, and lint only warns on
     * it. So the comparison is icon-against-icon rather than button-against-
     * button — still two LIVE elements rather than one literal value, which is
     * what keeps it true under a token change and false under a lost prop. */
    const menu = await openUserMenu(canvas, userEvent);
    const copyItem = menu.getByRole('menuitem', { name: 'Benutzername kopieren' });
    const profileItem = menu.getByRole('menuitem', { name: 'Mein Profil' });

    const copyIcon = copyItem.querySelector('.lucide-check');
    const profileIcon = profileItem.querySelector('svg');
    await expect(copyIcon).not.toBeNull();
    await expect(copyItem.querySelector('.lucide-copy')).toBeNull();
    await expect(getComputedStyle(copyIcon as Element).color).not.toBe(
      getComputedStyle(profileIcon as Element).color,
    );
  },
};

/**
 * `removingKb` — the in-flight guard. One removal is running, so every remove
 * control on the page is refused, on a public card and a private one alike.
 * The prop reaches four separate call sites today.
 */
export const RemovalInFlight: Story = {
  args: { kbs: [OWNED_ONE], globalKbs: [PUBLIC_ONE], removingKb: true },
  play: async ({ canvas, userEvent }) => {
    /* ORACLE: the HTML `disabled` semantics, resolved by jest-dom's
     * `toBeDisabled` against the element's own state — not against a class.
     * The two controls carry different labels because they do different
     * things (a favourite is dropped, an owned KB is deleted), and both are
     * driven by the one boolean. */
    await expect(canvas.getByRole('button', { name: 'Aus Favoriten entfernen' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Knowledge Base löschen' })).toBeDisabled();

    // Controls that are NOT removals stay live, which is what makes the
    // assertion above about `removingKb` rather than about a disabled page.
    await expect(canvas.getByRole('button', { name: 'Teilen' })).toBeEnabled();

    /* „Abmelden" is a `DropdownMenuItem` in the sidebar's user menu now, so it
     * has to be opened to be seen, and `toBeEnabled` is the wrong matcher for
     * it: jest-dom only reads `disabled` on form elements and would pass on a
     * `role="menuitem"` div no matter what. Radix's own `data-disabled` /
     * `aria-disabled` is what it actually sets, so that is what is asserted —
     * a matcher that cannot fail is not a test. */
    const menu = await openUserMenu(canvas, userEvent);
    const logout = menu.getByRole('menuitem', { name: 'Abmelden' });
    await expect(logout).not.toHaveAttribute('data-disabled');
    await expect(logout).not.toHaveAttribute('aria-disabled', 'true');
  },
};

/* ===========================================================================
 * The discovery section — closed AND unmounted
 * ======================================================================== */

/**
 * "KBs entdecken" is the one section whose collapsed state is load-bearing
 * rather than cosmetic: `KbCatalogPanel` fetches on mount, so unmounting it on
 * collapse is what makes every expand re-read the catalog — and that is why a
 * KB published after the page loaded appears without a reload.
 *
 * Markup can only show that the panel is absent. The request log is what shows
 * that NOTHING was fetched for it and that a second expand fetches again, so
 * this story reads `apiMockHistory()` as well as the DOM.
 */
export const DiscoverSectionMountsOnExpand: Story = {
  parameters: {
    api: { kbCatalog: CATALOG, kbCategories: [] },
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const history = apiMockHistory();
    await expect(history).not.toBeNull();

    /* ORACLE: axios-mock-adapter's request log, which records every request
     * before it looks for a handler. It is independent of the component in the
     * strongest sense available here — it counts what left the app, not what
     * the app decided to draw. */
    const catalogRequests = () =>
      (history ?? []).filter((config) => /\/api\/kb\/catalog/.test(config.url ?? '')).length;

    const trigger = sectionTrigger(canvas, 'KBs entdecken');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expectSectionState(sectionPanel(canvas, canvasElement, 'KBs entdecken'), false);
    await expect(canvas.queryByLabelText('Name oder Beschreibung suchen…')).toBeNull();
    await expect(catalogRequests()).toBe(0);

    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expectSectionState(sectionPanel(canvas, canvasElement, 'KBs entdecken'), true);

    // The panel's search field is its own, and it appears with the mount.
    await expect(canvas.getByLabelText('Name oder Beschreibung suchen…')).toBeInTheDocument();

    // ORACLE: the mocked catalog rows. The fetch is debounced, hence `findBy`.
    await expect(await canvas.findByText('Bibliothek Bestandskatalog')).toBeInTheDocument();
    await waitFor(async () => {
      await expect(catalogRequests()).toBe(1);
    });

    /* Collapsing unmounts the panel's body again — the property this whole
     * story exists for, and the one `SectionedGridLayout` documents as
     * deliberate. The panel ELEMENT survives (hidden), which is why it is
     * asserted as empty rather than as absent. */
    await userEvent.click(trigger);
    await expectSectionState(sectionPanel(canvas, canvasElement, 'KBs entdecken'), false);
    await expect(canvas.queryByText('Bibliothek Bestandskatalog')).toBeNull();

    /* The property this whole story exists for: the SECOND expand issues a
     * SECOND request. A section that was merely hidden would not. */
    await userEvent.click(trigger);
    await waitFor(async () => {
      await expect(catalogRequests()).toBe(2);
    });
  },
};

/* ===========================================================================
 * State 5 — the loading state
 * ======================================================================== */

/**
 * `LoadingFallback` (HomeView.tsx:65) — three `KBCardSkeleton`s in a list
 * marked `aria-busy`. It has exactly one trigger: the `Suspense` boundary
 * around the lazily imported members dialog, shown while that chunk is in
 * flight. So the honest way to reach it is to open the dialog, which is what
 * this story does; there is no state flag that produces it.
 *
 * WHY A MutationObserver AND NOT A QUERY. The fallback is transient by
 * definition — it is replaced the moment the dynamic import settles. A
 * `findBy*` would be a race between the assertion's first poll and a module
 * fetch, and it would pass or fail depending on whether another story had
 * already warmed that chunk. The observer is armed BEFORE the click and records
 * every mutation, so it sees the fallback whether it lived for one frame or
 * fifty. What it cannot do is prove how LONG it was shown, and that is not
 * pinned here.
 *
 * KNOWN-DEFECT PIN: `aria-label="Loading..."` is a bare English literal in a
 * view whose every other string goes through `t()`, so a German-language user
 * is announced an English word. Asserted as it stands, and written up on card
 * KI-774 rather than repaired here.
 */
export const ShareDialogLoadingFallback: Story = {
  args: { kbs: [OWNED_ONE] },
  parameters: {
    api: { kbMembers: { members: [], pending: [] }, kbInviteLinks: [] },
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const seen: Array<{ label: string | null; skeletons: number }> = [];
    const observer = new MutationObserver(() => {
      const busy = canvasElement.querySelector('[aria-busy="true"]');
      if (busy !== null) {
        seen.push({
          label: busy.getAttribute('aria-label'),
          skeletons: busy.querySelectorAll('.skeleton-kb-card').length,
        });
      }
    });
    observer.observe(canvasElement, { childList: true, subtree: true });

    // Nothing is busy before the dialog is asked for.
    await expect(canvasElement.querySelector('[aria-busy="true"]')).toBeNull();

    await userEvent.click(canvas.getByRole('button', { name: 'Teilen' }));

    await waitFor(async () => {
      await expect(canvas.getByRole('dialog')).toBeInTheDocument();
    });
    observer.disconnect();

    /* ORACLE: the DOM mutations the browser reported, captured independently of
     * anything the component returns. Three skeleton cards and the untranslated
     * label are the fallback's whole contract. */
    await expect(seen.length).toBeGreaterThan(0);
    await expect(seen[0].label).toBe('Loading...');
    await expect(seen[0].skeletons).toBe(3);

    // And the state it resolves into, so the story also pins that the fallback
    // is a way-station rather than the end of the interaction.
    await expect(canvas.getByRole('dialog')).toHaveAttribute(
      'aria-labelledby',
      'members-modal-title',
    );
    await expect(canvasElement.querySelector('[aria-busy="true"]')).toBeNull();
  },
};

/* ===========================================================================
 * The one behaviour KI-770 was told in advance it could break silently
 * ======================================================================== */

/**
 * Clicking "Teilen" must open the members dialog and NOT also open the KB.
 *
 * WHY THIS STORY EXISTS. The share button sits inside a `<li>` whose own
 * `onClick` calls `onSelectKB` (HomeView.tsx, `PrivateKbCard`). `HomeView`
 * never stops that propagation: the `e.stopPropagation()` that makes the two
 * actions distinguishable lives in `useSharing.handleOpenShare`
 * (src/hooks/useSharing.ts:27) — i.e. OUTSIDE the component, in the handler its
 * caller supplies. KI-774's review named this as the single place where moving
 * the sharing concern into context could change behaviour with every other
 * story still green, and it was right: nothing else in this file clicks that
 * button and then looks at what else fired.
 *
 * ORACLE, and why it is independent of the code under test. The expectation is
 * not a number this view produces. It is the pair of `fn()` spies in `args`:
 * `onSelectKB` is the parent's callback, and the assertion is a count on it.
 * The handler doing the work is the production hook, mounted by
 * `StorySharingProvider` — so the story reads the real `useSharing` against a
 * spy the component cannot reach.
 *
 * THE CONTROL CLICK IS LOAD-BEARING. A bare "onSelectKB was not called" would
 * also pass if the card's own click handler had been lost, or the card never
 * rendered. So the card body is clicked FIRST and the count asserted at 1; the
 * share click then has to leave it at 1. One click reaches the parent, the
 * next one must not.
 *
 * Mutation-verified (card KI-770): deleting `e.stopPropagation()` from
 * useSharing.ts:27 fails this story with `expected 2 to be 1`, and fails no
 * other story in the suite.
 */
export const SharingDoesNotAlsoOpenTheKb: Story = {
  args: { kbs: [OWNED_ONE] },
  parameters: {
    api: { kbMembers: { members: [], pending: [] }, kbInviteLinks: [] },
  },
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const shareButton = canvas.getByRole('button', { name: 'Teilen' });
    const card = shareButton.closest('.home-view__kb-card');
    await expect(card).not.toBeNull();

    /* The control: the freshness line is inert markup inside the card, so a
     * click on it can only reach the parent through the `<li>`'s own handler.
     * If this is ever 0, the assertion below stops meaning anything. */
    const cardBody = (card as HTMLElement).querySelector('.home-view__kb-meta');
    await expect(cardBody).not.toBeNull();
    await userEvent.click(cardBody as HTMLElement);
    await expect(args.onSelectKB).toHaveBeenCalledTimes(1);

    await userEvent.click(shareButton);

    // The dialog did open — so the click was delivered and this is a statement
    // about propagation, not about a dead button.
    await waitFor(async () => {
      await expect(canvas.getByRole('dialog')).toBeInTheDocument();
    });
    await expect(canvasElement.querySelector('[aria-busy="true"]')).toBeNull();

    // And the KB was not opened on the way.
    await expect(args.onSelectKB).toHaveBeenCalledTimes(1);
  },
};
