import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AppShellLayout,
  Input,
  Logo,
  NavItem,
  type MobilePaneTab,
} from '@ki4jlu/design-system';
import {
  Home, Search, Users,
  LayoutGrid, Menu, Compass, Wrench,
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAppNav } from '../contexts/AppNavContext';
import { useSharingContext } from '../contexts/SharingContext';
import { AppUserMenu } from './AppUserMenu';
import { SidebarNav } from './SidebarNav';
import { useKbSearch } from '../contexts/KbSearchContext';
import { useSidebarCollapse } from '../hooks/useSidebarCollapse';
import { KBCardSkeleton } from './Skeleton';
// `home-view__imprint` and `home-view__grid` below. The stylesheet is shared
// with `KbCard.tsx` and `HomeView.tsx` rather than split — see KbCard.tsx's
// header for why the `home-view__` block name outlived the component.
import './HomeView.css';

const MembersModal = lazy(() => import('./MembersModal').then(module => ({ default: module.MembersModal })));

/* ---------------------------------------------------------------------------
 * The signed-in app chrome (card KI-783).
 *
 * WHY THIS FILE EXISTS. `AppShellLayout` + its logo, nav and `SidebarUserMenu`
 * were written inline in `HomeView.tsx` by KI-776, when the overview was the
 * only top-level view that had a shell. KI-783 adds a second one
 * („Geteilte Knowledge Bases"), and a second inline copy of the sidebar is the
 * duplication that would actually hurt: the nav rows, the four user-menu items
 * and the four chrome labels would then have to be edited in two places, and
 * the follow-up card that reworks the nav (KI-782) would have two targets
 * instead of one. So the chrome moved out of the page and became a wrapper the
 * pages hang their content in — the same relationship `AppShellLayout` already
 * has to `SectionedGridLayout`.
 *
 * WHAT IT OWNS, AND WHAT IT DELIBERATELY DOES NOT.
 *  - It owns: the skip link, the shell, the logo slot, the nav rows, the user
 *    menu, the operator imprint, and the members dialog (which reads
 *    `SharingContext` directly and is reachable from a KB card on EVERY view
 *    that renders one — a per-page copy would mean a share button that opens
 *    nothing on the newer view).
 *  - It does not own page content. `children` is the content template
 *    (`SectionedGridLayout`), and the caller keeps every page-specific modal:
 *    `HomeView`'s `SettingsModal` stays in `HomeView`.
 *  - It reads no props from the page. Every value comes from a context the
 *    route already mounts (`ThemeContext`, `AuthContext`, `AppNavContext`,
 *    `SharingContext`, and since KI-787 `KbSearchContext`), which is what keeps
 *    KI-770's rule intact: a new destination in the sidebar — or a new control
 *    in the bar — needs no new prop on any page component. KI-787 is the case
 *    that tested it: the catalog search moved INTO this file and `HomeView`'s
 *    signature did not change by one prop.
 *  - Since KI-787 it no longer takes a `pageLabel`. The bar showed „Meine
 *    Knowledge Bases" directly above the content template's `<h1>` with the
 *    same words; design-system 0.29.0 made the prop optional and renders no
 *    element when it is omitted, so the bar is now the search field alone.
 *
 * ACTIVE STATE. `active` names the current page, and `NavItem`'s `active` prop
 * is what emits `aria-current="page"`. Exactly one row may carry it, which is
 * why this is a single discriminated value rather than a boolean per row.
 * ------------------------------------------------------------------------- */

/** Which top-level view is currently on screen. One row, one `aria-current`. */
export type AppChromeView = 'my-topics' | 'shared-topics' | 'discover' | 'tools';


export interface AppChromeProps {
  /** The current page; the matching nav row gets `aria-current="page"`. */
  active: AppChromeView;
  /**
   * `id` of the content landmark the skip link jumps to. The page puts it on
   * its own `SectionedGridLayout`, because `AppShell` owns the `<main>` and
   * spreads consumer props onto its root div — so the id cannot live on the
   * landmark itself.
   */
  contentId: string;
  /** Page content — the content template, plus any page-owned modal. */
  children: ReactNode;
}

/**
 * The lazy members dialog's fallback.
 *
 * Three KB-card skeletons in an `aria-busy` list. Kept byte-for-byte from
 * `HomeView` because `HomeView.stories.tsx`'s `ShareDialogLoadingFallback`
 * asserts both the label and the skeleton count as the fallback's contract.
 */
const LoadingFallback = () => (
  <ul className="home-view__grid" aria-busy="true" aria-label="Loading...">
    <KBCardSkeleton />
    <KBCardSkeleton />
    <KBCardSkeleton />
  </ul>
);

export function AppChrome({ active, contentId, children }: AppChromeProps) {
  const { t } = useTheme();
  const { onViewMyTopics, onViewSharedTopics, onViewDiscover, onViewTools } = useAppNav();
  // The catalog search, which lives in the chrome bar since KI-787. Read from
  // a context for the same reason everything else here is: this component
  // takes no props from the page.
  const { query, setQuery, focusPending, requestFocus, consumeFocus } = useKbSearch();
  const searchRef = useRef<HTMLInputElement>(null);
  // Only the clipboard pair and the dialog's own open state are read here; the
  // rest of the sharing concern belongs to the KB cards on the page.
  const sharing = useSharingContext();
  /* The minimise toggle's state (card KI-789). `Sidebar` is controlled and
     remembers nothing by design, so the app owns this and persists it — see
     `useSidebarCollapse.ts` for why it goes through the same `localStorage`
     convention as the overview's sections rather than a second one. It is read
     HERE, in the one component that mounts the shell, so both views
     (`HomeView`, `SharedKbsView`) get the same remembered column without
     either of them knowing the toggle exists. */
  const sidebar = useSidebarCollapse();

  /* Which area the narrow-screen tab bar is showing (design-system 0.30.0).
   *
   * NOT PERSISTED, unlike the sidebar width. The column width is a lasting
   * preference; which of two areas you last looked at on a phone is a position
   * in a session, and restoring it days later would drop a returning user on
   * the nav column instead of their content. Defaults to the page for the same
   * reason.
   *
   * `activeMobileTab` is the SINGLE input that decides the area — the design
   * system does no derivation of its own — so anything this app wants to imply
   * from it stays here. Today that is one thing: selecting a nav row switches
   * back to the content, because on a phone the nav column is a menu you leave
   * once you have chosen, and staying on it after a choice reads as a dead tap.
   * On a wide screen the tab bar is not rendered at all and this is inert. */
  const [mobileTab, setMobileTab] = useState('page');
  const showContent = () => setMobileTab('page');

  const mobileTabs: MobilePaneTab[] = [
    { id: 'nav', icon: <Menu aria-hidden="true" />, label: t('navigationTab'), pane: 'left' },
    { id: 'page', icon: <LayoutGrid aria-hidden="true" />, label: t('contentTab'), pane: 'main' },
  ];

  /* Hand the caret back to the search field after a jump (card KI-787).
   *
   * Typing on „Geteilte Knowledge Bases" navigates to the overview, and that
   * swaps one branch of `AuthenticatedApp` for the other — so THIS component,
   * the field and `searchRef` are all rebuilt. Measured while writing
   * `App.authenticated-shared-kbs.test.tsx`: without this, a user typing
   * „Recht" lands on the overview with „R" in the box, focus on `<body>`, and
   * the remaining four keystrokes dropped on the floor. The flag is state on
   * the context rather than a ref precisely because no ref survives that
   * remount.
   *
   * `setSelectionRange` puts the caret AFTER the character that caused the
   * jump; `focus()` alone selects nothing and would leave it at position 0 in
   * some browsers, i.e. the next letter would land in front of the first. */
  useEffect(() => {
    if (!focusPending) return;
    const el = searchRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    consumeFocus();
  }, [focusPending, consumeFocus]);

  /* The `logo` slot: the design system's wordmark, built from the product name
     („JLU [RAG]"), always.
 
     THE `siteConfigs.logo_path` OVERRIDE IS GONE (developer ruling, 17.09.2026:
     logo upload is deprecated, the logo is built from the app name). It used to
     win here when an operator had uploaded an image (card KI-719, the pattern
     Login established), with the wordmark only as a fallback. Removing the
     branch means the shell renders real TEXT on the brand tokens in every
     deployment — which is what a screen reader reads as „JLU RAG" without any
     `alt`, and what themes correctly in both colour schemes.
 
     SCOPE, so this is not mistaken for a finished deprecation: only the shell
     is changed. `Login.tsx`, `SourcesPanel.tsx`, the admin upload UI in
     `AdminSiteTab.tsx`/`AdminUI.tsx` and the backend's `logo_path` key
     (`internal/siteconfig`) still exist and still work.
     // TODO: removing the upload end to end — admin surface and the site-config
     // key with it — is not decided here. */
  const logo = <Logo product="RAG" />;

  /* The nav rows.
   *
   * A row for the page one is already on still gets a handler, unlike the
   * pre-KI-783 version where the Home row had none ("there is nowhere to
   * navigate to"). That stopped being true the moment a second view existed:
   * the same node is rendered twice by `AppShell` — sticky sidebar and mobile
   * drawer — and the drawer copy of the CURRENT page's row is what a user
   * presses to dismiss the drawer. A handler that re-selects the view one is
   * on is a no-op in state terms and keeps both copies behaving alike.
   *
   * Row order follows the target nav on KI-782, which finished that rework
   * here: the two KB rows are unconditional, „Meine Agenten" is role-gated,
   * and Admin left the nav for the user menu below.
   *
   * „MEINE AGENTEN" IS GONE FROM THE NAV (developer ruling, 18.09.2026). It was
   * an admin-only row since KI-782, and it is now no row at all.
   *
   * THIS ORPHANS NOTHING, which is the reason it can simply go: `AgentsView`
   * keeps two routes, both in-KB and both behind `canOpenKbAdvancedSettings` —
   * `ChatView`'s `KbAgentsSection` and `KbSettingsPanel`'s „Agent anlegen".
   * What changes is that an admin reaches the screen through a KB instead of
   * from anywhere. A plain `user` had no route before this and has none now.
   * `AppNavContext.onViewAgents` went with the row (this was its only reader);
   * the identically-named `KbCoreContext.onViewAgents` is a different value and
   * is what `ChatView` still uses.
   *
   * WHY EVERY ROW CARRIES `label` AND WRAPS ITS TEXT IN A `<span>` (KI-789).
   * Two separate requirements of design-system 0.27.0's collapsed form, and
   * missing either one is silent:
   *   - `label` is what PERMITS the row to collapse at all. `NavItem` collapses
   *     only when it was told its own name (`collapsed = sidebarCollapsed &&
   *     label !== undefined`) and otherwise keeps rendering full width — it
   *     declines rather than guessing, because dropping the visible text
   *     without an `aria-label` to replace it would strip the row of its
   *     accessible name. A row missing `label` therefore does not throw, does
   *     not warn, and does not fail a type check: it just refuses to minimise
   *     while its neighbours do.
   *   - the `<span>` is what makes it look collapsed. The collapsed variant
   *     hides element children (`[&>*:not(svg)]:hidden`) and CSS has no
   *     selector for a bare text node, so `{t('home')}` on its own would stay
   *     visible in the rail. The design system measures that in Chromium in its
   *     own `WithCollapsibleColumns` story — the rail is its geometry — because
   *     jsdom applies no stylesheet and the unit suite cannot see it.
   * The label and the visible text are the same `t()` call, so they cannot
   * drift. */
  /* Every row hands the tab bar back to the content — see `showContent` above.
     It is appended to the existing handler rather than wrapped around it, so
     the navigation itself stays exactly what each row already did. */
  const nav = (
    <>
      <NavItem
        type="button"
        label={t('myTopics')}
        active={active === 'my-topics'}
        onClick={() => { onViewMyTopics(); showContent(); }}
      >
        <Home size={20} aria-hidden="true" />
        <span>{t('myTopics')}</span>
      </NavItem>
      <NavItem
        type="button"
        label={t('sharedTopics')}
        active={active === 'shared-topics'}
        onClick={() => { onViewSharedTopics(); showContent(); }}
      >
        <Users size={20} aria-hidden="true" />
        <span>{t('sharedTopics')}</span>
      </NavItem>
      <NavItem
        type="button"
        label={t('discoverTopics')}
        active={active === 'discover'}
        onClick={() => { onViewDiscover(); showContent(); }}
      >
        <Compass size={20} aria-hidden="true" />
        <span>{t('discoverTopics')}</span>
      </NavItem>
      <NavItem
        type="button"
        label={t('tools')}
        active={active === 'tools'}
        onClick={() => { onViewTools(); showContent(); }}
      >
        <Wrench size={20} aria-hidden="true" />
        <span>{t('tools')}</span>
      </NavItem>
    </>
  );

  // Shared with the KB workspace: account actions and the settings window.
  const userMenu = <AppUserMenu />;

  /* THE CHROME BAR'S ONE CONTROL: the KB catalog search (card KI-787).
   *
   * IT IS A MOVE, NOT A NEW FEATURE. This is the field that used to sit inside
   * the „KBs entdecken" accordion on the overview; `KbCatalogPanel` no longer
   * renders one, so there is exactly one search box in the app and exactly one
   * `query`. The 250 ms debounce and the `GET /api/kb/catalog?q=` request stay
   * in the panel, where the fetch is — a second debounce here would only make
   * the first one's timing unobservable.
   *
   * IT IS IN THE `search` SLOT, NOT `headerActions` (design-system 0.30.0), AND
   * THE WIDTH CAP AND CENTRING ARE NO LONGER OURS. The old recipe here was
   * `w-full max-w-md mx-auto` on this wrapper, which centres the field in the
   * space the page label LEAVES — so it only looked centred when there was no
   * label, and a field that shifts sideways when the page name changes was the
   * bug that recipe could not avoid. 0.30.0 made the bar three regions and
   * centres this one on the BAR; passing the cap again would fight it.
   *
   * `w-full` stays, and it is still on the wrapper rather than on `<Input>`:
   * `Input` forwards `className` to the inner `<input>`, and with a
   * `leadingIcon` that input sits inside a `relative block w-full` span as an
   * inline-block box — a cap put there would not be the flex item the bar
   * measures. `AppShellGeometry` in `HomeView.stories.tsx` re-measures the
   * centring in Chromium, because jsdom performs no layout and the unit suite
   * cannot see a pixel of it.
   *
   * NOTHING HERE IS A HEADING. The bar is chrome; the page's `<h1>` belongs to
   * the content template (design-system KI-736). The accessible name is the
   * same `t('catalogSearchPlaceholder')` the placeholder uses — reused rather
   * than a second key, so the two cannot drift and translators see one string.
   *
   * IT SEARCHES THE CATALOG, SO TYPING JUMPS TO „ENTDECKEN" — on every view
   * except that one, with the query already applied. It used to jump to the
   * overview and expand the „KBs entdecken" section there; the catalog is its
   * own view since 18.09.2026, so the destination moved with it and the
   * section-expanding half is gone entirely.
   *
   * The alternative was hiding the field off its own view; a control that
   * vanishes between views reads as a bug, and a control that is present but
   * inert lies. The jump is made HERE rather than in the context because
   * `active` is the only place in the app that knows which view is on screen.
   * It rebuilds this whole component, so the caret is handed over explicitly
   * through `focusPending` — see the effect above.
   *
   * // TODO: this navigate-on-type behaviour is the PM's assumption on KI-787,
   * // not a developer ruling — not yet confirmed. Reversing it means deciding
   * // between hiding the field here and leaving it inert, and takes the
   * // `focusPending` handoff with it. */
  const headerSearch = (
    <div className="w-full" data-testid="app-chrome-search">
      <Input
        ref={searchRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (active !== 'discover') {
            onViewDiscover();
            requestFocus();
          }
        }}
        placeholder={t('catalogSearchPlaceholder')}
        aria-label={t('catalogSearchPlaceholder')}
        leadingIcon={<Search aria-hidden="true" />}
      />
    </div>
  );

  /* The sidebar footer is the user menu alone. The colour scheme and the
   * Style moved INTO it as menu items (AppUserMenu) — keyboard-reachable
   * there, unlike the old toggle groups — so nothing is lost in the collapsed
   * rail, where `SidebarUserMenu` renders as its avatar. */
  const sidebarFooter = userMenu;

  return (
    <>
      {/* Outside the shell so it stays the document's first focusable element;
          it is absolutely positioned until focused, so it occupies no space.
          Its target is the content template's `<section>`: `AppShell` owns the
          `<main>` and spreads consumer props onto its ROOT div, so the id
          cannot be put on the landmark itself. */}
      <a href={`#${contentId}`} className="skip-link">{t('skipToContent')}</a>

      {/* Migrated to design-system 0.30.0. Four props are gone and one state
          inverted; each line below is the reason, because none of them is a
          rename.

          `menuLabel` / `drawerLabel` went with the drawer they named. Below
          `lg` the shell shows one area at a time behind a `BottomTabBar`, so
          there is nothing to open and nothing to label — `mobileTabs` +
          `mobileTabBarLabel` replace them, and they are REQUIRED: without tabs
          the nav column has no route at all on a narrow screen.

          `collapsed` → `leftOpen`, AND THE MEANING INVERTS. The inversion is
          done HERE, at the call site, and deliberately not inside
          `useSidebarCollapse`: that hook's `localStorage` key is
          `…chrome.sidebar.collapsed` and it already holds a value for every
          user who has ever minimised the column. Flipping the hook would
          reinterpret every stored `true` as its opposite — a silent,
          per-user, one-way data change. Two `!` here cost nothing and touch no
          stored state.

          The search moved from `headerActions` to `search` — see the block
          above the field for why the centring could not stay ours.

          THE BAR'S HEIGHT IS UNCHANGED at `h-16`/64px in every combination of
          the three regions; `AppShellGeometry` in `HomeView.stories.tsx`
          re-measures it in Chromium. That number is what `Toast.css`'s
          `top: 76px` (64 + 12) is derived from, so a bundle that changed it
          would slide every toast onto the chrome. */}
      <AppShellLayout
        logo={logo}
        nav={<SidebarNav>{nav}</SidebarNav>}
        sidebarFooter={sidebarFooter}
        navLabel={t('mainNavigation')}
        search={headerSearch}
        leftOpen={!sidebar.collapsed}
        onLeftOpenChange={(isOpen) => sidebar.onCollapsedChange(!isOpen)}
        collapseLabel={t('collapseNavigation')}
        expandLabel={t('expandNavigation')}
        mobileTabs={mobileTabs}
        activeMobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
        mobileTabBarLabel={t('switchArea')}
      >
        {children}

        {/* The members dialog reads the sharing context directly; the same
            eleven values reach KbWorkspaceModals through KbDataContext.sharing,
            so the two mount points spell the dialog the same way. It lives in
            the CHROME rather than on a page because every view that renders a
            KB card renders that card's share button. */}
        <Suspense fallback={<LoadingFallback />}>
          {sharing.showShareModal && <MembersModal
            show={sharing.showShareModal}
            onClose={() => sharing.setShowShareModal(false)}
            sharingKb={sharing.sharingKb}
            shareUserId={sharing.shareUserId}
            setShareUserId={sharing.setShareUserId}
            shareTargetUser={sharing.shareTargetUser}
            shareLoading={sharing.shareLoading}
            sharePermission={sharing.sharePermission}
            setSharePermission={sharing.setSharePermission}
            onLookupUser={sharing.lookupUser}
            onConfirmShare={sharing.confirmShare}
            notFoundUsername={sharing.notFoundUsername}
            onPendingInvited={sharing.clearNotFound}
            myRole={sharing.sharingKb?.myRole ?? 'view'}
          />}
        </Suspense>
      </AppShellLayout>

    </>
  );
}
