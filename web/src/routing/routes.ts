import { createRootRoute, createRoute, createRouter, type RouteComponent, type RouterHistory } from '@tanstack/react-router';

/* The app's URL schema (TanStack Router, code-based route tree).
 *
 * The routes carry no components of their own. The root route renders the
 * whole app shell (`AppRoot`: providers, then the login screen or the
 * authenticated app), and the authenticated app reads the matched route
 * through `useAppRoute` (navigation.ts) to pick the view it renders. That
 * keeps every view inside the one component that owns the shared state the
 * views need (current topic, chat, files, sources), exactly as before the
 * router; what changed is that the URL, not a `useState`, says which view is
 * open, so a reload, a deep link and the browser's back/forward all land on
 * the right one.
 *
 * Paths are flat children of the root on purpose: no view nests inside
 * another's layout, and a flat list reads as the URL table it is. Ids in
 * paths are short (routing/shortId.ts): `/kb/0N3v1G7NSaWn5C8vH_g8gQ`, not the
 * 36-character UUID.
 */
function buildRouteTree(rootComponent: RouteComponent) {
  // Unmatched paths render nothing here: the authenticated app sees the
  // `not-found` route and replaces the URL with the overview, the login
  // screen ignores the path.
  const rootRoute = createRootRoute({ component: rootComponent, notFoundComponent: () => null });
  // One const per route: created inline inside `addChildren([...])`, a
  // route's `getParentRoute` makes its type circular and TypeScript widens
  // the whole tree, which silently turns every typed `navigate` into an
  // untyped one.
  const myTopics = createRoute({ getParentRoute: () => rootRoute, path: '/' });
  const sharedTopics = createRoute({ getParentRoute: () => rootRoute, path: '/shared' });
  const discover = createRoute({ getParentRoute: () => rootRoute, path: '/discover' });
  const tools = createRoute({ getParentRoute: () => rootRoute, path: '/tools' });
  const agents = createRoute({ getParentRoute: () => rootRoute, path: '/agents' });
  const agentTeams = createRoute({ getParentRoute: () => rootRoute, path: '/agents/teams' });
  const profile = createRoute({ getParentRoute: () => rootRoute, path: '/profile' });
  const terms = createRoute({ getParentRoute: () => rootRoute, path: '/terms' });
  const privacy = createRoute({ getParentRoute: () => rootRoute, path: '/privacy' });
  const accessibility = createRoute({ getParentRoute: () => rootRoute, path: '/accessibility' });
  // The system-admin editor of a public topic (GlobalKbSettings).
  const globalKbSettings = createRoute({ getParentRoute: () => rootRoute, path: '/kb/$kbId/admin' });
  const kb = createRoute({ getParentRoute: () => rootRoute, path: '/kb/$kbId' });
  // A chat by its id alone: the chat knows its topic (GET /api/chats/{id}).
  const chat = createRoute({ getParentRoute: () => rootRoute, path: '/c/$chatId' });

  return rootRoute.addChildren([
    myTopics, sharedTopics, discover, tools, agents, agentTeams, profile, terms, privacy, accessibility,
    globalKbSettings, kb, chat,
  ]);
}

interface CreateAppRouterOptions {
  /** What the root route renders — the app shell in production, the unit under test in tests. */
  rootComponent: RouteComponent;
  /** Defaults to the browser history; tests may pass a memory history. */
  history?: RouterHistory;
}

export function createAppRouter({ rootComponent, history }: CreateAppRouterOptions) {
  return createRouter({
    routeTree: buildRouteTree(rootComponent),
    ...(history ? { history } : {}),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
