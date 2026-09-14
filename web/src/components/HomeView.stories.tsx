import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor, within } from 'storybook/test';
import { HomeView } from './HomeView';
import { AuthProvider } from '../contexts/AuthContext';
import { ModalProvider } from '../contexts/ModalContext';
import { apiMockHistory } from '../../.storybook/mockApi';
import type { KbAssignableRole, KnowledgeBase, User } from '../types';

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
 * that propagation itself — it delegates it to whoever passes the prop. The
 * harness therefore calls `stopPropagation()` too, and that line is a mirror of
 * production, not a convenience: without it the story would quietly exercise a
 * different app. It is also a coupling KI-770 has to keep when the handler
 * moves into context.
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
  onLogout: () => void;
  onCreateKB: () => void;
  onSelectKB: (kb: KnowledgeBase) => void;
  onOpenKbById: (id: string) => void;
}

/**
 * Supplies what `AuthenticatedApp.tsx:348-403` supplies, and nothing else.
 *
 * The four pieces of state below are owned here for the same reason
 * `AdminConfigsTab.stories.tsx` owns four of its own: handed constants, the
 * share dialog could never open and the states that depend on it would be
 * unreachable from a story. Everything that is genuinely the parent's business
 * — creating, deleting, renaming, opening settings — stays a spy, because a
 * story that faked those outcomes would be inventing behaviour rather than
 * recording this component's.
 */
function HomeViewHarness(args: HomeViewStoryArgs) {
  const [showShareModal, setShowShareModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sharingKb, setSharingKb] = useState<KnowledgeBase | null>(null);
  const [shareUserId, setShareUserId] = useState('');
  const [sharePermission, setSharePermission] = useState<KbAssignableRole>('view');

  return (
    <AuthProvider
      user={args.user}
      token="story-token"
      logout={args.onLogout}
      updateUser={idle()}
      siteConfigs={args.siteConfigs}
    >
      <ModalProvider>
        <HomeView
          kbs={args.kbs}
          globalKbs={args.globalKbs}
          currentKb={null}
          availableConfigs={[]}
          copySuccess={args.copySuccess}
          onCopyUserId={args.onCopyUserId}
          onLogout={args.onLogout}
          onViewProfile={args.onViewProfile}
          onViewAdmin={args.onViewAdmin}
          onViewAgents={args.onViewAgents}
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
          // Mirrors useSharing.handleOpenShare, stopPropagation included — see
          // the file header for why that single line is not a convenience.
          onOpenShare={(kb, e) => {
            e.stopPropagation();
            setSharingKb(kb);
            setShowShareModal(true);
          }}
          onUpdateKBSettings={idle()}
          showShareModal={showShareModal}
          setShowShareModal={setShowShareModal}
          sharingKb={sharingKb}
          shareUserId={shareUserId}
          setShareUserId={setShareUserId}
          shareTargetUser={null}
          shareLoading={false}
          sharePermission={sharePermission}
          setSharePermission={setSharePermission}
          onLookupUser={idle()}
          onConfirmShare={idle()}
          notFoundUsername={null}
          onPendingInvited={idle()}
          showSettings={showSettings}
          setShowSettings={setShowSettings}
        />
      </ModalProvider>
    </AuthProvider>
  );
}

/* ===========================================================================
 * Helpers shared by the play functions
 * ======================================================================== */

type Canvas = ReturnType<typeof within>;

/** The four accordion ids, i.e. the localStorage keys `KbAccordion` persists. */
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

/** The badge rendered next to an accordion title, or null when the section has no count. */
function sectionCount(canvas: Canvas, title: string): string | null {
  const badge = sectionTrigger(canvas, title).querySelector('.home-view__accordion-count');
  return badge === null ? null : badge.textContent;
}

/**
 * The overview's own theme button names the scheme it would switch TO, not the
 * one in effect — so its accessible name is a function of the story's theme
 * global and not a constant.
 *
 * The global is the oracle rather than `document.documentElement`'s
 * `data-theme`: that attribute is written by the provider under test, so
 * reading it back would be the code checking itself. The global is the input
 * .storybook/preview.tsx seeds the run with.
 */
function themeToggleName(globals: { theme?: unknown }): string {
  return globals.theme === 'dark' ? 'Wechsle zum Hell-Modus' : 'Wechsle zum Dunkel-Modus';
}

/** The six controls of the `home-view__actions` row, by accessible name, in DOM order. */
function actionRowNames(globals: { theme?: unknown }): string[] {
  return [
    'Benutzername kopieren',
    'Mein Profil',
    'Meine Agenten',
    themeToggleName(globals),
    // The language control's German label is an English sentence, because the
    // label names the language it switches to. Pinned as it stands.
    'Switch to English',
    'Abmelden',
  ];
}

function actionRow(canvasElement: HTMLElement): Canvas {
  const row = canvasElement.querySelector('.home-view__actions');
  if (row === null) throw new Error('home-view__actions is not rendered');
  return within(row as HTMLElement);
}

/**
 * Asserts the page frame that KI-696 replaces: one h1, one main, no nav, and
 * the skip link pointing at the main's own id.
 *
 * ORACLE: the WAI-ARIA role mappings for `h1`, `main`, `nav`, `header` and
 * `footer`, resolved by @testing-library/dom's implementation of them — not by
 * anything this repo computes. The counts are what make the assertion
 * directional: `SectionedGridLayout` brings its own `PageHeader` heading and
 * `AppShellLayout` brings a `nav`, so a migration that adds either without
 * removing the one here turns a 1 into a 2 and a 0 into a 1.
 */
async function expectPageFrame(canvas: Canvas) {
  await expect(canvas.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  await expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('Meine Knowledge Bases');

  await expect(canvas.getAllByRole('main')).toHaveLength(1);
  await expect(canvas.getByRole('main')).toHaveAttribute('id', 'home-main-content');

  // The honest before-state: the overview has no navigation landmark at all.
  await expect(canvas.queryAllByRole('navigation')).toHaveLength(0);

  await expect(canvas.getAllByRole('banner')).toHaveLength(1);
  await expect(canvas.getAllByRole('contentinfo')).toHaveLength(1);

  // The skip link is the only in-page jump the overview offers, and its target
  // is the main above — an id rename on one side alone breaks it silently.
  const skip = canvas.getByRole('link', { name: 'Zum Inhalt springen' });
  await expect(skip).toHaveAttribute('href', '#home-main-content');
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
   * `KbAccordion` persists each section's open/closed state under
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
  play: async ({ args, canvas, canvasElement, globals, userEvent }) => {
    await expectPageFrame(canvas);

    /* ORACLE: the German source strings in src/translations.ts, read back out
     * of the rendered document. Four sections, two of them open — and the open
     * ones are the two the component marks `defaultOpen`. */
    for (const [title, expanded] of [
      ['Favoriten', 'true'],
      ['KBs entdecken', 'false'],
      ['Mit mir geteilt', 'false'],
      ['Meine Knowledge Bases', 'true'],
    ] as const) {
      await expect(sectionTrigger(canvas, title)).toHaveAttribute('aria-expanded', expanded);
    }

    /* ORACLE: the ARIA mapping for `role="region"` with `aria-labelledby`,
     * which `KbAccordion` puts on the PANEL and not on the section. A closed
     * section contributes no region because its panel is not in the document
     * at all — so this count is the open/closed state read through the
     * accessibility tree rather than through a class name. */
    await expect(canvas.getAllByRole('region')).toHaveLength(2);

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

    /* ORACLE: WAI-ARIA accessible names. Exactly six controls in the action
     * row, each reachable by name. KI-696 relocates all six into the shell's
     * `nav` / `sidebarFooter`, so their survival IS that migration's test —
     * and the total is what catches one being dropped on the way.
     *
     * The row is scoped with `within` on purpose: after the move these names
     * must still resolve, but no longer from inside this container, and a
     * document-wide query would hide that difference. */
    const row = actionRow(canvasElement);
    for (const name of actionRowNames(globals)) {
      await expect(row.getAllByRole('button', { name })).toHaveLength(1);
    }
    await expect(row.getAllByRole('button')).toHaveLength(6);

    /* ORACLE: the union pattern in THEME_CONTROL_NAME, matched against the
     * whole canvas. An exact list rather than a length, so a failure names
     * what it found. Today: one control, this repo's own. */
    await expect(themeControlNames(canvas)).toEqual([themeToggleName(globals)]);

    /* ORACLE: the spies in `args`. Three of the six are wired straight to a
     * parent callback, and the click path — real pointer events through the
     * real button — is what proves the name resolves to something that acts. */
    await userEvent.click(row.getByRole('button', { name: 'Mein Profil' }));
    await expect(args.onViewProfile).toHaveBeenCalledTimes(1);
    await userEvent.click(row.getByRole('button', { name: 'Meine Agenten' }));
    await expect(args.onViewAgents).toHaveBeenCalledTimes(1);
    await userEvent.click(row.getByRole('button', { name: 'Benutzername kopieren' }));
    await expect(args.onCopyUserId).toHaveBeenCalledTimes(1);

    // ORACLE: the fixture user. An ordinary role gets neither the admin
    // floating action nor the create-a-public-KB tile.
    await expect(canvas.queryByRole('button', { name: 'Admin-Einstellungen' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'Globale KB erstellen' })).toBeNull();

    /* THE LAYOUT ENVELOPE, and the reason it is read from the CSSOM.
     *
     * ORACLE: Chromium's own computed style. A class-name assertion would pass
     * against a utility that compiles to nothing, which is the failure mode a
     * template swap produces; a computed value cannot.
     *
     * What is stated here is the shape KI-696 replaces: `main` is a bare block
     * that constrains nothing, and the 1000px measure lives on each individual
     * section instead. `SectionedGridLayout` inverts that — it owns the
     * measure — so both numbers move, and moving them silently is what this
     * catches. */
    const root = canvasElement.querySelector('.home-view');
    await expect(root).not.toBeNull();
    const rootStyle = getComputedStyle(root as HTMLElement);
    await expect(rootStyle.textAlign).toBe('center');
    await expect(rootStyle.paddingInlineStart).toBe('16px');

    const mainStyle = getComputedStyle(canvas.getByRole('main'));
    await expect(mainStyle.display).toBe('block');
    await expect(mainStyle.maxWidth).toBe('none');

    const section = canvasElement.querySelector('.home-view__section');
    await expect(section).not.toBeNull();
    await expect(getComputedStyle(section as HTMLElement).maxWidth).toBe('1000px');
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
    await expectPageFrame(canvas);

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

    /* ORACLE: Chromium's CSSOM. The grid track list is the layout envelope of
     * the card area — `repeat(auto-fill, minmax(280px, 1fr))` resolved against
     * the 1000px section measure at the runner's fixed 1280px viewport
     * (vitest.config.ts:99). Three tracks, and the count is what a different
     * template would change. */
    const grid = canvasElement.querySelector('.home-view__grid');
    await expect(grid).not.toBeNull();
    const gridStyle = getComputedStyle(grid as HTMLElement);
    await expect(gridStyle.display).toBe('grid');
    await expect(gridStyle.gap).toBe('24px');
    await expect(gridStyle.gridTemplateColumns.split(' ')).toHaveLength(3);
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
  play: async ({ canvas, canvasElement, globals }) => {
    await expectPageFrame(canvas);

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

    const favoriteCards = canvasElement
      .querySelectorAll('#home-section-panel-favorites .home-view__kb-card');
    await expect(favoriteCards).toHaveLength(2);
    for (const card of favoriteCards) {
      await expect(card).toHaveAttribute('role', 'button');
    }

    // Still exactly one colour-scheme control once the page carries content —
    // the same count assertion as in `Empty`, re-checked in both themes here.
    await expect(themeControlNames(canvas)).toEqual([themeToggleName(globals)]);
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
  play: async ({ canvas }) => {
    await expectPageFrame(canvas);

    // ORACLE: src/translations.ts + the fixture's `isPublished: true`.
    await expect(canvas.getAllByText('Veröffentlicht')).toHaveLength(2);
    await expect(canvas.getAllByRole('button', { name: 'Einstellungen bearbeiten' })).toHaveLength(2);
    await expect(canvas.getAllByRole('button', { name: 'Globale Knowledge Base löschen' })).toHaveLength(2);
    await expect(canvas.getByRole('button', { name: 'Globale KB erstellen' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Admin-Einstellungen' })).toBeInTheDocument();

    // The count is the LIST length and is not raised by the create tile.
    await expect(sectionCount(canvas, 'Favoriten')).toBe('2');

    // Still one theme control, and still six controls in the action row: the
    // admin branch adds a floating button, not a seventh row control.
    await expect(themeControlNames(canvas)).toEqual(['Wechsle zum Dunkel-Modus']);
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
    await expectPageFrame(canvas);

    // ORACLE: the fixture — one row with `myRole: 'owner'`, one with 'edit'.
    await expect(sectionCount(canvas, 'Meine Knowledge Bases')).toBe('1');
    await expect(sectionCount(canvas, 'Mit mir geteilt')).toBe('1');

    // The shared card is not merely hidden while the section is collapsed.
    await expect(canvasElement.querySelector('#home-section-panel-shared')).toBeNull();
    await expect(canvas.queryByRole('button', { name: /Fakultaetsprotokolle/ })).toBeNull();

    await userEvent.click(sectionTrigger(canvas, 'Mit mir geteilt'));
    await expect(canvasElement.querySelector('#home-section-panel-shared')).not.toBeNull();

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
  play: async ({ canvas, canvasElement }) => {
    /* ORACLE: `window.location.origin`, read from the browser. The app builds
     * this src as `API_BASE_URL + logo_path`, and .storybook/env.ts pins
     * API_BASE_URL to the serving origin — so the expected value is composed
     * from the browser's own property and the fixture, never from the app's
     * constant. The file is real (web/public/logo-test.svg), served by the
     * runner's publicDir, so this is a resolving image and not a broken one. */
    const logo = canvas.getByAltText('Website-Logo');
    await expect(logo).toHaveAttribute('src', `${window.location.origin}/logo-test.svg`);

    /* ORACLE: the WAI-ARIA landmark mapping again. With no imprint there is no
     * footer and therefore no contentinfo — the same assertion `expectPageFrame`
     * makes in the opposite direction, which is what makes either of them
     * falsifiable. */
    await expect(canvas.queryAllByRole('contentinfo')).toHaveLength(0);

    /* ORACLE: Chromium's CSSOM. `copySuccess` is rendered purely as colour
     * (`.home-view__copy-btn--success` sets the accent), so the check is that
     * the confirmed control computes to a DIFFERENT colour than an ordinary
     * icon button beside it. Comparing two live elements rather than asserting
     * one literal value keeps the assertion true under a token change and
     * false under a lost prop — and it cannot be satisfied by a class name
     * that compiles to nothing. */
    const row = actionRow(canvasElement);
    const copyButton = row.getByRole('button', { name: 'Benutzername kopieren' });
    const profileButton = row.getByRole('button', { name: 'Mein Profil' });
    await expect(getComputedStyle(copyButton).color).not.toBe(
      getComputedStyle(profileButton).color,
    );

    // The icon swaps with the same prop; both halves are pinned so a partial
    // rewrite that keeps the colour and drops the icon still fails.
    await expect(copyButton.querySelector('.lucide-check')).not.toBeNull();
    await expect(copyButton.querySelector('.lucide-copy')).toBeNull();
  },
};

/**
 * `removingKb` — the in-flight guard. One removal is running, so every remove
 * control on the page is refused, on a public card and a private one alike.
 * The prop reaches four separate call sites today.
 */
export const RemovalInFlight: Story = {
  args: { kbs: [OWNED_ONE], globalKbs: [PUBLIC_ONE], removingKb: true },
  play: async ({ canvas }) => {
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
    await expect(canvas.getByRole('button', { name: 'Abmelden' })).toBeEnabled();
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
    await expect(canvasElement.querySelector('#home-section-panel-discover')).toBeNull();
    await expect(canvas.queryByLabelText('Name oder Beschreibung suchen…')).toBeNull();
    await expect(catalogRequests()).toBe(0);

    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(canvasElement.querySelector('#home-section-panel-discover')).not.toBeNull();

    // The panel's search field is its own, and it appears with the mount.
    await expect(canvas.getByLabelText('Name oder Beschreibung suchen…')).toBeInTheDocument();

    // ORACLE: the mocked catalog rows. The fetch is debounced, hence `findBy`.
    await expect(await canvas.findByText('Bibliothek Bestandskatalog')).toBeInTheDocument();
    await waitFor(async () => {
      await expect(catalogRequests()).toBe(1);
    });

    // Collapsing takes the panel out of the document again.
    await userEvent.click(trigger);
    await expect(canvasElement.querySelector('#home-section-panel-discover')).toBeNull();
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
