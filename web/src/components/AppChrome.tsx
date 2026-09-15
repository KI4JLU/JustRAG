import { lazy, Suspense, type ReactNode } from 'react';
import {
  AppShellLayout,
  DropdownMenuItem,
  Logo,
  NavItem,
  SidebarUserMenu,
} from '@ki4jlu/design-system';
import {
  Settings, User, LogOut, Copy, Check, Bot, Home, Languages, Users,
} from 'lucide-react';
import { API_BASE_URL } from '../api';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useAppNav } from '../contexts/AppNavContext';
import { useSharingContext } from '../contexts/SharingContext';
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
   * Row order follows the target nav on KI-782, which owns the rest of that
   * rework (renaming the Home row, role-gating „Meine Agenten", moving Admin
   * into the user menu). This card adds only the destination it needs. */
  const nav = (
    <>
      <NavItem type="button" active={active === 'home'} onClick={onViewHome}>
        <Home size={20} aria-hidden="true" />
        {t('home')}
      </NavItem>
      <NavItem type="button" active={active === 'shared-kbs'} onClick={onViewSharedKbs}>
        <Users size={20} aria-hidden="true" />
        {t('sharedKbs')}
      </NavItem>
      <NavItem type="button" onClick={onViewAgents}>
        <Bot size={20} aria-hidden="true" />
        {t('myAgents')}
      </NavItem>
      {isSystemAdmin && (
        <NavItem type="button" onClick={onViewAdmin}>
          <Settings size={20} aria-hidden="true" />
          {t('adminSettings')}
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

  return (
    <>
      {/* Outside the shell so it stays the document's first focusable element;
          it is absolutely positioned until focused, so it occupies no space.
          Its target is the content template's `<section>`: `AppShell` owns the
          `<main>` and spreads consumer props onto its ROOT div, so the id
          cannot be put on the landmark itself. */}
      <a href={`#${contentId}`} className="skip-link">{t('skipToContent')}</a>

      <AppShellLayout
        logo={logo}
        nav={nav}
        sidebarFooter={userMenu}
        navLabel={t('mainNavigation')}
        menuLabel={t('openNavigation')}
        drawerLabel={t('navigation')}
        pageLabel={pageLabel}
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

      {siteConfigs.imprint && (
        <footer className="home-view__imprint">{siteConfigs.imprint}</footer>
      )}
    </>
  );
}
