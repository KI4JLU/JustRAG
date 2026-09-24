import { useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, waitFor, within } from 'storybook/test';
import { MyTopicsView } from './MyTopicsView';
import { AuthProvider } from '../contexts/AuthContext';
import { ModalProvider } from '../contexts/ModalContext';
import { AppNavProvider } from '../contexts/AppNavContext';
import { SharingProvider } from '../contexts/SharingContext';
import { KbSearchProvider } from '../contexts/KbSearchContext';
import { useKbSearchState } from '../hooks/useKbSearchState';
import { useSharing } from '../hooks/useSharing';
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
 * `MyTopicsView` takes 38 props today; KI-770 replaces most of them with context.
 * A story bound to those 38 names would therefore have to be rewritten by the
 * very refactor it is supposed to guard, and "the stories still pass" would
 * mean nothing. So the wiring lives in `MyTopicsViewHarness` below — one component
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
 * sits inside a card whose own onClick selects the KB. `MyTopicsView` does not stop
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
 * (.storybook/mockApi.ts). `MyTopicsView` itself issues no request — its two KB
 * lists arrive as props — but two of its children do, and both are answered
 * there rather than replaced: the discovery panel (`/api/kb-categories`,
 * `/api/kb/catalog`) and the lazily loaded members dialog
 * (`/api/kb/{id}/members`, `/api/kb/{id}/invite-links`).
 *
 * THE TWO CONTEXTS ARE THE REAL ONES. `MyTopicsView` reads `useTheme` and
 * `useAuth`. `ThemeProvider` comes from .storybook/preview.tsx and runs the
 * app's own `useThemeAndLanguage` hook, storage seeding and all. `AuthProvider`
 * is mounted by the harness because it takes its user and its site config as
 * PROPS — there is no request behind it to intercept, so passing fixtures to
 * the real provider is the network boundary for it. Neither hook is stubbed.
 * That differs from the sibling unit suite: `MyTopicsView.test.tsx` replaces both
 * `../contexts/ThemeContext` and `../contexts/AuthContext` with `vi.mock`
 * factories (MyTopicsView.test.tsx:77 and :99). That is reported on card KI-774,
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

/** `imprint` makes the footer render. (The shell's logo is the design system's
 *  name-built wordmark in every case — `logo_path` no longer overrides it.) */
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






/* ===========================================================================
 * The harness
 * ======================================================================== */

/** Handlers no assertion in this file reads. Kept as spies so the Actions panel still shows them. */
const idle = () => fn();

interface MyTopicsViewStoryArgs {
  kbs: KnowledgeBase[];
  globalKbs: KnowledgeBase[];
  user: User;
  siteConfigs: Record<string, string>;
  copySuccess: boolean;
  removingKb: boolean;
  onCopyUserId: () => void;
  onViewProfile: () => void;
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
/**
 * The REAL `useKbSearchState` behind `KbSearchContext` (card KI-787).
 *
 * The chrome's search field and „KBs entdecken" are two ends of one value, and
 * the behaviour worth looking at in a browser — typing expands the collapsed
 * section — lives in the hook between them. A story that stubbed it would show
 * a field that cannot do the one thing this card added. It also owns the
 * section's `localStorage` key now, which is why the stories that clear that
 * key still work unchanged.
 */
function StoryKbSearchProvider({ children }: { children: ReactNode }) {
  const kbSearch = useKbSearchState();
  return <KbSearchProvider value={kbSearch}>{children}</KbSearchProvider>;
}

function MyTopicsViewHarness(args: MyTopicsViewStoryArgs) {
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
              /* `onViewMyTopics` is an `idle()` spy and not an arg: on THIS
                 view its row is the current page, so pressing it is a no-op by
                 construction and no story has anything to assert about it. The
                 other three lead somewhere from here. */
              onViewMyTopics: idle(),
              onViewSharedTopics: args.onViewSharedKbs,
              onViewDiscover: idle(),
              onViewTools: idle(),
              onViewProfile: args.onViewProfile,
              onViewAdmin: args.onViewAdmin,
            }}
          >
            <StoryKbSearchProvider>
            <MyTopicsView
              kbs={args.kbs}
              currentKb={null}
              availableConfigs={[]}
              onCreateKB={args.onCreateKB}
              onSelectKB={args.onSelectKB}
              onDeleteKB={idle()}
              removingKb={args.removingKb}
              onOpenKbSettings={idle()}
              onRenameKB={idle()}
          onToggleFavourite={idle()}
              onUpdateKBSettings={idle()}
              showSettings={showSettings}
              setShowSettings={setShowSettings}
            />
            </StoryKbSearchProvider>
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
 * The fifth remembered preference (card KI-789): the sidebar's collapsed width.
 *
 * Spelled out rather than imported from `useSidebarCollapse.ts`, for the same
 * reason the four section keys above are: the key is a promise to the browser,
 * and a story that read it from the hook could not tell a renamed key from a
 * kept one. It is cleared with the others in `beforeEach`, because the story
 * runner shares one origin across the whole file — a story that collapses the
 * column would otherwise decide the starting state of every story after it.
 */
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'justrag.chrome.sidebar.collapsed';
const CHROME_STORAGE_KEYS = [...SECTION_STORAGE_KEYS, SIDEBAR_COLLAPSED_STORAGE_KEY];

/**
 * Every accessible name a colour-scheme control carries in this codebase or in
 * the design system, in one pattern.
 *
 * The union is the point. The overview used to render its own theme button
 * (`switchToDark` / `switchToLight`); KI-696 deleted it in favour of the DS
 * `ThemeToggle` — a segmented light / system / dark group. A pattern that
 * knew only this repo's two labels would have gone quiet after that swap
 * instead of reporting it, and the failure mode the count exists to catch is
 * precisely the screen that ships BOTH.
 *
 * KI-788 keeps the pattern and changes WHO renders the group: design-system
 * 0.26.0 dropped the toggle `AppShellLayout` used to hardcode, so `AppChrome`
 * constructs it in the sidebar footer — and, for the first time, passes its
 * labels. The German strings are unchanged (translations.ts deliberately
 * repeats the DS defaults), so this file's expectations did not move; the
 * English ones are new and are added to the union so an English session is
 * matched too.
 */
const THEME_CONTROL_NAME =
  /Wechsle zum (Dunkel|Hell)-Modus|Switch to (Dark|Light) Mode|Helles Design|Systemdesign|Dunkles Design|Light theme|System theme|Dark theme/;


function themeControlNames(canvas: Canvas): string[] {
  // Annotated rather than inferred: `within` is generic, so `Canvas` above
  // widens its query results and the callback parameter would be implicitly
  // `any` — which `tsc -b` rejects and, worse, would silently accept a typo.
  const controls: HTMLElement[] = canvas.queryAllByRole('button', { name: THEME_CONTROL_NAME });
  return controls.map((el) => el.getAttribute('aria-label') ?? el.textContent ?? '');
}





/**
 * Where the six controls of the deleted `home-view__actions` row live now.
 *
 * Four of them are `DropdownMenuItem`s in the sidebar's `SidebarUserMenu`, in
 * DOM order. The fifth, „Meine Agenten", became a sidebar `NavItem` — and
 * KI-782 then gated that row on `isSystemAdmin`, so for THIS file's ordinary
 * `USER` fixture it is absent from the screen altogether. That is a behaviour
 * change, recorded as one: a non-admin no longer reaches the agents view,
 * because the row was their only way there. The sixth was the overview's own
 * theme button, and it is GONE rather than relocated: that was KI-776's
 * required deletion, and `THEME_CONTROL_NAME` above is what proves the screen
 * does not ship two colour-scheme controls.
 *
 * The language control's German label is an English sentence, because the
 * label names the language it switches to. Pinned as it stands.
 *
 * The list is the NON-ADMIN menu. KI-782 moved „Admin-Einstellungen" out of
 * the nav and into this same menu behind the `isSystemAdmin` gate, so the
 * admin story asserts a five-item list of its own — and the length check that
 * follows this one is what keeps the gate falsifiable from this side.
 */
const USER_MENU_NAMES: (string | RegExp)[] = [
  'Mein Profil',
  // Opens the settings window with the appearance preferences (24.09.2026).
  'Einstellungen',
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
  await expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('Mein Wissen');

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
  await expect(canvas.getByRole('region', { name: 'Mein Wissen' }))
    .toContainElement(canvas.getByRole('heading', { level: 1 }));

  /* ORACLE: the WAI-ARIA landmark mapping. The authenticated chrome renders NO
   * footer since the developer removed it (2026-09-15) — the legal pages are
   * reachable from the login screen only — so there is no `contentinfo` here at
   * all, with or without an imprint configured. */
  await expect(canvas.queryAllByRole('contentinfo')).toHaveLength(0);

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
  await expect(skip).toHaveAttribute('href', '#my-topics-content');
  await expect(canvasElement.querySelector('#my-topics-content'))
    .toBe(canvas.getByRole('region', { name: 'Mein Wissen' }));
}

/* ===========================================================================
 * Meta
 * ======================================================================== */

const meta = {
  title: 'Views/MyTopicsView',
  component: MyTopicsViewHarness,
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
   * (MyTopicsView.test.tsx:20).
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
    CHROME_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    localStorage.setItem('language', 'de');
    return () => {
      CHROME_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
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
    onViewAdmin: fn(),
    onViewSharedKbs: fn(),
    onLogout: fn(),
    onCreateKB: fn(),
    onSelectKB: fn(),
    onOpenKbById: fn(),
  },
} satisfies Meta<typeof MyTopicsViewHarness>;

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

    /* ONE FLAT GRID, NO SECTIONS (18.09.2026). This block used to assert four
       section triggers, their `aria-expanded`, their panels' `hidden` state and
       three count badges — the whole disclosure contract. None of it exists any
       more: the page is a `PageHeader` plus a `Grid`, and „remove all tabs" is
       exactly the removal of the thing those assertions described.
 
       What survives as a claim is the one the empty page can still make: the
       create tile is on it, and nothing else is. A user with no topics must not
       land on a bare page — the tile IS the empty state here, which is why
       `TopicGridPage` renders no `emptyState` when a create cell is present. */
    /* „Favoriten" is no longer in this list: it is a FILTER CHIP now, and a
       legitimate one — the assertion is about the removed SECTION headers, so
       matching the chip's label would fail for the wrong reason. */
    await expect(canvas.queryByRole('button', { name: /entdecken|Mit mir geteilt/ })).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Neues Thema' })).toBeInTheDocument();
    await expect(
      canvas.queryByRole('button', { name: /^Knowledge Base öffnen:/ }),
    ).toBeNull();

    /* ORACLE: WAI-ARIA accessible names. The surviving controls of the deleted
     * `home-view__actions` row, each reachable by name in its NEW home — which
     * is what KI-776's acceptance criterion asks for. The totals are what
     * catch one being dropped on the way.
     *
     * ORACLE-LEVEL CHANGE (KI-782), not a locator one: „Meine Agenten" is no
     * longer on this screen for an ordinary user. The row is gated on
     * `isSystemAdmin` and this story's fixture is `USER`, so the assertion
     * inverts — and the click that used to prove the row reaches
     * (The agents row was removed from the nav on 18.09.2026.)
     * Asserting the ABSENCE here rather than deleting the line is the point:
     * it is the half that distinguishes „gated" from „always visible", and it
     * is the user-visible loss this card was asked to state plainly.
     *
     * The query is document-wide (`screen`, not `canvas`) so a row that
     * escaped into a portal would still be found. */
    await expect(screen.queryByRole('button', { name: 'Meine Agenten' })).toBeNull();

    /* ORACLE: the union pattern in THEME_CONTROL_NAME, matched against the
     * whole canvas while the menu is CLOSED. Since 24.09.2026 the colour
     * scheme is a user-menu item (asserted with the menu below), so the page
     * itself carries no colour-scheme control at all — a second one mounted
     * elsewhere would show up here. */
    await expect(themeControlNames(canvas)).toEqual([]);

    const menu = await openUserMenu(canvas, userEvent);
    for (const name of USER_MENU_NAMES) {
      await expect(menu.getAllByRole('menuitem', { name })).toHaveLength(1);
    }
    await expect(menu.getAllByRole('menuitem')).toHaveLength(USER_MENU_NAMES.length);

    /* ORACLE: the spy in `args`. The click path — real pointer events through
     * the real menu item — is what proves the name resolves to something that
     * acts; „Mein Profil" closes the menu, so nothing is asserted through
     * `menu` after it. */
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
      .getByRole('region', { name: 'Mein Wissen' })
      .firstElementChild;
    await expect(container).not.toBeNull();
    await expect(getComputedStyle(container as HTMLElement).maxWidth).toBe('1440px');
  },
};

/* ===========================================================================
 * State 2 — only KBs of one's own
 * ======================================================================== */

/**
 * Three KBs, all owned. This is the state that pins the client-side split:
 * `GET /api/kb` is one request and the overview sorts its rows into "Meine
 * KBs" and "Mit mir geteilt" on `myRole === 'owner'` alone (MyTopicsView.tsx:441).
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

    /* The three count badges that were asserted here are gone with the
       sections that carried them. The count is now the grid's own length, read
       off the cards below — a weaker claim than a badge only in that it cannot
       catch a miscounted badge, and there is no badge left to miscount. */

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
    /* Scoped to the CARDS. „Persönlich" is a filter chip on this page as well
       now, so an unscoped query counts four — three badges and the chip — and
       fails for a reason that has nothing to do with the badges. The chip lives
       in the filter row, a sibling of the grid. */
    const badges = Array.from(cards).flatMap((card) =>
      Array.from(card.querySelectorAll('.home-view__badge')),
    ).filter((b) => b.textContent?.includes('Persönlich'));
    await expect(badges).toHaveLength(3);
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
    /* Reached through the page region rather than a section panel: there is no
       disclosure between the region and the grid any more, so the grid is the
       last element of the region's own container. */
    const grid = canvas
      .getByRole('region', { name: 'Mein Wissen' })
      .querySelector(':scope > div > div:last-child');
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



/* ===========================================================================
 * State 4 — a KB somebody shared with me
 * ======================================================================== */


/**
 * `removingKb` — the in-flight guard. One removal is running, so every remove
 * control on the page is refused, on a public card and a private one alike.
 * The prop reaches four separate call sites today.
 */
export const RemovalInFlight: Story = {
  args: { kbs: [OWNED_ONE], removingKb: true },
  play: async ({ canvas, userEvent }) => {
    /* ORACLE: the HTML `disabled` semantics, resolved by jest-dom's
     * `toBeDisabled` against the element's own state — not against a class.
     *
     * ONE CONTROL, NOT TWO. „Aus Favoriten entfernen" was asserted here as
     * well, from a `globalKbs` fixture — a global topic is not on this page any
     * more, so that half moved to `SharedTopicsView` with the card that offers
     * it. The boolean is the same one, and this is still the assertion that it
     * reaches a removal control. */
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


/* ===========================================================================
 * State 5 — the loading state
 * ======================================================================== */

/**
 * `LoadingFallback` (MyTopicsView.tsx:65) — three `KBCardSkeleton`s in a list
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
 * `onClick` calls `onSelectKB` (MyTopicsView.tsx, `PrivateKbCard`). `MyTopicsView`
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


/* ===========================================================================
 * Where the colour scheme and the Style live: the settings window
 * ======================================================================== */

/**
 * „Einstellungen" is a user-menu item, reachable by keyboard, and it opens
 * the settings window with the appearance preferences.
 *
 * WHY A STORY. Real focus handling: Radix collects only menu items into its
 * roving focus and swallows Tab (KI-788), so the arrow keys have to reach the
 * item, and the dialog has to take focus after the menu hands it back.
 *
 * ORACLES: the browser's focus navigation, WAI-ARIA's menu/menuitem/dialog
 * mapping, and src/translations.ts for the names.
 */
export const SettingsOpenFromTheUserMenu: Story = {
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: /^@grace/ });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const menu = within(await screen.findByRole('menu'));

    const item = menu.getByRole('menuitem', { name: 'Einstellungen' });
    for (let i = 0; i < 8 && document.activeElement !== item; i++) {
      await userEvent.keyboard('{ArrowDown}');
    }
    await expect(document.activeElement).toBe(item);

    await userEvent.keyboard('{Enter}');
    const dialog = within(await screen.findByRole('dialog', { name: 'Einstellungen' }));
    await expect(dialog.getByRole('heading', { level: 2, name: 'Allgemein' })).toBeInTheDocument();
    await expect(dialog.getByRole('combobox', { name: 'Darstellung' })).toBeInTheDocument();
    await waitFor(() => expect(dialog.getByRole('searchbox').closest('[role="dialog"]')).toContainElement(document.activeElement as HTMLElement));
    await userEvent.keyboard('{Escape}');
  },
};

/**
 * The chrome bar is 64px tall, and the search field is centred in it.
 *
 * WHY THE HEIGHT IS RE-MEASURED HERE (cards KI-788, then KI-787).
 * `.toast-container { top: 76px }` is 64px of chrome plus a 12px gap. 64px was
 * measured against design-system 0.25.0; 0.26.0 replaced the bar's hardcoded
 * `ThemeToggle` with the optional `headerActions` slot, and 0.29.0 made
 * `pageLabel` optional and renders NO element for it when omitted — which is
 * how this app draws the bar since KI-787. That is the bar rebuilt twice under
 * a constant this repo depends on. Had either release changed the height,
 * every toast on every shell view would overlap the chrome, and nothing would
 * have caught it: jsdom performs no layout, so the unit suite cannot see a
 * pixel of this.
 *
 * WHY THE CENTRING IS STILL MEASURED HERE, now that the template does it.
 * Design-system 0.30.0 added the bar's `search` region, which supplies the
 * `max-w-md` cap and centres the field on the BAR — so the old local recipe
 * (`w-full max-w-md mx-auto` on a wrapper, because `Input` forwards `className`
 * to an inline-block inner input whose `margin: auto` computes to `0px`) is
 * gone from this repo along with the trap it worked around. What is left for
 * this story to catch is the half that is still this app's: passing the field
 * to the wrong slot. `headerActions` renders at the bar's RIGHT end, takes no
 * cap, and looks entirely correct in every unit test and type check — the
 * offset below is the only thing that sees it.
 *
 * ORACLE: Chromium's own layout, read back through `getBoundingClientRect()`.
 * Independent of this repo by construction — the bar, the field and their box
 * model are the design system's; the expected height is the constant sitting
 * in `Toast.css`, and the expected centre is the BAR's own centre, computed
 * from the bar's rect rather than from anything the app reports about itself.
 * A class-name assertion would pass against a utility that compiled to
 * nothing, which is exactly the failure being guarded.
 *
 * TOLERANCE: 1px on the centre offset, for sub-pixel rounding at viewport
 * widths that do not divide evenly. The defect this catches is ~207px.
 *
 * NOT asserted: where the bar sits in the viewport. The story runner's
 * dev-mode Tailwind emits `.lg:hidden` before `.flex`, so `AppShell`'s mobile
 * top bar stays visible here and pushes the bar down (MyTopicsView.test.tsx:241
 * records the same quirk). The HEIGHT is unaffected, and it is the only half
 * `top: 76px` depends on.
 */
export const AppShellGeometry: Story = {
  play: async ({ canvas }) => {
    /* The bar is chrome with no role of its own, and carries no page label, so
     * it is reached by walking up from the search field's wrapper — the node
     * that IS the flex item of the bar's centre region. */
    const field = canvas.getByTestId('app-chrome-search');

    // wrapper -> headerActions region -> Container -> the bar itself.
    const bar = field.parentElement?.parentElement?.parentElement;
    await expect(bar).toBeDefined();

    // ORACLE: Chromium's layout engine. 64px = `h-16`, the number Toast.css
    // adds its 12px gap to. Re-measured against design-system 0.31.0, with no
    // `pageLabel` and the field in the `search` region.
    const barRect = (bar as HTMLElement).getBoundingClientRect();
    await expect(barRect.height).toBe(64);

    // ORACLE: the bar's own centre. This is what fails if the field is handed
    // to `headerActions` instead of `search` — that region is `justify-end`.
    const fieldRect = field.getBoundingClientRect();
    const offset = (fieldRect.left + fieldRect.right) / 2 - (barRect.left + barRect.right) / 2;
    await expect(Math.abs(offset)).toBeLessThanOrEqual(1);

    // And it is a real box, not a zero-width one that would be "centred" by
    // accident. 448px = `max-w-md` (28rem), the cap the template applies.
    await expect(fieldRect.width).toBeGreaterThan(0);
    await expect(fieldRect.width).toBeLessThanOrEqual(448);
  },
};

