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

export type NavigationVerdict = "allow" | "external" | "deny";

/** The app's routes that hand the window to a sign-in provider and take it back. */
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
 * What happens to a navigation of the window's main frame.
 *
 * The window is for the web app, so a link to another site opens in the
 * user's browser. Single sign-on is the one exception: one of the app's auth
 * routes redirects the window to the identity provider, which may pass it on,
 * and it comes back by itself. The providers are an admin setting of the
 * deployment, so the flow is recognised by where it starts, not by a list:
 * only a redirect from an auth route opens it (`startsSignIn`), and only
 * while it is open may the window move between pages outside the app.
 */
export function judgeNavigation(input: {
  target: string;
  /** For a server redirect: the address that answered with it. */
  redirectedFrom?: string;
  /** A sign-in flow is open: the window left the app through an auth route. */
  inSignIn: boolean;
  appOrigin: string;
}): { verdict: NavigationVerdict; startsSignIn: boolean } {
  const targetOrigin = originOf(input.target);
  if (!targetOrigin) return { verdict: "deny", startsSignIn: false }; // file:, javascript:, custom schemes, malformed
  if (targetOrigin === input.appOrigin) return { verdict: "allow", startsSignIn: false };
  if (input.redirectedFrom !== undefined && isAuthRoute(input.redirectedFrom, input.appOrigin)) {
    return { verdict: "allow", startsSignIn: true };
  }
  if (input.inSignIn) return { verdict: "allow", startsSignIn: false };
  return { verdict: "external", startsSignIn: false };
}

/**
 * The window's navigation state, fed by its events. It holds what
 * `judgeNavigation` needs: the address the main frame is asking for right
 * now — so a redirect knows who sent it — and whether a sign-in is open.
 */
export class NavigationGuard {
  private inSignIn = false;
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

  /** `will-navigate` (`isRedirect` false) or `will-redirect` (true) of the main frame. */
  judge(target: string, isRedirect: boolean): { verdict: NavigationVerdict; signIn: boolean; from?: string } {
    const from = isRedirect ? this.request : undefined;
    const { verdict, startsSignIn } = judgeNavigation({
      target,
      redirectedFrom: from,
      inSignIn: this.inSignIn,
      appOrigin: this.appOrigin,
    });
    if (verdict === "allow") {
      if (startsSignIn) this.inSignIn = true;
      this.request = target;
    }
    return { verdict, signIn: this.inSignIn, from };
  }

  /**
   * The window shows `shownUrl` and is not on its way elsewhere: a page was
   * committed, or loading stopped (finished, failed, cancelled). On a page of
   * the app the sign-in is over — completed, or given up before the
   * provider's page appeared.
   */
  settled(shownUrl: string): void {
    if (isAppUrl(shownUrl, this.appOrigin)) this.inSignIn = false;
  }
}
