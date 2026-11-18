// Which addresses belong to the app, and where a navigation may go. Pure, so
// the rules are tested without a window.

/** The web app's origin, e.g. "https://atlas.example.org". */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** True for a page of the web app itself: only those get the bridge. */
export function isAppUrl(url: string, appOrigin: string): boolean {
  return originOf(url) === appOrigin;
}

export type NavigationVerdict = "allow" | "sign-in" | "external" | "deny";

/** The app's routes that hand over to a sign-in provider and take the answer back. */
const AUTH_PATH = "/api/auth/";

/** True for the app's own sign-in and sign-out routes. */
export function isAuthRoute(url: string, appOrigin: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === appOrigin && parsed.pathname.startsWith(AUTH_PATH);
  } catch {
    return false;
  }
}

/**
 * What happens to a navigation of the app window's main frame.
 *
 * The window shows the web app and nothing else, so a link to another site
 * opens in the user's browser. Single sign-on is the one case the host keeps:
 * one of the app's auth routes redirects to the identity provider, and that
 * runs in a window of its own (`sign-in`). The providers are an admin setting
 * of the deployment, so the flow is recognised by where it starts, not by a
 * list.
 */
export function judgeNavigation(input: {
  target: string;
  /** For a server redirect: the address that answered with it. */
  redirectedFrom?: string;
  appOrigin: string;
}): NavigationVerdict {
  const targetOrigin = originOf(input.target);
  if (!targetOrigin) return "deny"; // file:, javascript:, custom schemes, malformed
  if (targetOrigin === input.appOrigin) return "allow";
  if (input.redirectedFrom !== undefined && isAuthRoute(input.redirectedFrom, input.appOrigin)) return "sign-in";
  return "external";
}

/**
 * What happens to a navigation of the sign-in window's main frame. It may go
 * wherever the provider sends it, and through the app's auth routes. The
 * first other page of the app is the flow's answer (`done`): that one belongs
 * to the app window.
 */
export function judgeSignInNavigation(input: { target: string; appOrigin: string }): "allow" | "done" | "deny" {
  const targetOrigin = originOf(input.target);
  if (!targetOrigin) return "deny";
  if (targetOrigin === input.appOrigin && !isAuthRoute(input.target, input.appOrigin)) return "done";
  return "allow";
}

/**
 * The address the app window's main frame is asking for right now, fed by its
 * events, so a redirect is judged by who sent it.
 */
export class NavigationGuard {
  private request: string;

  constructor(
    private readonly appOrigin: string,
    startUrl: string,
  ) {
    this.request = startUrl;
  }

  /**
   * The main frame started loading a document (`did-start-navigation`, not
   * same-document). Also covers what `will-navigate` does not report: a
   * reload, a step in the history, a load the host started.
   */
  started(url: string): void {
    this.request = url;
  }

  /**
   * `will-navigate` (`isRedirect` false) or `will-redirect` (true) of the main
   * frame. `from` is the redirect's sender.
   */
  judge(target: string, isRedirect: boolean): { verdict: NavigationVerdict; from?: string } {
    const from = isRedirect ? this.request : undefined;
    const verdict = judgeNavigation({ target, redirectedFrom: from, appOrigin: this.appOrigin });
    if (verdict === "allow") this.request = target;
    return { verdict, from };
  }
}
