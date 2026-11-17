package authhandler

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/justrag/go-backend/internal/adminproviders"
	"github.com/justrag/go-backend/internal/users"
)

// fakeIdP is an OpenID provider as far as the login callback and the logout
// need one: discovery, a key set, and a token endpoint that answers every
// code with an ID token for sub-123.
type fakeIdP struct {
	*httptest.Server
	key     *rsa.PrivateKey
	idToken string // the raw ID token the token endpoint handed out last
}

func newFakeIdP(t *testing.T) *fakeIdP {
	t.Helper()
	return newFakeIdPWithEndSession(t, "/logout")
}

// newFakeIdPWithEndSession advertises endSession as its end_session_endpoint:
// a path on the IdP, "" for none, or any other value verbatim.
func newFakeIdPWithEndSession(t *testing.T, endSession string) *fakeIdP {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	idp := &fakeIdP{key: key}
	mux := http.NewServeMux()
	writeJSON := func(w http.ResponseWriter, v any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(v)
	}
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		doc := map[string]any{
			"issuer":                                idp.URL,
			"authorization_endpoint":                idp.URL + "/auth",
			"token_endpoint":                        idp.URL + "/token",
			"jwks_uri":                              idp.URL + "/keys",
			"id_token_signing_alg_values_supported": []string{"RS256"},
		}
		switch {
		case strings.HasPrefix(endSession, "/"):
			doc["end_session_endpoint"] = idp.URL + endSession
		case endSession != "":
			doc["end_session_endpoint"] = endSession
		}
		writeJSON(w, doc)
	})
	mux.HandleFunc("/keys", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]any{"keys": []map[string]string{{
			"kty": "RSA", "alg": "RS256", "use": "sig", "kid": "k1",
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, _ *http.Request) {
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
			"iss": idp.URL, "aud": "justrag", "sub": "sub-123",
			"email": "alice@example.com", "email_verified": true, "preferred_username": "alice",
			"iat": time.Now().Unix(), "exp": time.Now().Add(time.Minute).Unix(),
		})
		tok.Header["kid"] = "k1"
		raw, err := tok.SignedString(key)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		idp.idToken = raw
		writeJSON(w, map[string]any{"access_token": "at", "token_type": "Bearer", "id_token": raw})
	})
	idp.Server = httptest.NewServer(mux)
	t.Cleanup(idp.Close)
	return idp
}

// oidcHandler is a Handler whose active provider is idp, with the callback at
// redirectURI (the URL the browser sees).
func oidcHandler(t *testing.T, providerID, issuerURL, redirectURI string) (*Handler, *fakeOIDCStore) {
	t.Helper()
	cfg, err := json.Marshal(OIDCConfig{
		IssuerURL:             issuerURL,
		ClientID:              "justrag",
		RedirectURI:           redirectURI,
		PostLogoutRedirectURI: "https://rag.example/",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { InvalidateOIDCProviderCache(providerID) })
	store := &fakeOIDCStore{
		provider: &adminproviders.AuthProviderRow{ID: providerID, Type: OIDCProviderType, Config: cfg, IsActive: true},
		byExternalID: map[string]*users.UserRow{
			"sub-123": {ID: "u1", Username: "alice", Role: "user", AuthMethod: "oidc"},
		},
	}
	return NewHandler(store, "test-secret-test-secret-test-secret", nil), store
}

const testCallbackURL = "https://rag.example/api/auth/oidc/callback"

func cookieNamed(rec *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, c := range rec.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

// login runs the callback for a code the fake IdP accepts, the way the
// browser returns from it: state, verifier and provider cookies set.
func login(t *testing.T, h *Handler, providerID string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "https://rag.example/api/auth/oidc/callback?state=s1&code=c1", nil)
	req.AddCookie(&http.Cookie{Name: oidcStateCookie, Value: "s1"})
	req.AddCookie(&http.Cookie{Name: oidcVerifierCookie, Value: "v1"})
	req.AddCookie(&http.Cookie{Name: oidcProviderCookie, Value: providerID})
	rec := httptest.NewRecorder()
	h.OIDCCallback(rec, req)
	if rec.Code != http.StatusFound || !strings.Contains(rec.Header().Get("Location"), "#oidc=") {
		t.Fatalf("callback: status %d, Location %q — want a successful login", rec.Code, rec.Header().Get("Location"))
	}
	return rec
}

func endSessionQuery(t *testing.T, rec *httptest.ResponseRecorder) url.Values {
	t.Helper()
	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", rec.Code)
	}
	loc, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if loc.Path != "/logout" {
		t.Fatalf("redirect path = %q, want the IdP's end_session_endpoint", loc.Path)
	}
	return loc.Query()
}

// A login leaves the IdP's ID token in a cookie only the logout route gets,
// and the logout hands exactly that token to the IdP as id_token_hint — that
// is what lets it log out without a confirmation page.
func TestOIDC_LoginThenLogoutSendsIDTokenHint(t *testing.T) {
	idp := newFakeIdP(t)
	h, _ := oidcHandler(t, "login-logout", idp.URL, testCallbackURL)

	c := cookieNamed(login(t, h, "login-logout"), oidcIDTokenCookie)
	if c == nil {
		t.Fatal("the callback set no id_token cookie")
	}
	if c.Value != idp.idToken {
		t.Errorf("cookie holds %q, want the IdP's ID token", c.Value)
	}
	// Strict: a link on another site must not reach the logout with the hint.
	if c.Path != "/api/auth/oidc/logout" || !c.HttpOnly || !c.Secure ||
		c.SameSite != http.SameSiteStrictMode || c.MaxAge != int(tokenLifetime.Seconds()) {
		t.Errorf("cookie attributes = %+v", c)
	}

	req := httptest.NewRequest(http.MethodGet, "https://rag.example/api/auth/oidc/logout", nil)
	req.AddCookie(&http.Cookie{Name: c.Name, Value: c.Value})
	req.Header.Set("Sec-Fetch-Site", "same-origin") // the app's own navigation
	rec := httptest.NewRecorder()
	h.OIDCLogout(rec, req)

	q := endSessionQuery(t, rec)
	if got := q.Get("id_token_hint"); got != idp.idToken {
		t.Errorf("id_token_hint = %q, want the login's ID token", got)
	}
	if got := q.Get("client_id"); got != "justrag" {
		t.Errorf("client_id = %q", got)
	}
	if got := q.Get("post_logout_redirect_uri"); got != "https://rag.example/" {
		t.Errorf("post_logout_redirect_uri = %q", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q: the redirect carries the token", got)
	}
	// Used once: the logout clears the cookie, on the path it was set on.
	if cleared := cookieNamed(rec, oidcIDTokenCookie); cleared == nil || cleared.MaxAge >= 0 || cleared.Path != c.Path {
		t.Errorf("logout did not clear the id_token cookie: %+v", cleared)
	}
}

// Without the cookie (a login from before it existed, an oversized token)
// the logout still works, only without the hint.
func TestOIDCLogout_NoCookieNoHint(t *testing.T) {
	idp := newFakeIdP(t)
	h, _ := oidcHandler(t, "logout-without-hint", idp.URL, testCallbackURL)
	req := httptest.NewRequest(http.MethodGet, "https://rag.example/api/auth/oidc/logout", nil)
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	rec := httptest.NewRecorder()

	h.OIDCLogout(rec, req)

	q := endSessionQuery(t, rec)
	if q.Has("id_token_hint") {
		t.Errorf("id_token_hint = %q, want none", q.Get("id_token_hint"))
	}
	if got := q.Get("client_id"); got != "justrag" {
		t.Errorf("client_id = %q", got)
	}
	if c := cookieNamed(rec, oidcIDTokenCookie); c != nil {
		t.Errorf("logout without a cookie wrote one: %+v", c)
	}
}

// The hint goes only to a logout the app started. A link on another host —
// a sibling host of the same site still gets the Strict cookie — reaches the
// IdP without it and meets the confirmation page, and it cannot spend the
// user's hint either: the cookie stays.
func TestOIDCLogout_HintOnlyForTheApp(t *testing.T) {
	cases := []struct {
		name     string
		headers  map[string]string
		wantHint bool
	}{
		{"app on the API's origin", map[string]string{"Sec-Fetch-Site": "same-origin"}, true},
		{"app on its own origin, the post-logout one", map[string]string{"Sec-Fetch-Site": "same-site", "Referer": "https://rag.example/kb/abc"}, true},
		{"sibling host of the same site", map[string]string{"Sec-Fetch-Site": "same-site", "Referer": "https://other.example/page"}, false},
		{"same host, other scheme", map[string]string{"Sec-Fetch-Site": "same-site", "Referer": "http://rag.example/"}, false},
		{"another site", map[string]string{"Sec-Fetch-Site": "cross-site", "Referer": "https://evil.test/"}, false},
		{"typed URL", map[string]string{"Sec-Fetch-Site": "none"}, false},
		{"no header at all", nil, false},
	}
	idp := newFakeIdP(t)
	// The API on its own host, the web app on rag.example (PostLogoutRedirectURI).
	h, _ := oidcHandler(t, "logout-initiator", idp.URL, "https://api.rag.example/api/auth/oidc/callback")
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "https://api.rag.example/api/auth/oidc/logout", nil)
			req.AddCookie(&http.Cookie{Name: oidcIDTokenCookie, Value: "raw.id.token"})
			for k, v := range c.headers {
				req.Header.Set(k, v)
			}
			rec := httptest.NewRecorder()

			h.OIDCLogout(rec, req)

			q := endSessionQuery(t, rec)
			if got := q.Get("id_token_hint") == "raw.id.token"; got != c.wantHint {
				t.Errorf("hint sent = %v, want %v (id_token_hint=%q)", got, c.wantHint, q.Get("id_token_hint"))
			}
			if cleared := cookieNamed(rec, oidcIDTokenCookie) != nil; cleared != c.wantHint {
				t.Errorf("cookie cleared = %v, want %v: only a spent hint goes", cleared, c.wantHint)
			}
		})
	}
}

// A logout that cannot hand the hint to the IdP keeps the cookie, so the
// retry still has it: the provider does not load, it advertises no
// end-session endpoint, or the one it advertises is no absolute URL.
func TestOIDCLogout_UnspentHintKeepsCookie(t *testing.T) {
	down := httptest.NewServer(http.NotFoundHandler()) // discovery fails
	t.Cleanup(down.Close)
	cases := []struct {
		name, providerID, issuer string
		wantStatus               int
	}{
		{"provider cannot be loaded", "logout-idp-down", down.URL, http.StatusInternalServerError},
		{"no end-session endpoint", "logout-no-endpoint", newFakeIdPWithEndSession(t, "").URL, http.StatusFound},
		{"unparsable end-session endpoint", "logout-bad-endpoint", newFakeIdPWithEndSession(t, "http://[::1").URL, http.StatusFound},
		{"relative end-session endpoint", "logout-relative-endpoint", newFakeIdPWithEndSession(t, "relative/logout").URL, http.StatusFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h, _ := oidcHandler(t, c.providerID, c.issuer, testCallbackURL)
			req := httptest.NewRequest(http.MethodGet, "https://rag.example/api/auth/oidc/logout", nil)
			req.AddCookie(&http.Cookie{Name: oidcIDTokenCookie, Value: "raw.id.token"})
			req.Header.Set("Sec-Fetch-Site", "same-origin") // the app's own navigation: the hint would go
			rec := httptest.NewRecorder()

			h.OIDCLogout(rec, req)

			if rec.Code != c.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, c.wantStatus)
			}
			if loc := rec.Header().Get("Location"); c.wantStatus == http.StatusFound && loc != "https://rag.example/" {
				t.Errorf("Location = %q, want the post-logout redirect and nothing else", loc)
			}
			if c := cookieNamed(rec, oidcIDTokenCookie); c != nil {
				t.Errorf("the logout touched the id_token cookie: %+v", c)
			}
		})
	}
}

// The cookie's path is the logout route as the browser sees it, taken from
// the configured callback URL — behind a path prefix the server's own route
// would never match.
func TestOIDCLogoutCookiePath(t *testing.T) {
	cases := []struct{ redirectURI, want string }{
		{"https://rag.example/api/auth/oidc/callback", "/api/auth/oidc/logout"},
		{"https://host.example/justrag/api/auth/oidc/callback", "/justrag/api/auth/oidc/logout"},
		{"https://rag.example/somewhere/else", oidcLogoutPath},
		{"https://rag.example/callback", oidcLogoutPath},
		{"::not a url", oidcLogoutPath},
	}
	for _, c := range cases {
		if got := oidcLogoutCookiePath(OIDCConfig{RedirectURI: c.redirectURI}); got != c.want {
			t.Errorf("oidcLogoutCookiePath(%q) = %q, want %q", c.redirectURI, got, c.want)
		}
	}

	idp := newFakeIdP(t)
	h, _ := oidcHandler(t, "login-prefixed", idp.URL, "https://host.example/justrag/api/auth/oidc/callback")
	if c := cookieNamed(login(t, h, "login-prefixed"), oidcIDTokenCookie); c == nil || c.Path != "/justrag/api/auth/oidc/logout" {
		t.Errorf("cookie under a path prefix = %+v", c)
	}
}

// A token the browser would drop is not stored, and an older one goes.
func TestSetOIDCIDTokenCookie_Oversized(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, testCallbackURL, nil)

	setOIDCIDTokenCookie(rec, req, oidcLogoutPath, strings.Repeat("x", oidcIDTokenCookieMaxBytes+1))

	if c := cookieNamed(rec, oidcIDTokenCookie); c == nil || c.Value != "" || c.MaxAge >= 0 {
		t.Errorf("oversized token: cookie = %+v, want it cleared", c)
	}
}
