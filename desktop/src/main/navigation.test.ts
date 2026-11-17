import { describe, expect, it } from "vitest";
import { isAppUrl, judgeNavigation, originOf } from "./navigation";

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

describe("judgeNavigation", () => {
  const judge = (target: string, current: string, isRedirect = false) =>
    judgeNavigation({ target, current, isRedirect, appOrigin });

  it("keeps the app's own pages in the window", () => {
    expect(judge(`${appOrigin}/c/1`, app)).toBe("allow");
  });
  it("opens a link to another site in the browser", () => {
    expect(judge("https://example.com/paper.pdf", app)).toBe("external");
  });
  it("follows sign-on: the server's redirect, the provider's own steps, the way back", () => {
    expect(judge(idp, `${appOrigin}/api/auth/oidc/login`, true)).toBe("allow");
    expect(judge("https://login.example.org/auth/step2", idp)).toBe("allow");
    expect(judge("https://idp.other.example/sso", idp, true)).toBe("allow");
    expect(judge(`${appOrigin}/api/auth/oidc/callback?code=x`, idp)).toBe("allow");
  });
  it("refuses anything that is not http(s)", () => {
    expect(judge("file:///etc/passwd", app)).toBe("deny");
    expect(judge("javascript:alert(1)", idp)).toBe("deny");
    expect(judge("jlurag://kb/1", app, true)).toBe("deny");
  });
});
