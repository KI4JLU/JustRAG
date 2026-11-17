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

/**
 * What happens to a navigation of the window's main frame.
 *
 * The window is for the web app, so a link to another site opens in the
 * user's browser. Single sign-on is the exception: the app's server redirects
 * the window to the identity provider, which may pass it on, and it comes
 * back by itself. That flow is recognised by how it travels, not by a list of
 * providers (they are an admin setting of the deployment): it starts as a
 * server redirect from the app, and continues from a page that is already
 * outside the app.
 */
export function judgeNavigation(input: {
  target: string;
  /** The page the window shows now. */
  current: string;
  /** A server redirect (`will-redirect`), not a link or script on the page. */
  isRedirect: boolean;
  appOrigin: string;
}): NavigationVerdict {
  const targetOrigin = originOf(input.target);
  if (!targetOrigin) return "deny"; // file:, javascript:, custom schemes, malformed
  if (targetOrigin === input.appOrigin) return "allow";
  if (input.isRedirect) return "allow";
  if (!isAppUrl(input.current, input.appOrigin)) return "allow";
  return "external";
}
