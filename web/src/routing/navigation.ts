import { useCallback, useMemo } from 'react';
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import type { AppRouter } from './routes';
import { fromShortId, toShortId } from './shortId';

/** Views with no parameter of their own. */
export type PageView =
  | 'my-topics' | 'shared-topics' | 'discover' | 'tools' | 'profile'
  | 'terms' | 'privacy' | 'accessibility';

export type AgentsTab = 'agents' | 'teams';

/** Views of one topic; the topic id is part of the URL. */
export type KbScopedView = 'kb' | 'global-kb-settings';

/** The view the current URL names. */
export type AppRoute =
  | { view: PageView }
  /** The user's agents and teams, one tab each. */
  | { view: 'agents'; tab: AgentsTab }
  /** A topic, on a new chat. */
  | { view: 'kb'; kbId: string }
  /** An existing chat; its topic is the chat's own (resolved by AuthenticatedApp). */
  | { view: 'chat'; chatId: string }
  | { view: 'global-kb-settings'; kbId: string }
  /** No route matched, or a parameter is not one the page knows. */
  | { view: 'not-found' };

export type AppView = AppRoute['view'];

/** Where to go: `AppRoute` minus `not-found`. */
export type AppTarget =
  | { view: PageView }
  | { view: 'agents'; tab?: AgentsTab }
  | { view: 'kb'; kbId: string }
  | { view: 'chat'; chatId: string }
  | { view: 'global-kb-settings'; kbId: string };

export type AppNavigate = (target: AppTarget, opts?: { replace?: boolean }) => void;

/** Every route id of the tree (routes.ts), `__root__` included. */
export type AppRouteId = keyof AppRouter['routesById'];

interface LastMatch {
  /** Typed, so a case label below that names no route fails the type check. */
  routeId: AppRouteId;
  params: Record<string, string>;
}

/** The route for a short id in the path, or not-found when it names no UUID. */
function withId(segment: string, build: (uuid: string) => AppRoute): AppRoute {
  const uuid = fromShortId(segment);
  return uuid ? build(uuid) : { view: 'not-found' };
}

/** Maps the deepest matched route to the view it names; path ids are decoded to UUIDs. Pure, for tests. */
export function routeFromMatch(match: LastMatch | null): AppRoute {
  if (!match) return { view: 'not-found' };
  const { routeId, params } = match;
  switch (routeId) {
    case '/': return { view: 'my-topics' };
    case '/shared': return { view: 'shared-topics' };
    case '/discover': return { view: 'discover' };
    case '/tools': return { view: 'tools' };
    case '/agents': return { view: 'agents', tab: 'agents' };
    case '/agents/teams': return { view: 'agents', tab: 'teams' };
    case '/profile': return { view: 'profile' };
    case '/terms': return { view: 'terms' };
    case '/privacy': return { view: 'privacy' };
    case '/accessibility': return { view: 'accessibility' };
    case '/kb/$kbId/admin': return withId(params.kbId, (kbId) => ({ view: 'global-kb-settings', kbId }));
    case '/kb/$kbId': return withId(params.kbId, (kbId) => ({ view: 'kb', kbId }));
    case '/c/$chatId': return withId(params.chatId, (chatId) => ({ view: 'chat', chatId }));
    // The root alone: no child route matched the path.
    case '__root__': return { view: 'not-found' };
    default: {
      const unreachable: never = routeId;
      return unreachable;
    }
  }
}

/**
 * The view the current URL names.
 *
 * Matched from `location`, not read from `matches`, and the difference is
 * load-bearing. A navigation updates the router's location in the same render
 * as the state the click set alongside it, but `matches` only one render
 * later, after the router's (async) load. Reading `matches`, a click that sets
 * `currentKb` and navigates renders once with the NEW topic and the OLD URL —
 * and the route sync in AuthenticatedApp then "restores" the old topic over
 * the new one. Matching the location synchronously keeps the two in step.
 */
export function useAppRoute(): AppRoute {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return useMemo(() => {
    const [, params, found] = router.getMatchedRoutes(pathname);
    return routeFromMatch(found ? { routeId: found.id as AppRouteId, params } : null);
  }, [router, pathname]);
}

/**
 * Navigation by view rather than by path, so the hooks that navigate
 * (useKnowledgeBases, useViewState) take a plain function and stay testable
 * without a router. Each case is a typed `navigate` call: a renamed route or a
 * missing parameter fails the type check here, not at runtime.
 */
export function useAppNavigate(): AppNavigate {
  const navigate = useNavigate();
  return useCallback((target: AppTarget, opts?: { replace?: boolean }) => {
    const replace = opts?.replace;
    switch (target.view) {
      case 'my-topics': void navigate({ to: '/', replace }); return;
      case 'shared-topics': void navigate({ to: '/shared', replace }); return;
      case 'discover': void navigate({ to: '/discover', replace }); return;
      case 'tools': void navigate({ to: '/tools', replace }); return;
      case 'agents': void navigate({ to: target.tab === 'teams' ? '/agents/teams' : '/agents', replace }); return;
      case 'profile': void navigate({ to: '/profile', replace }); return;
      case 'terms': void navigate({ to: '/terms', replace }); return;
      case 'privacy': void navigate({ to: '/privacy', replace }); return;
      case 'accessibility': void navigate({ to: '/accessibility', replace }); return;
      case 'global-kb-settings':
        void navigate({ to: '/kb/$kbId/admin', params: { kbId: toShortId(target.kbId) }, replace });
        return;
      case 'kb': void navigate({ to: '/kb/$kbId', params: { kbId: toShortId(target.kbId) }, replace }); return;
      case 'chat': void navigate({ to: '/c/$chatId', params: { chatId: toShortId(target.chatId) }, replace }); return;
      default: {
        const unreachable: never = target;
        throw new Error(`unknown view ${JSON.stringify(unreachable)}`);
      }
    }
  }, [navigate]);
}
