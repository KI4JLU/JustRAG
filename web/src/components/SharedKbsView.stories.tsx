import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, waitFor, within } from 'storybook/test';
import { SharedKbsView } from './SharedKbsView';
import { AuthProvider } from '../contexts/AuthContext';
import { ModalProvider } from '../contexts/ModalContext';
import { AppNavProvider } from '../contexts/AppNavContext';
import { SharingProvider } from '../contexts/SharingContext';
import { useSharing } from '../hooks/useSharing';
import type { KnowledgeBase, User } from '../types';

/* ---------------------------------------------------------------------------
 * Stories for „Geteilte Knowledge Bases", the top-level view (card KI-783).
 *
 * WRITTEN TO THE PATTERN `HomeView.stories.tsx` ESTABLISHED, deliberately and
 * not decoratively: the same harness-versus-play-function split (the harness
 * supplies providers and data, never behaviour), the same real contexts, the
 * same network-boundary mocking through .storybook/mockApi.ts, and assertions
 * on roles and accessible names — never on a class string.
 *
 * THE ONE ORACLE THIS FILE EXISTS FOR, stated first because everything else is
 * secondary: **„shows the shared ones" and „shows everything" must not be able
 * to look alike.** A fixture of shared KBs alone would pass under either
 * behaviour, and so would a count badge read off such a fixture. So every
 * story here is handed a list containing BOTH owned and shared rows, and each
 * assertion has two halves: the shared names are present AND the owned names
 * are absent. Inverting `splitKbsByOwnership`'s predicate fails both halves.
 *
 * ORACLES, and why they are independent of the code under test:
 *  - `src/translations.ts` for every expected string. The view never computes
 *    a label; it looks one up, and the assertions read the table, not the view.
 *  - WAI-ARIA's role mappings (`h1` -> heading level 1, `main`, `nav`,
 *    `footer` -> contentinfo, `section[aria-label]` -> region), as
 *    @testing-library/dom implements them. Nothing in this repo computes them.
 *  - the FIXTURES below for which rows belong where. `myRole` is the input;
 *    which grid a row lands in is the output being checked.
 *  - the `fn()` spies in `args` for every navigation assertion: the expectation
 *    is a call count on the parent's callback, which the view cannot reach.
 *
 * WHAT A STORY IN THIS FILE STRUCTURALLY CANNOT CATCH — the same limit
 * `HomeView.stories.tsx` states, and the reason `App.authenticated-shared-kbs
 * .test.tsx` exists beside it: Storybook renders this component under the
 * providers the harness below mounts, so it can never tell you whether the
 * real app mounts them on the route this view is reached by. `AppChrome` calls
 * `useSharingContext()` and `useAppNav()`, both of which throw without a
 * provider, and this file would stay green if `AuthenticatedApp` forgot one.
 *
 * TIME-DEPENDENT OUTPUT IS NOT PINNED, for the reason the sibling file gives:
 * each card renders a relative „zuletzt aktiv" line derived from `Date.now()`,
 * and any fixture for it drifts with how long the suite takes to get there.
 * ------------------------------------------------------------------------- */

/* ===========================================================================
 * Fixtures
 * ======================================================================== */

const USER: User = { id: 'user-1', username: 'grace', role: 'user' };
/** The same person with a system role — KI-782 gates two chrome controls on it. */
const SYSTEM_ADMIN: User = { id: 'user-1', username: 'grace', role: 'admin' };

/** Kept configured on purpose: the chrome must render NO footer even when an
 * imprint is set (the developer removed it 2026-09-15). */
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

/** Owned by the signed-in user. These must NEVER appear on this view. */
const OWNED_ONE = privateKb({ id: 'kb-own-1', name: 'Mikrobiologie Notizen', fileCount: 12, turnCount: 34 });
const OWNED_TWO = privateKb({ id: 'kb-own-2', name: 'Pruefungsprotokolle' });

/** Shared with the signed-in user by someone else. These must ALL appear. */
const SHARED_EDITOR = privateKb({
  id: 'kb-shared-1',
  name: 'Fakultaetsprotokolle',
  myRole: 'edit',
  userId: 'user-9',
  ownerFirstName: 'Ada',
  ownerLastName: 'Lovelace',
  memberCount: 3,
});

const SHARED_VIEWER = privateKb({
  id: 'kb-shared-2',
  name: 'Vorlesungsmitschriften',
  myRole: 'view',
  userId: 'user-9',
  ownerUsername: 'ada',
  memberCount: 4,
});

/**
 * Shared, and the caller is a KB `admin` on it — the role that still offers the
 * share button. It is what makes the members dialog reachable from THIS view,
 * which is the whole reason that dialog is mounted in `AppChrome` rather than
 * on the overview page.
 */
const SHARED_ADMIN = privateKb({
  id: 'kb-shared-3',
  name: 'Institutssammlung',
  myRole: 'admin',
  userId: 'user-9',
  ownerUsername: 'ada',
  memberCount: 5,
});

/** Every fixture name, split the way the view is expected to split it. */
const OWNED_NAMES = ['Mikrobiologie Notizen', 'Pruefungsprotokolle'];
const SHARED_NAMES = ['Fakultaetsprotokolle', 'Vorlesungsmitschriften'];

/* ===========================================================================
 * The harness
 *
 * Providers and data, nothing else. The sharing concern is the REAL
 * `useSharing()` hook for the same reason the sibling file gives: the
 * `e.stopPropagation()` that keeps the share button from also opening the KB
 * lives inside that hook, so a stub would make every share assertion a
 * statement about the stub. Unlike the sibling file, the clipboard pair is not
 * overridden here — no story below touches it.
 * ======================================================================== */

/** Handlers no assertion reads. Spies so the Actions panel still shows them. */
const idle = () => fn();

interface SharedKbsStoryArgs {
  kbs: KnowledgeBase[];
  user: User;
  siteConfigs: Record<string, string>;
  removingKb: boolean;
  onSelectKB: (kb: KnowledgeBase) => void;
  onViewHome: () => void;
  onViewSharedKbs: () => void;
  onViewAgents: () => void;
}

function StorySharingProvider({ username, children }: { username: string; children: React.ReactNode }) {
  // Runs inside the tree .storybook/preview.tsx mounts, because the hook calls
  // useToast() and useTheme().
  const sharing = useSharing({ username });
  return <SharingProvider value={sharing}>{children}</SharingProvider>;
}

function SharedKbsHarness(args: SharedKbsStoryArgs) {
  return (
    <AuthProvider
      user={args.user}
      token="story-token"
      logout={idle()}
      updateUser={idle()}
      siteConfigs={args.siteConfigs}
    >
      <ModalProvider>
        <StorySharingProvider username={args.user.username}>
          <AppNavProvider
            value={{
              onViewHome: args.onViewHome,
              onViewSharedKbs: args.onViewSharedKbs,
              onViewProfile: idle(),
              onViewAdmin: idle(),
              onViewAgents: args.onViewAgents,
            }}
          >
            <SharedKbsView
              kbs={args.kbs}
              onSelectKB={args.onSelectKB}
              onDeleteKB={idle()}
              removingKb={args.removingKb}
              onOpenKbSettings={idle()}
              onRenameKB={idle()}
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

/** The one section id this view persists, i.e. its localStorage key. */
const SECTION_STORAGE_KEY = 'justrag.home.section.sharedview';

/** The page's single disclosure, found by the title a user reads. */
function sectionTrigger(canvas: Canvas): HTMLElement {
  return canvas.getByRole('button', { name: /^Mit mir geteilt/ });
}

/** The count badge, read as the trailing number of the trigger's text. */
function sectionCount(canvas: Canvas): string | null {
  const match = (sectionTrigger(canvas).textContent ?? '').trim().match(/(\d+)$/);
  return match === null ? null : match[1];
}

/**
 * The frame this view shares with the overview: one `<h1>`, one `<main>`, one
 * navigation landmark, one `contentinfo`, the `<h1>` inside the content region,
 * and a skip link that actually resolves to it.
 *
 * ORACLE: WAI-ARIA's role mappings plus src/translations.ts. The counts are
 * what make it directional — a second `<h1>` (the acceptance criterion names
 * that one explicitly) or a lost landmark fails here rather than looking fine.
 */
async function expectPageFrame(canvas: Canvas, canvasElement: HTMLElement) {
  await expect(canvas.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  await expect(canvas.getByRole('heading', { level: 1 }))
    .toHaveTextContent('Geteiltes Wissen');

  await expect(canvas.getAllByRole('main')).toHaveLength(1);
  await expect(canvas.getAllByRole('navigation')).toHaveLength(1);
  await expect(canvas.getByRole('navigation')).toHaveAccessibleName('Hauptnavigation');
  await expect(canvas.queryAllByRole('contentinfo')).toHaveLength(0);

  // The page heading belongs to the content template inside the shell, not to
  // a page header above it — the design system's heading rule, and the same
  // fact `HomeView.stories.tsx` pins for the overview.
  const region = canvas.getByRole('region', { name: 'Geteiltes Wissen' });
  await expect(region).toContainElement(canvas.getByRole('heading', { level: 1 }));

  // An id rename on one side alone breaks the skip link silently, so the
  // target is resolved rather than assumed — and it is this view's OWN id, not
  // the overview's.
  const skip = canvas.getByRole('link', { name: 'Zum Inhalt springen' });
  await expect(skip).toHaveAttribute('href', '#shared-kbs-main-content');
  await expect(canvasElement.querySelector('#shared-kbs-main-content')).toBe(region);
}

/* ===========================================================================
 * Meta
 * ======================================================================== */

const meta = {
  title: 'Views/SharedKbsView',
  component: SharedKbsHarness,
  parameters: { layout: 'fullscreen' },
  /**
   * Same determinism the sibling file needs, for the same two reasons: the
   * section's open state is persisted per ORIGIN in the browser runner (so one
   * story collapsing it would decide the next story's starting state), and
   * every string asserted below is a German one, which `useThemeAndLanguage`
   * reads from the same storage. Seeded in `beforeEach` rather than a
   * decorator because a decorator body runs INSIDE preview.tsx's ThemeProvider,
   * i.e. after its state initialiser has already read the key.
   */
  beforeEach: async () => {
    localStorage.removeItem(SECTION_STORAGE_KEY);
    localStorage.setItem('language', 'de');
    return () => { localStorage.removeItem(SECTION_STORAGE_KEY); };
  },
  args: {
    kbs: [],
    user: USER,
    siteConfigs: SITE_CONFIGS,
    removingKb: false,
    onSelectKB: fn(),
    onViewHome: fn(),
    onViewSharedKbs: fn(),
    onViewAgents: fn(),
  },
} satisfies Meta<typeof SharedKbsHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/* ===========================================================================
 * The load-bearing story: shared vs. everything
 * ======================================================================== */

/**
 * Two owned KBs and two shared ones, in one list, in the order the server
 * would return them. THE fixture of this file.
 *
 * Every assertion is a pair — shared present, owned absent — because either
 * half alone is satisfied by a view that renders the whole list. The count
 * badge is checked against the shared total for the same reason: `4` would
 * mean "shows everything", `2` means "shows the shared ones".
 */
export const OwnedAndShared: Story = {
  args: { kbs: [OWNED_ONE, SHARED_EDITOR, OWNED_TWO, SHARED_VIEWER] },
  play: async ({ canvas, canvasElement }) => {
    await expectPageFrame(canvas, canvasElement);

    // ORACLE: the fixture. Four rows in, two of them with a non-owner myRole.
    await expect(sectionCount(canvas)).toBe('2');

    // ORACLE: the fixture names, through each card's own open control.
    for (const name of SHARED_NAMES) {
      await expect(
        canvas.getByRole('button', { name: `Knowledge Base öffnen: ${name}` }),
      ).toBeInTheDocument();
    }
    // The half that makes the half above mean something.
    for (const name of OWNED_NAMES) {
      await expect(
        canvas.queryByRole('button', { name: `Knowledge Base öffnen: ${name}` }),
      ).toBeNull();
    }

    /* And once more at the level of the rendered cells, so a view that showed
     * the owned rows under some other accessible name would still fail:
     * exactly two cards are on the page. ORACLE: the fixture's shared count. */
    await expect(canvasElement.querySelectorAll('.home-view__kb-card')).toHaveLength(2);

    /* ORACLE: src/translations.ts (`sharedBy` = "von {name}") composed with the
     * fixture's owner names. It renders because the KB's userId differs from
     * the signed-in user's — and on this view, by construction, it renders on
     * every card. That is the difference between this page and the overview's
     * „Meine KBs" grid, and it is asserted rather than assumed. */
    await expect(canvas.getByText('von Ada Lovelace')).toBeInTheDocument();
    await expect(canvas.getByText('von ada')).toBeInTheDocument();
  },
};

export const OwnedAndSharedDark: Story = {
  ...OwnedAndShared,
  globals: { theme: 'dark' },
};

/* ===========================================================================
 * The empty state
 * ======================================================================== */

/**
 * A user who owns KBs but has had none shared with them.
 *
 * The fixture is NOT an empty list: it carries two owned rows, so that "empty"
 * is a statement about the split rather than about there being no data at all.
 * A view that rendered everything would show two cards here and no empty line.
 */
export const NothingSharedWithMe: Story = {
  args: { kbs: [OWNED_ONE, OWNED_TWO] },
  play: async ({ canvas, canvasElement }) => {
    await expectPageFrame(canvas, canvasElement);

    // ORACLE: the fixture — two rows, both `myRole: 'owner'`.
    await expect(sectionCount(canvas)).toBe('0');

    // ORACLE: src/translations.ts (`homeSharedWithMeEmpty`), the same sentence
    // the overview's section uses for the same absence.
    await expect(
      canvas.getByText('Dir wurde noch keine Knowledge Base freigegeben.'),
    ).toBeInTheDocument();

    // No card at all — including neither of the two owned ones.
    await expect(canvasElement.querySelectorAll('.home-view__kb-card')).toHaveLength(0);
  },
};

/* ===========================================================================
 * The nav row — the acceptance criterion this card was written for
 * ======================================================================== */

/**
 * `aria-current="page"` is on „Geteilte Knowledge Bases" and on nothing else,
 * and the other rows still go somewhere.
 *
 * ORACLE: `NavItem`'s documented mapping of `active` to `aria-current="page"`
 * (WAI-ARIA), src/translations.ts for the row labels, and the `fn()` spies for
 * the jumps. The "drops off the others" half is the one a careless wiring gets
 * wrong — a second `active` row is invisible until a screen reader announces
 * two current pages — so it is asserted as an exhaustive list of the elements
 * carrying the attribute, not as a single negative check.
 */
export const NavRowIsCurrent: Story = {
  args: { kbs: [SHARED_EDITOR] },
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const current = canvasElement.querySelectorAll('[aria-current]');
    await expect(current).toHaveLength(1);
    await expect(current[0]).toHaveAttribute('aria-current', 'page');
    await expect(current[0]).toHaveTextContent('Geteiltes Wissen');

    // ORACLE: translations.ts. The Overview row exists, is NOT current, and
    // reaches the jump — which is what makes this view leaveable.
    const overview = canvas.getByRole('button', { name: 'Mein Wissen' });
    await expect(overview).not.toHaveAttribute('aria-current');
    await userEvent.click(overview);
    await expect(args.onViewHome).toHaveBeenCalledTimes(1);

    /* ORACLE-LEVEL CHANGE (KI-782): „Meine Agenten" is gated on
     * `isSystemAdmin` and this story's fixture is an ordinary `USER`, so the
     * row is absent — where it used to be clicked here. The gate lives in
     * `AppChrome`, which BOTH top-level views render, and that is the fact
     * this pair of stories is worth keeping: the sibling story below renders
     * the same view for an admin and finds the row. `screen` rather than
     * `canvas` so a row that escaped into a portal would still be found. */
    await expect(screen.queryByRole('button', { name: 'Meine Agenten' })).toBeNull();
    await expect(args.onViewAgents).not.toHaveBeenCalled();
  },
};

/**
 * The same nav, seen by a system admin — the other side of KI-782's gate, on
 * the SECOND view.
 *
 * WHY IT IS HERE AND NOT ONLY IN `HomeView.stories.tsx`. The nav rows and the
 * user menu come from `AppChrome`, which both views render; a gate wired into
 * one page instead of the shared chrome would leave the two views with
 * different navigation, which is the drift the extraction exists to prevent.
 * That failure is invisible from the overview's stories alone.
 *
 * ORACLES: src/translations.ts for the names, the `fn()` spy for the jump, and
 * WAI-ARIA's button / menuitem role mappings.
 */
export const NavRowsAsSystemAdmin: Story = {
  args: { kbs: [SHARED_EDITOR], user: SYSTEM_ADMIN },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getAllByRole('button', { name: 'Meine Agenten' })).toHaveLength(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Meine Agenten' }));
    await expect(args.onViewAgents).toHaveBeenCalledTimes(1);

    /* „Admin-Einstellungen" is a `menuitem` in the sidebar's user menu since
     * KI-782, not a nav row — asserted on this view too, because the menu is
     * the chrome's and a per-page copy would be the same drift. `screen`, not
     * `canvas`: `DropdownMenuContent` renders through a Radix portal. */
    await expect(canvas.queryByRole('button', { name: 'Admin-Einstellungen' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: /^@grace/ }));
    const menu = within(await screen.findByRole('menu'));
    await expect(menu.getByRole('menuitem', { name: 'Admin-Einstellungen' })).toBeInTheDocument();
  },
};

/* ===========================================================================
 * The chrome the new view inherits rather than re-implements
 * ======================================================================== */

/**
 * The members dialog opens from a card on THIS view.
 *
 * WHY IT IS WORTH A STORY. The dialog is mounted by `AppChrome`, not by a
 * page. That placement is a decision this card made, and the failure it
 * prevents is silent in every other assertion here: leave the dialog on the
 * overview and this view still renders, still lists the right KBs, still has
 * one `<h1>` — and the share button on an `admin` card does nothing at all.
 *
 * `SHARED_ADMIN` is the fixture because `canManageMembers` offers the button to
 * `admin` and `owner` only, and an owner row cannot appear on this page by
 * definition. So the shared-KB admin is the ONLY way this control is reachable
 * here, which also makes the story a check on that role tier.
 *
 * ORACLE: the ARIA `dialog` role and the dialog's own `aria-labelledby`, plus
 * the `onSelectKB` spy for the propagation half — the control click reaches the
 * dialog and does NOT also open the KB, the behaviour that lives in the real
 * `useSharing.handleOpenShare` this harness mounts.
 */
export const ShareDialogOpensFromASharedKb: Story = {
  args: { kbs: [OWNED_ONE, SHARED_ADMIN] },
  parameters: {
    api: { kbMembers: { members: [], pending: [] }, kbInviteLinks: [] },
  },
  play: async ({ args, canvas, userEvent }) => {
    // Only the shared KB is here, and only it can offer the control.
    await expect(canvas.getAllByRole('button', { name: 'Teilen' })).toHaveLength(1);

    await userEvent.click(canvas.getByRole('button', { name: 'Teilen' }));

    await waitFor(async () => {
      await expect(canvas.getByRole('dialog')).toBeInTheDocument();
    });
    await expect(canvas.getByRole('dialog')).toHaveAttribute(
      'aria-labelledby',
      'members-modal-title',
    );

    // ORACLE: the parent's spy. The share click must not also open the KB —
    // the `e.stopPropagation()` in the production hook is what decides that.
    await expect(args.onSelectKB).not.toHaveBeenCalled();
  },
};

/* ===========================================================================
 * The role ladder, on a page where every row is somebody else's
 * ======================================================================== */

/**
 * A `view` member gets no share button, no rename pencil and no advanced
 * settings, and their remove action says "leave", not "delete".
 *
 * ORACLE: the role ladder in src/utils/kbAccess.ts as the CARD applies it,
 * against fixtures whose `myRole` is the input. It is asserted here and not
 * only on the overview because this view is where a non-owner row is the
 * NORMAL case rather than the exception — a card rendered with the wrong
 * `systemRole` or a missing `currentUserId` would widen these gates on exactly
 * this page and nowhere else.
 */
export const ViewerSeesNoManagementControls: Story = {
  args: { kbs: [SHARED_VIEWER] },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Teilen' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'Knowledge Base umbenennen' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'RAG-Einstellungen und Workflow' })).toBeNull();
    await expect(
      canvas.getByRole('button', { name: 'Aus meiner Ansicht entfernen' }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Knowledge Base löschen' })).toBeNull();

    /* ORACLE: the fixture's `memberCount: 4` with a private visibility, which
     * `visibilityBadge` renders with the count appended — the same badge
     * component the overview mounts, which is what "one renderer, two mount
     * points" has to mean at the level of rendered output. */
    await expect(canvas.getByText('Geteilt (4)')).toBeInTheDocument();
  },
};


/**
 * The colour-scheme switch is on THIS view too, in the same place (KI-788).
 *
 * WHY IT IS NOT ENOUGH TO ASSERT IT ON THE OVERVIEW. The toggle is mounted by
 * `AppChrome`'s sidebar footer, i.e. by the chrome both top-level views
 * render — but that is exactly the kind of claim KI-783 created this file to
 * stop taking on trust: a control wired into one page instead of the shared
 * chrome leaves the two views with different sidebars, and the overview's
 * stories cannot see it. The same argument `NavRowsAsSystemAdmin` above makes
 * for the nav gate.
 *
 * It matters more than usual on this card, because design-system 0.26.0 let
 * the old toggle disappear with no error of any kind: „it renders on the page
 * I looked at" is precisely the evidence that is not good enough here.
 *
 * ORACLES: the DOM's id semantics, WAI-ARIA's group/button mappings, and
 * src/translations.ts for the four names.
 */
export const ThemeToggleIsOnThisViewToo: Story = {
  args: { kbs: [SHARED_EDITOR] },
  play: async ({ canvas }) => {
    const groups = document.querySelectorAll('#theme-toggle');
    await expect(groups).toHaveLength(1);

    const group = groups[0] as HTMLElement;
    await expect(group).toHaveAttribute('aria-label', 'Farbschema');
    await expect(group.closest('[role="menu"]')).toBeNull();
    await expect(
      Array.from(group.querySelectorAll('button')).map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Helles Design', 'Systemdesign', 'Dunkles Design']);

    // And it is the only colour-scheme control on the page: the page-label bar
    // carries none since the template stopped hardcoding one.
    await expect(
      canvas.getAllByRole('button', {
        name: /Helles Design|Systemdesign|Dunkles Design|Wechsle zum (Dunkel|Hell)-Modus/,
      }),
    ).toHaveLength(3);
  },
};
