import { describe, expect, it } from "vitest";
import { NavigationGuard, isAppUrl, isAuthRoute, judgeNavigation, judgeSignInNavigation, originOf } from "./navigation";

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
  const judge = (target: string, redirectedFrom?: string) => judgeNavigation({ target, redirectedFrom, appOrigin });

  it("keeps the app's own pages in the window", () => {
    expect(judge(`${appOrigin}/c/1`)).toBe("allow");
    expect(judge(`${appOrigin}/`, login)).toBe("allow");
  });
  it("opens a link to another site in the browser", () => {
    expect(judge("https://example.com/paper.pdf")).toBe("external");
  });
  it("hands a redirect from an auth route to the sign-in window", () => {
    expect(judge(idp, login)).toBe("sign-in");
    expect(judge("https://login.example.org/logout", `${appOrigin}/api/auth/oidc/logout`)).toBe("sign-in");
  });
  it("takes no other redirect for a sign-in", () => {
    // An app route that answers with a redirect to another site (a link
    // resolver, a file's original address) is a link like any other.
    expect(judge("https://example.com/", `${appOrigin}/api/files/1/origin`)).toBe("external");
    // Nor a redirect chain that started on another site.
    expect(judge("https://b.example/", "https://a.example/")).toBe("external");
    // Nor a plain navigation to the provider, without the auth route.
    expect(judge(idp)).toBe("external");
  });
  it("refuses anything that is not http(s)", () => {
    expect(judge("file:///etc/passwd")).toBe("deny");
    expect(judge("javascript:alert(1)")).toBe("deny");
    expect(judge("jlurag://kb/1", login)).toBe("deny");
  });
});

describe("judgeSignInNavigation", () => {
  const judge = (target: string) => judgeSignInNavigation({ target, appOrigin });

  it("lets the flow go where the provider sends it, and through the app's auth routes", () => {
    expect(judge(`${appOrigin}/api/auth/oidc/login`)).toBe("allow");
    expect(judge(idp)).toBe("allow");
    expect(judge("https://idp.other.example/sso")).toBe("allow");
    expect(judge(`${appOrigin}/api/auth/oidc/callback?code=x`)).toBe("allow");
  });
  it("ends at the first other page of the app", () => {
    expect(judge(`${appOrigin}/#oidc=abc`)).toBe("done");
    expect(judge(`${appOrigin}/kb/abc`)).toBe("done");
  });
  it("refuses anything that is not http(s)", () => {
    expect(judge("file:///etc/passwd")).toBe("deny");
    expect(judge("jlurag://kb/1")).toBe("deny");
  });
});

describe("NavigationGuard", () => {
  const login = `${appOrigin}/api/auth/oidc/login`;
  const link = "https://example.com/paper.pdf";
  const guard = () => new NavigationGuard(appOrigin, app);

  it("names the auth route a sign-in redirect came from", () => {
    const g = guard();
    expect(g.judge(login, false)).toEqual({ verdict: "allow", from: undefined });
    g.started(login);
    expect(g.judge(idp, true)).toEqual({ verdict: "sign-in", from: login });
  });

  it("follows the app's own redirects before judging the next one", () => {
    const g = guard();
    g.started(`${appOrigin}/go`);
    expect(g.judge(login, true).verdict).toBe("allow");
    expect(g.judge(idp, true)).toEqual({ verdict: "sign-in", from: login });
  });

  it("names the redirect's sender by the load that started, not by an earlier one", () => {
    const g = guard();
    g.judge(login, false);
    g.started(login);
    // The address changed without a navigation (history API) and the page is
    // reloaded: only did-start-navigation reports that load.
    g.started(`${appOrigin}/ordinary`);
    expect(g.judge("https://example.com/", true)).toEqual({ verdict: "external", from: `${appOrigin}/ordinary` });
  });

  it("does not take a refused navigation as the sender of the next redirect", () => {
    const g = guard();
    expect(g.judge(link, false).verdict).toBe("external");
    g.started(login);
    expect(g.judge(idp, true).verdict).toBe("sign-in");
  });
});
