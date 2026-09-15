import { lazy, Suspense, type ReactNode } from 'react';
import {
  AppShellLayout,
  DropdownMenuItem,
  Logo,
  NavItem,
  SidebarUserMenu,
  ThemeToggle,
} from '@ki4jlu/design-system';
import {
  Settings, User, LogOut, Copy, Check, Bot, Home, Languages, Users,
} from 'lucide-react';
import { API_BASE_URL } from '../api';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useAppNav } from '../contexts/AppNavContext';
import { useSharingContext } from '../contexts/SharingContext';
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
 *    `SharingContext`), which is what keeps KI-770's rule intact: a new
 *    destination in the sidebar needs no new prop on any page component.
 *
 * ACTIVE STATE. `active` names the current page, and `NavItem`'s `active` prop
 * is what emits `aria-current="page"`. Exactly one row may carry it, which is
 * why this is a single discriminated value rather than a boolean per row.
 * ------------------------------------------------------------------------- */

/** Which top-level view is currently on screen. One row, one `aria-current`. */
export type AppChromeView = 'home' | 'shared-kbs';

/**
 * The `id` on the colour-scheme switch's `role="group"` element (card KI-788).
 *
 * It is an ADDRESS, not a style hook: the developer asked for a stable anchor
 * on the control whose accessible name is „Farbschema", so the onboarding tour
 * — or anything scripting the page from outside React — can point at it. That
 * is exactly what design-system 0.26.0's new `id` prop is for; the toggle
 * renders its own DOM, so without the prop the group is unaddressable.
 *
 * KNOWN LIMITATION, measured on this card and not hidden: `AppShell` renders
 * the SAME sidebar node twice — the sticky desktop column plus, while it is
 * open, the mobile drawer copy — so while that drawer is open two elements
 * carry this id and `getElementById` returns the desktop one (which is
 * `display:none` at that breakpoint). Nothing in this file can tell the two
 * mounts apart: the design system keeps `SidebarSurfaceContext` private and
 * exports only `useSidebarCollapsed`. The fix belongs in the design system
 * (export the surface, or let `AppShell` own the de-duplication); until then
 * the drawer-open case is asserted in `HomeView.test.tsx` so it is a recorded
 * fact rather than a surprise. It is unique in every closed-drawer state,
 * which is every desktop state and the mobile default.
 */
const THEME_TOGGLE_ID = 'theme-toggle';

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
  /** Text of the shell's page-label bar. */
  pageLabel: string;
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

/** The system role, as a label. Falls back to the raw value for an unknown role. */
function roleLabel(role: string | undefined, t: (k: string) => string): string {
  switch (role) {
    case 'user': return t('roleUser');
    case 'api-user': return t('roleApiUser');
    case 'admin': return t('roleAdmin');
    case 'superadmin': return t('roleSuperAdmin');
    default: return role ?? '';
  }
}

export function AppChrome({ active, contentId, pageLabel, children }: AppChromeProps) {
  const { language, setLanguage, t } = useTheme();
  // `logout` is read here rather than taken as a prop: AuthContext already
  // publishes it, and AuthenticatedApp only renamed it on the way down.
  const { user, siteConfigs, logout: onLogout } = useAuth();
  const { onViewHome, onViewSharedKbs, onViewProfile, onViewAdmin, onViewAgents } = useAppNav();
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

  const isSystemAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  /* The `logo` slot. An operator-uploaded logo still wins (card KI-719, the
     pattern Login established); the fallback is the design system's own
     wordmark rather than a lucide book icon, so it is readable text on the
     brand tokens. NOTE: `AppShell` renders this node TWICE — once in the
     sidebar header, once in the below-lg top bar — so the document holds two
     copies, only one of them visible per breakpoint. */
  const logo = siteConfigs.logo_path ? (
    <img
      src={`${API_BASE_URL}${siteConfigs.logo_path}`}
      alt={t('websiteLogo')}
      className="h-10 max-w-full object-contain"
    />
  ) : (
    <Logo product="RAG" />
  );

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
   * „MEINE AGENTEN" IS ADMIN-ONLY SINCE KI-782, and that is a BEHAVIOUR
   * change, not a tidy: every non-admin loses the screen, because this row is
   * their only way to it. The two other call sites of the same jump
   * (`ChatView`'s `KbAgentsSection` and `KbSettingsPanel`, both behind
   * `canOpenKbAdvancedSettings`) already require a system role of api-user,
   * admin or superadmin, so a plain `user` has nothing left. `AgentsView` and
   * `onViewAgents` stay: the developer reversed the original "remove it"
   * instruction precisely so the view is HIDDEN rather than orphaned.
   *
   * The gate is `isSystemAdmin`, the same predicate the Admin entry uses, so
   * the app gains no second role convention. Note it is narrower than
   * `canOpenKbAdvancedSettings`'s system-role triple: an `api-user` who is a
   * KB admin loses this row while keeping the in-KB "Agent anlegen" links.
   * // TODO: whether `api-user` should keep the row is not confirmed — it is
   * recorded on KI-782 rather than decided here.
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
   *     visible in an 80px column. `AppShellCollapsed` in HomeView.stories.tsx
   *     measures that in Chromium, because jsdom applies no stylesheet and the
   *     unit suite cannot see it.
   * The label and the visible text are the same `t()` call, so they cannot
   * drift. */
  const nav = (
    <>
      <NavItem type="button" label={t('home')} active={active === 'home'} onClick={onViewHome}>
        <Home size={20} aria-hidden="true" />
        <span>{t('home')}</span>
      </NavItem>
      <NavItem type="button" label={t('sharedKbs')} active={active === 'shared-kbs'} onClick={onViewSharedKbs}>
        <Users size={20} aria-hidden="true" />
        <span>{t('sharedKbs')}</span>
      </NavItem>
      {isSystemAdmin && (
        <NavItem type="button" label={t('myAgents')} onClick={onViewAgents}>
          <Bot size={20} aria-hidden="true" />
          <span>{t('myAgents')}</span>
        </NavItem>
      )}
    </>
  );

  const userMenu = (
    <SidebarUserMenu
      initials={(user?.username ?? '').slice(0, 2).toUpperCase()}
      name={`@${user?.username}`}
      role={roleLabel(user?.role, t)}
    >
      {/* `preventDefault` keeps the menu open: `copySuccess` is a 2s flag and
          the confirmed icon would otherwise be behind a menu that Radix has
          already closed. */}
      <DropdownMenuItem
        onSelect={(e) => { e.preventDefault(); sharing.copyUserId(); }}
      >
        <span className="icon-swap" key={sharing.copySuccess ? 'check' : 'copy'}>
          {sharing.copySuccess
            ? <Check size={16} className="text-success" aria-hidden="true" />
            : <Copy size={16} aria-hidden="true" />}
        </span>
        {t('copyUsername')}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onViewProfile}>
        <User size={16} aria-hidden="true" />
        {t('profile')}
      </DropdownMenuItem>
      {/* „Admin-Einstellungen", moved out of the nav by KI-782 with its
          `isSystemAdmin` gate unchanged. Placed after „Mein Profil" because
          both are DESTINATIONS — a jump to another view — while the two items
          below it are a preference and a session action. It is the ONLY route
          into the admin UI: Stage 7b deleted the floating admin button, so if
          this item ever stops reaching `onViewAdmin` admins have no way in at
          all. That is why `App.authenticated-home.test.tsx` clicks it on the
          real route instead of asserting it renders. */}
      {isSystemAdmin && (
        <DropdownMenuItem onSelect={onViewAdmin}>
          <Settings size={16} aria-hidden="true" />
          {t('adminSettings')}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={() => setLanguage(language === 'de' ? 'en' : 'de')}>
        <Languages size={16} aria-hidden="true" />
        {t('switchLanguage')}
        {/* The current code, kept as the visible affordance the old DE/EN
            button was. `aria-hidden` because the label already names the
            action, and a trailing "DE" in the accessible name would say
            nothing a screen-reader user needs. */}
        <span className="ml-auto" aria-hidden="true">{language.toUpperCase()}</span>
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onSelect={onLogout}>
        <LogOut size={16} aria-hidden="true" />
        {t('logout')}
      </DropdownMenuItem>
    </SidebarUserMenu>
  );

  /* The sidebar footer: the colour-scheme switch, then the user menu.
   *
   * WHY THE TOGGLE IS HERE AT ALL (card KI-788). Until design-system 0.25.0,
   * `AppShellLayout` rendered a `<ThemeToggle />` of its own at the right end
   * of the page-label bar. 0.26.0 deleted it in favour of the optional
   * `headerActions` slot, so the bar now renders NO control — and since
   * omitting the slot is valid, the toggle disappears with no type error and
   * no failing gate. `headerActions` is deliberately left unset (the search
   * chrome card owns that slot), and the control is re-mounted here.
   *
   * WHY IT IS NEXT TO THE USER MENU AND NOT INSIDE IT — the one place this
   * card knowingly departs from its own brief, so it is stated in full.
   *
   * `SidebarUserMenu`'s children land in a Radix `DropdownMenuContent`, i.e.
   * inside `role="menu"`. `ThemeToggle` is a `role="group"` of three plain
   * buttons, and a menu may own only menuitem / menuitemradio /
   * menuitemcheckbox / group-of-those / separator — so nesting it breaks the
   * menu's ARIA contract. That alone is arguable; what settles it is that the
   * control also stops working for keyboard users. Measured against the
   * installed Radix build with the real components (probe on KI-788, deleted
   * after it answered):
   *   - ArrowDown cycles the registered menu items only — focus never lands
   *     on any of the three theme buttons, because Radix's roving focus
   *     collects `DropdownMenuItem`s and nothing else;
   *   - Tab does not move at all: `@radix-ui/react-menu` calls
   *     `event.preventDefault()` on Tab inside the content
   *     (node_modules/@radix-ui/react-menu/dist/index.mjs, "Tab" keydown).
   * A nested toggle is therefore mouse-only, which contradicts the design
   * system's own documented contract for the component („fully visible and
   * keyboard-accessible") and would be a regression against 0.25.0, where the
   * toggle sat in the page-label bar and was reachable with Tab.
   *
   * The ARIA-clean way to put a three-way choice INSIDE the menu is three
   * `menuitemradio`s — which means not using `ThemeToggle` at all and
   * rebuilding a design-system control out of local parts. That is the thing
   * this branch exists to stop doing.
   *
   * So the switch sits directly above the user row, inside the same footer
   * block: visually part of the user card, keyboard- and screen-reader-clean,
   * and one line away from moving into the dropdown if the developer prefers
   * that trade after visual QA.
   *
   * FOR VISUAL QA: the control is tri-state since KI-779 (light / system /
   * dark), not the old two-state „dark mode" button — three icon buttons in a
   * pill, permanently visible at the bottom of the sidebar. Whether that reads
   * right there is a judgement call this card cannot make for the developer.
   *
   * The four labels come from `translations.ts` — 0.26.0 is the first version
   * that lets a consumer pass them, and they were German in an English session
   * until now. */
  /* THE TWO LAYOUT CLASSES BELOW EXIST FOR THE 80px COLUMN (card KI-789), and
   * they are layout exceptions, not skin — the only thing `className` is for
   * on a design-system component.
   *
   * MEASURED, not assumed: at design-system 0.28.0 `ThemeToggle` is 102px wide
   * (a 1px border + `p-1` + three `p-1.5` buttons around 16px icons + two 4px
   * gaps) and has no collapsed form of its own. The collapsed sidebar footer
   * offers 64px of content box, and `justify-center` centred the 102px block
   * over it — so before this the switch hung 11px past BOTH edges of the
   * column, over the page content on one side and over the shell's border on
   * the other. `AppShellCollapsed` in HomeView.stories.tsx is the measurement;
   * it fails at −11 without these classes.
   *
   * WHY WRAP RATHER THAN HIDE. Hiding the switch while collapsed was the other
   * option and it is what the design system does to the collapse toggle inside
   * the mobile drawer. It was not taken: since 0.26.0 this control is the
   * app's ONLY colour-scheme affordance (`headerActions` is deliberately
   * unset), so hiding it would make minimising the sidebar lossy — the same
   * argument the design system itself makes for keeping `SidebarUserMenu` in
   * the collapsed column. `w-full min-w-0` gives the footer's width to the
   * block instead of letting it size to its content, and `flex-wrap` lets the
   * three options stack inside it.
   *
   * FOR VISUAL QA: the consequence is that the switch becomes a taller, three-
   * row pill in the collapsed column. That it FITS is asserted; whether it
   * READS well at 80px is a judgement call this card cannot make for the
   * developer, and the alternative is one line away.
   * // TODO: whether the design system should grow a collapsed form for
   * `ThemeToggle` is not decided here — it is written on KI-789 for the
   * design-system board to pick up. */
  const sidebarFooter = (
    <div className="flex w-full min-w-0 flex-col items-center gap-2">
      <ThemeToggle
        id={THEME_TOGGLE_ID}
        className="max-w-full flex-wrap justify-center self-center"
        themeLabel={t('colorScheme')}
        lightLabel={t('themeLight')}
        systemLabel={t('themeSystem')}
        darkLabel={t('themeDark')}
      />
      {userMenu}
    </div>
  );

  return (
    <>
      {/* Outside the shell so it stays the document's first focusable element;
          it is absolutely positioned until focused, so it occupies no space.
          Its target is the content template's `<section>`: `AppShell` owns the
          `<main>` and spreads consumer props onto its ROOT div, so the id
          cannot be put on the landmark itself. */}
      <a href={`#${contentId}`} className="skip-link">{t('skipToContent')}</a>

      {/* `headerActions` is deliberately NOT passed (card KI-788): the
          page-label bar carries no control of its own since design-system
          0.26.0 replaced its hardcoded `ThemeToggle` with that slot, and the
          toggle moved into the sidebar footer above. The slot stays free for
          the search chrome card, which is the other 0.26.0 consumer; the bar
          keeps its `h-16`/64px height either way, which is what
          `Toast.css`'s `top: 76px` is derived from. */}
      <AppShellLayout
        logo={logo}
        nav={nav}
        sidebarFooter={sidebarFooter}
        navLabel={t('mainNavigation')}
        menuLabel={t('openNavigation')}
        drawerLabel={t('navigation')}
        pageLabel={pageLabel}
        collapsed={sidebar.collapsed}
        onCollapsedChange={sidebar.onCollapsedChange}
        collapseLabel={t('collapseNavigation')}
        expandLabel={t('expandNavigation')}
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
