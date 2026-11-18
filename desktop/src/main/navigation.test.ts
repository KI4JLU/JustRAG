import { describe, expect, it } from "vitest";
import { NavigationGuard, isAppUrl, isAuthRoute, judgeNavigation, originOf } from "./navigation";

const appOrigin = "https://atlas.example.org";
const app = `${appOrigin}/kb/abc`;
const idp = "https://login.example.org/auth";

describe("originOf", () => {
  it("returns the origin of an http(s) address", () => {
    expect(originOf("https://atlas.example.org/c/1?x=1")).toBe(appOrigin);
    expect(originOf("http://localhost:5173/")).toBe("http://localhost:5173");
  });
  it("refuses other schemes and malformed input", () => {
    expect(originOf("file:///etc/passwd")).toBeNull();
    expect(originOf("javascript:alert(1)")).toBeNull();
    expect(originOf("not a url")).toBeNull();
  });
});

describe("isAppUrl", () => {
  it("matches the origin exactly", () => {
    expect(isAppUrl(app, appOrigin)).toBe(true);
    expect(isAppUrl("https://atlas.example.org.evil.test/", appOrigin)).toBe(false);
    expect(isAppUrl("http://atlas.example.org/", appOrigin)).toBe(false);
    expect(isAppUrl("https://atlas.example.org:8443/", appOrigin)).toBe(false);
  });
});

describe("isAuthRoute", () => {
  it("is the app's own auth routes only", () => {
    expect(isAuthRoute(`${appOrigin}/api/auth/oidc/login?provider=1`, appOrigin)).toBe(true);
    expect(isAuthRoute(`${appOrigin}/api/files/1`, appOrigin)).toBe(false);
    expect(isAuthRoute("https://evil.test/api/auth/oidc/login", appOrigin)).toBe(false);
  });
});

describe("judgeNavigation", () => {
  const login = `${appOrigin}/api/auth/oidc/login`;
  const judge = (target: string, opts: { redirectedFrom?: string; inSignIn?: boolean } = {}) =>
    judgeNavigation({ target, appOrigin, inSignIn: false, ...opts });
  const verdict = (...args: Parameters<typeof judge>) => judge(...args).verdict;

  it("keeps the app's own pages in the window", () => {
    expect(verdict(`${appOrigin}/c/1`)).toBe("allow");
    expect(verdict(`${appOrigin}/c/1`, { inSignIn: true })).toBe("allow");
  });
  it("opens a link to another site in the browser", () => {
    expect(verdict("https://example.com/paper.pdf")).toBe("external");
  });
  it("opens sign-in only through a redirect from an auth route", () => {
    expect(judge(idp, { redirectedFrom: login })).toEqual({ verdict: "allow", startsSignIn: true });
  });
  it("follows an open sign-in: the provider's own steps, a second provider, the way back", () => {
    expect(verdict("https://login.example.org/auth/step2", { inSignIn: true })).toBe("allow");
    expect(verdict("https://idp.other.example/sso", { inSignIn: true, redirectedFrom: idp })).toBe("allow");
    expect(verdict(`${appOrigin}/api/auth/oidc/callback?code=x`, { inSignIn: true })).toBe("allow");
  });
  it("does not let any other redirect take the window off the app", () => {
    // An app route that answers with a redirect to another site (a link
    // resolver, a file's original address) is a link like any other.
    expect(verdict("https://example.com/", { redirectedFrom: `${appOrigin}/api/files/1/origin` })).toBe("external");
    // Nor a redirect chain that started on another site.
    expect(verdict("https://b.example/", { redirectedFrom: "https://a.example/" })).toBe("external");
  });
  it("refuses anything that is not http(s)", () => {
    expect(verdict("file:///etc/passwd")).toBe("deny");
    expect(verdict("javascript:alert(1)", { inSignIn: true })).toBe("deny");
    expect(verdict("jlurag://kb/1", { redirectedFrom: login })).toBe("deny");
  });
});

describe("NavigationGuard", () => {
  const login = `${appOrigin}/api/auth/oidc/login`;
  const callback = `${appOrigin}/api/auth/oidc/callback?code=x`;
  const link = "https://example.com/paper.pdf";
  const guard = () => new NavigationGuard(appOrigin, app);

  it("carries a sign-in from the auth route to the provider and back, then closes it", () => {
    const g = guard();
    expect(g.judge(login, false).verdict).toBe("allow");
    g.started(login);
    expect(g.judge(idp, true)).toMatchObject({ verdict: "allow", signIn: true, from: login });
    g.settled(idp);
    // The provider's form post, then its redirect back to the app.
    expect(g.judge("https://login.example.org/auth/submit", false).verdict).toBe("allow");
    g.started("https://login.example.org/auth/submit");
    expect(g.judge(callback, true).verdict).toBe("allow");
    g.settled(app);
    expect(g.judge(link, false)).toMatchObject({ verdict: "external", signIn: false });
  });

  it("closes a sign-in that was stopped before the provider's page appeared", () => {
    const g = guard();
    g.started(login);
    expect(g.judge(idp, true).verdict).toBe("allow");
    // Loading stops; the window still shows the app's page.
    g.settled(app);
    expect(g.judge(link, false).verdict).toBe("external");
  });

  it("keeps a sign-in open while the window is on the provider's page", () => {
    const g = guard();
    g.started(login);
    g.judge(idp, true);
    g.settled(idp);
    expect(g.judge("https://login.example.org/auth/step2", false).verdict).toBe("allow");
  });

  it("names the redirect's sender by the load that started, not by an earlier one", () => {
    const g = guard();
    g.judge(login, false);
    g.started(login);
    // The address changed without a navigation (history API) and the page is
    // reloaded: only did-start-navigation reports that load.
    g.started(`${appOrigin}/ordinary`);
    expect(g.judge("https://example.com/", true)).toMatchObject({ verdict: "external", from: `${appOrigin}/ordinary` });
  });

  it("does not take a refused navigation as the sender of the next redirect", () => {
    const g = guard();
    expect(g.judge(link, false).verdict).toBe("external");
    g.started(login);
    expect(g.judge(idp, true).verdict).toBe("allow");
  });
});
