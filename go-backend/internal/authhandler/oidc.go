package authhandler

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/justrag/go-backend/internal/adminproviders"
	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/users"
)

// OIDCProviderType is the auth_providers.type value for an OpenID Connect IdP.
const OIDCProviderType = "oidc"

// OIDCConfig is the JSON shape persisted in auth_providers.config when
// type='oidc'. ClientSecret is stored encrypted (enc: prefix); use
// DecryptProviderSecret before handing it to oauth2.Config.
type OIDCConfig struct {
	IssuerURL    string   `json:"issuerURL"`
	ClientID     string   `json:"clientID"`
	ClientSecret string   `json:"clientSecret"`
	Scopes       []string `json:"scopes,omitempty"`
	RedirectURI  string   `json:"redirectURI"`
	// SuccessRedirect is the frontend path the callback redirects to after
	// minting a JWT. Defaults to "/". The JWT and user JSON ride along in
	// the URL fragment so they never hit server logs.
	SuccessRedirect string `json:"successRedirect,omitempty"`
	// PostLogoutRedirectURI is forwarded to the IdP's end_session_endpoint
	// as `post_logout_redirect_uri`. Must be pre-registered on the IdP side.
	// Falls back to SuccessRedirect, then "/".
	PostLogoutRedirectURI string `json:"postLogoutRedirectURI,omitempty"`
}

const (
	oidcStateCookie    = "oidc_state"
	oidcVerifierCookie = "oidc_verifier"
	oidcProviderCookie = "oidc_provider"
	oidcCookieMaxAge   = 5 * 60 // 5 minutes — covers user navigating to IdP and back.

	// oidcIDTokenCookie keeps the raw ID token of the last OIDC login for the
	// logout redirect, which sends it as id_token_hint. Without the hint the
	// IdP cannot tell that the request comes from the session's own browser
	// and asks the user to confirm the logout (Keycloak: "Do you want to log
	// out?"). The browser's navigation to the logout endpoint carries no
	// Authorization header, so a cookie is the only thing that reaches it.
	// It is scoped to that one path and never readable by scripts.
	//
	// The IdP's confirmation page is also what stops another page from
	// logging a user out with a link to this endpoint, so the hint goes only
	// to a logout the app itself started: the cookie is SameSite=Strict
	// (unlike the login cookies), which keeps it from other sites, and
	// oidcLogoutFromApp keeps it from other hosts of the same site.
	oidcIDTokenCookie = "oidc_id_token"
	// oidcLogoutPath is the logout route as this server sees it; the cookie's
	// path is the one the browser sees (oidcLogoutCookiePath).
	oidcLogoutPath = "/api/auth/oidc/logout"
	// Browsers drop a cookie over 4096 bytes including its name and
	// attributes. A larger ID token (many group or role claims) is not
	// stored; that logout then runs without the hint, as before.
	oidcIDTokenCookieMaxBytes = 3800
)

// oidcProviderCache memoises oidc.Provider + parsed OIDCConfig per
// auth_providers.id. Invalidated by adminproviders on update/delete so admin
// config changes take effect without a server restart.
type oidcProviderCache struct {
	mu      sync.Mutex
	entries map[string]*cachedOIDC
}

type cachedOIDC struct {
	provider *oidc.Provider
	verifier *oidc.IDTokenVerifier
	config   OIDCConfig
	oauth2   oauth2.Config
}

var globalOIDCCache = &oidcProviderCache{entries: map[string]*cachedOIDC{}}

// InvalidateOIDCProviderCache drops the cached discovery for the given
// provider id. Called by adminproviders on update / delete.
func InvalidateOIDCProviderCache(providerID string) {
	globalOIDCCache.mu.Lock()
	delete(globalOIDCCache.entries, providerID)
	globalOIDCCache.mu.Unlock()
}

func (c *oidcProviderCache) load(ctx context.Context, row adminproviders.AuthProviderRow) (*cachedOIDC, error) {
	c.mu.Lock()
	if hit, ok := c.entries[row.ID]; ok {
		c.mu.Unlock()
		return hit, nil
	}
	c.mu.Unlock()

	var cfg OIDCConfig
	if err := json.Unmarshal(row.Config, &cfg); err != nil {
		return nil, fmt.Errorf("oidc config: parse: %w", err)
	}
	if cfg.IssuerURL == "" || cfg.ClientID == "" || cfg.RedirectURI == "" {
		return nil, errors.New("oidc config: issuerURL, clientID, and redirectURI are required")
	}

	clientSecret, err := DecryptProviderSecret(cfg.ClientSecret)
	if err != nil {
		return nil, fmt.Errorf("oidc config: clientSecret: %w", err)
	}

	provider, err := oidc.NewProvider(ctx, cfg.IssuerURL)
	if err != nil {
		return nil, fmt.Errorf("oidc discovery: %w", err)
	}

	scopes := cfg.Scopes
	if len(scopes) == 0 {
		scopes = []string{oidc.ScopeOpenID, "email", "profile"}
	} else {
		hasOpenID := false
		for _, s := range scopes {
			if s == oidc.ScopeOpenID {
				hasOpenID = true
				break
			}
		}
		if !hasOpenID {
			scopes = append([]string{oidc.ScopeOpenID}, scopes...)
		}
	}

	entry := &cachedOIDC{
		provider: provider,
		verifier: provider.Verifier(&oidc.Config{ClientID: cfg.ClientID}),
		config:   cfg,
		oauth2: oauth2.Config{
			ClientID:     cfg.ClientID,
			ClientSecret: clientSecret,
			RedirectURL:  cfg.RedirectURI,
			Endpoint:     provider.Endpoint(),
			Scopes:       scopes,
		},
	}

	c.mu.Lock()
	c.entries[row.ID] = entry
	c.mu.Unlock()
	return entry, nil
}

// OIDCStore extends the base Store with the lookups the OIDC handlers need.
// PGStore satisfies it; the runtime type-asserts.
type OIDCStore interface {
	Store
	GetActiveOIDCProvider(ctx context.Context) (*adminproviders.AuthProviderRow, error)
	GetUserByExternalID(ctx context.Context, externalID string) (*users.UserRow, error)
	GetUsersByUsername(ctx context.Context, username string) ([]*users.UserRow, error)
	// LinkUserExternalID returns (nil, nil) when its guard refuses the row.
	LinkUserExternalID(ctx context.Context, userID, externalID string) (*users.UserRow, error)
	ApplyPendingInvites(ctx context.Context, userID, username string) error
}

// ---------------------------------------------------------------------------
// state / PKCE / cookie helpers
// ---------------------------------------------------------------------------

func randURLBytes(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func cookieSecure(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	if strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		return true
	}
	return false
}

func setOIDCCookie(w http.ResponseWriter, r *http.Request, name, value string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		Secure:   cookieSecure(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   oidcCookieMaxAge,
	})
}

func clearOIDCCookie(w http.ResponseWriter, r *http.Request, name string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   cookieSecure(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

// oidcLogoutCookiePath is the logout route's path in the browser. Behind a
// proxy that serves the API under a prefix it differs from oidcLogoutPath, and
// a cookie on the wrong path is never sent. The configured redirect URI is the
// callback's public URL, and the logout route is its sibling.
func oidcLogoutCookiePath(cfg OIDCConfig) string {
	if u, err := url.Parse(cfg.RedirectURI); err == nil {
		if base, ok := strings.CutSuffix(u.Path, "/callback"); ok && base != "" {
			return base + "/logout"
		}
	}
	return oidcLogoutPath
}

// oidcLogoutFromApp reports whether the browser started this navigation in
// the app: on this origin, or — where the web app is served from another
// origin than the API — on the origin the provider's redirects point back to.
// Anything else (another host, a typed URL, a browser that sends neither
// header) is not known to be the app and gets no hint.
func oidcLogoutFromApp(r *http.Request, cfg OIDCConfig) bool {
	if r.Header.Get("Sec-Fetch-Site") == "same-origin" {
		return true
	}
	ref, err := url.Parse(r.Header.Get("Referer"))
	if err != nil || ref.Scheme == "" || ref.Host == "" {
		return false
	}
	for _, raw := range []string{cfg.PostLogoutRedirectURI, cfg.SuccessRedirect} {
		if u, err := url.Parse(raw); err == nil && u.Host != "" &&
			strings.EqualFold(u.Scheme, ref.Scheme) && strings.EqualFold(u.Host, ref.Host) {
			return true
		}
	}
	return false
}

// setOIDCIDTokenCookie stores the ID token for the logout redirect. It lives
// as long as the JustRAG token minted beside it; the IdP accepts an expired ID
// token as a hint, so its own shorter lifetime does not matter.
func setOIDCIDTokenCookie(w http.ResponseWriter, r *http.Request, path, rawIDToken string) {
	if len(rawIDToken) > oidcIDTokenCookieMaxBytes {
		logctx.From(r.Context()).Warn("oidc callback: id_token too large for the logout hint cookie",
			"bytes", len(rawIDToken))
		clearOIDCIDTokenCookie(w, r, path)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     oidcIDTokenCookie,
		Value:    rawIDToken,
		Path:     path,
		HttpOnly: true,
		Secure:   cookieSecure(r),
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(tokenLifetime / time.Second),
	})
}

func clearOIDCIDTokenCookie(w http.ResponseWriter, r *http.Request, path string) {
	http.SetCookie(w, &http.Cookie{
		Name:     oidcIDTokenCookie,
		Value:    "",
		Path:     path,
		HttpOnly: true,
		Secure:   cookieSecure(r),
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
	})
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// OIDCLogin handles GET /api/auth/oidc/login: looks up the single active OIDC
// provider, sets state + PKCE verifier cookies, redirects to the IdP authorize
// endpoint.
func (h *Handler) OIDCLogin(w http.ResponseWriter, r *http.Request) {
	oStore, ok := h.store.(OIDCStore)
	if !ok {
		http.Error(w, "OIDC store not configured", http.StatusInternalServerError)
		return
	}
	row, err := oStore.GetActiveOIDCProvider(r.Context())
	if err != nil {
		logctx.From(r.Context()).Error("oidc login: provider lookup", "err", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	if row == nil {
		http.Error(w, "OIDC is not configured", http.StatusNotFound)
		return
	}

	cached, err := globalOIDCCache.load(r.Context(), *row)
	if err != nil {
		logctx.From(r.Context()).Error("oidc login: provider init", "err", err, "providerID", row.ID)
		http.Error(w, "OIDC provider misconfigured", http.StatusInternalServerError)
		return
	}

	state, err := randURLBytes(32)
	if err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	verifier, err := randURLBytes(48)
	if err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	setOIDCCookie(w, r, oidcStateCookie, state)
	setOIDCCookie(w, r, oidcVerifierCookie, verifier)
	setOIDCCookie(w, r, oidcProviderCookie, row.ID)

	authURL := cached.oauth2.AuthCodeURL(state,
		oauth2.SetAuthURLParam("code_challenge", pkceChallenge(verifier)),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
	)
	http.Redirect(w, r, authURL, http.StatusFound)
}

// OIDCCallback handles GET /api/auth/oidc/callback.
func (h *Handler) OIDCCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	stateCookie, err := r.Cookie(oidcStateCookie)
	if err != nil || stateCookie.Value == "" {
		oidcErrRedirect(w, r, "state_missing")
		return
	}
	verifierCookie, err := r.Cookie(oidcVerifierCookie)
	if err != nil || verifierCookie.Value == "" {
		oidcErrRedirect(w, r, "verifier_missing")
		return
	}
	providerCookie, err := r.Cookie(oidcProviderCookie)
	if err != nil || providerCookie.Value == "" {
		oidcErrRedirect(w, r, "provider_missing")
		return
	}

	if r.URL.Query().Get("state") != stateCookie.Value {
		oidcErrRedirect(w, r, "state_mismatch")
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" {
		oidcErrRedirect(w, r, "code_missing")
		return
	}

	oStore, ok := h.store.(OIDCStore)
	if !ok {
		http.Error(w, "OIDC store not configured", http.StatusInternalServerError)
		return
	}

	row, err := oStore.GetActiveOIDCProvider(ctx)
	if err != nil || row == nil || row.ID != providerCookie.Value {
		oidcErrRedirect(w, r, "provider_unavailable")
		return
	}

	cached, err := globalOIDCCache.load(ctx, *row)
	if err != nil {
		logctx.From(ctx).Error("oidc callback: provider init", "err", err, "providerID", row.ID)
		oidcErrRedirect(w, r, "provider_init_failed")
		return
	}

	clearOIDCCookie(w, r, oidcStateCookie)
	clearOIDCCookie(w, r, oidcVerifierCookie)
	clearOIDCCookie(w, r, oidcProviderCookie)

	tok, err := cached.oauth2.Exchange(ctx, code,
		oauth2.SetAuthURLParam("code_verifier", verifierCookie.Value),
	)
	if err != nil {
		logctx.From(ctx).Warn("oidc callback: code exchange failed", "err", err)
		oidcErrRedirect(w, r, "code_exchange_failed")
		return
	}

	rawIDToken, ok := tok.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		oidcErrRedirect(w, r, "id_token_missing")
		return
	}
	idToken, err := cached.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		logctx.From(ctx).Warn("oidc callback: id_token verify failed", "err", err)
		oidcErrRedirect(w, r, "id_token_invalid")
		return
	}

	var claims oidcClaims
	if err := idToken.Claims(&claims); err != nil {
		oidcErrRedirect(w, r, "claims_parse_failed")
		return
	}
	if claims.Sub == "" {
		oidcErrRedirect(w, r, "sub_missing")
		return
	}
	if claims.Email == "" {
		logctx.From(ctx).Warn("oidc callback: email claim missing", "sub", claims.Sub)
		oidcErrRedirect(w, r, "email_missing")
		return
	}
	if !claims.EmailVerified {
		logctx.From(ctx).Warn("oidc callback: email_verified false; refusing to provision",
			"sub", claims.Sub, "email", claims.Email)
		oidcErrRedirect(w, r, "email_unverified")
		return
	}

	user, err := resolveOIDCUser(ctx, oStore, claims)
	if err != nil {
		logctx.From(ctx).Warn("oidc callback: user resolution failed",
			"err", err, "sub", claims.Sub, "email", claims.Email)
		oidcErrRedirect(w, r, "user_resolution_failed")
		return
	}

	// Promote any bulk invites parked for this username into real shares.
	// Best-effort: a failure here must not block login.
	if err := oStore.ApplyPendingInvites(ctx, user.ID, user.Username); err != nil {
		logctx.From(ctx).Warn("oidc callback: applying pending invites failed",
			"err", err, "user_id", user.ID, "username", user.Username)
	}

	tokenStr, err := h.signToken(user.ID, user.Username, user.Role)
	if err != nil {
		oidcErrRedirect(w, r, "token_sign_failed")
		return
	}
	setOIDCIDTokenCookie(w, r, oidcLogoutCookiePath(cached.config), rawIDToken)

	target := cached.config.SuccessRedirect
	if target == "" {
		target = "/"
	}
	http.Redirect(w, r, appendAuthFragment(target, tokenStr, user), http.StatusFound)
}

// OIDCLogout handles GET /api/auth/oidc/logout: RP-initiated single logout
// per OpenID Connect RP-Initiated Logout 1.0.
//
// Best-effort blacklists a JustRAG JWT supplied via Authorization: Bearer (so
// SPA flows that POST /api/auth/logout first still work; this endpoint is
// idempotent for clients that only navigate the browser), then redirects to
// the IdP's discovered end_session_endpoint with client_id, the
// admin-configured post_logout_redirect_uri and — when the login left one and
// the navigation started in the app (oidcLogoutFromApp) — the ID token as
// id_token_hint, so the IdP logs out without asking. If the IdP doesn't
// advertise an end_session_endpoint, falls back to a local redirect.
//
// The hint travels in the redirect URL, as the specification defines it, so
// it reaches the IdP's access log. It is the IdP's own token.
//
// This endpoint ends the user's single sign-on session. It is for a logout
// the user asked for, never for an expired JustRAG token.
func (h *Handler) OIDCLogout(w http.ResponseWriter, r *http.Request) {
	// The redirect may carry the ID token: keep it out of caches.
	w.Header().Set("Cache-Control", "no-store")

	if authHeader := r.Header.Get("Authorization"); strings.HasPrefix(authHeader, "Bearer ") {
		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
		if claims, err := auth.DecodeTokenUnverified(tokenStr); err == nil && h.blacklist != nil {
			h.blacklist.Add(r.Context(), claims.JTI, time.Unix(claims.ExpiresAt, 0))
		}
	}

	oStore, ok := h.store.(OIDCStore)
	if !ok {
		http.Error(w, "OIDC store not configured", http.StatusInternalServerError)
		return
	}
	row, err := oStore.GetActiveOIDCProvider(r.Context())
	if err != nil {
		logctx.From(r.Context()).Error("oidc logout: provider lookup", "err", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	if row == nil {
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}

	cached, err := globalOIDCCache.load(r.Context(), *row)
	if err != nil {
		logctx.From(r.Context()).Error("oidc logout: provider init", "err", err, "providerID", row.ID)
		http.Error(w, "OIDC provider misconfigured", http.StatusInternalServerError)
		return
	}

	postLogout := cached.config.PostLogoutRedirectURI
	if postLogout == "" {
		postLogout = cached.config.SuccessRedirect
	}
	if postLogout == "" {
		postLogout = "/"
	}

	var meta struct {
		EndSessionEndpoint string `json:"end_session_endpoint"`
	}
	_ = cached.provider.Claims(&meta)

	if meta.EndSessionEndpoint == "" {
		http.Redirect(w, r, postLogout, http.StatusFound)
		return
	}

	// An absolute URL only: a relative one would resolve against this server
	// and take the hint somewhere that is not the IdP.
	u, err := url.Parse(meta.EndSessionEndpoint)
	if err == nil && (!u.IsAbs() || u.Host == "") {
		err = errors.New("not an absolute URL")
	}
	if err != nil {
		logctx.From(r.Context()).Error("oidc logout: invalid end_session_endpoint", "err", err, "url", meta.EndSessionEndpoint)
		http.Redirect(w, r, postLogout, http.StatusFound)
		return
	}
	q := u.Query()
	q.Set("client_id", cached.config.ClientID)
	q.Set("post_logout_redirect_uri", postLogout)
	// The hint is spent with the logout it goes to, and only then: a failure
	// above, an IdP without an end-session endpoint, or a request that did
	// not come from the app leaves the cookie.
	if c, err := r.Cookie(oidcIDTokenCookie); err == nil && c.Value != "" && oidcLogoutFromApp(r, cached.config) {
		q.Set("id_token_hint", c.Value)
		clearOIDCIDTokenCookie(w, r, oidcLogoutCookiePath(cached.config))
	}
	u.RawQuery = q.Encode()

	http.Redirect(w, r, u.String(), http.StatusFound)
}

// backchannelLogoutEvent is the fixed member key the IdP places in the logout
// token's `events` claim per OpenID Connect Back-Channel Logout 1.0 §2.4.
const backchannelLogoutEvent = "http://schemas.openid.net/event/backchannel-logout"

// logoutTokenClaims captures the Back-Channel Logout 1.0 claims we validate
// beyond the signature/iss/aud/exp checks go-oidc's verifier already performs.
type logoutTokenClaims struct {
	Sub    string                     `json:"sub"`
	Sid    string                     `json:"sid"`
	Nonce  string                     `json:"nonce"`
	Events map[string]json.RawMessage `json:"events"`
}

// validateLogoutClaims enforces the Back-Channel Logout 1.0 §2.4 rules that the
// ID-token verifier does not: the `events` claim must carry the
// backchannel-logout member whose value is a JSON object, a `nonce` must be
// ABSENT (its presence means the token is an ID token, not a logout token), and
// at least one of sub/sid must identify the ended session.
func validateLogoutClaims(c logoutTokenClaims) error {
	if c.Nonce != "" {
		return errors.New("logout token must not contain a nonce claim")
	}
	if c.Sub == "" && c.Sid == "" {
		return errors.New("logout token must contain sub and/or sid")
	}
	raw, ok := c.Events[backchannelLogoutEvent]
	if !ok {
		return errors.New("logout token events claim missing backchannel-logout member")
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return errors.New("logout token backchannel-logout event must be a JSON object")
	}
	return nil
}

// OIDCBackchannelLogout handles POST /api/auth/oidc/logout per OpenID Connect
// Back-Channel Logout 1.0. When a user's SSO session ends in another RP, the
// IdP makes a direct server-to-server POST of a signed logout_token here (no
// browser, no JustRAG JWT) — this is the SSO single-logout path distinct from
// the browser-driven RP-initiated GET handler above.
//
// We verify the token against the OP's keyset, map its `sub` to a JustRAG user
// via external_id, and revoke every JWT that user holds (InvalidateUserTokens —
// the auth middleware already enforces the per-user invalidation timestamp).
// Returns 200 + Cache-Control: no-store on success; 400 on an invalid
// logout_token so the IdP can distinguish "rejected" from "delivered".
func (h *Handler) OIDCBackchannelLogout(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		backchannelLogoutError(w, http.StatusBadRequest, "invalid form encoding")
		return
	}
	rawToken := r.PostFormValue("logout_token")
	if rawToken == "" {
		backchannelLogoutError(w, http.StatusBadRequest, "missing logout_token")
		return
	}

	oStore, ok := h.store.(OIDCStore)
	if !ok {
		http.Error(w, "OIDC store not configured", http.StatusInternalServerError)
		return
	}
	row, err := oStore.GetActiveOIDCProvider(r.Context())
	if err != nil {
		logctx.From(r.Context()).Error("oidc backchannel logout: provider lookup", "err", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	if row == nil {
		backchannelLogoutError(w, http.StatusBadRequest, "no active OIDC provider")
		return
	}
	cached, err := globalOIDCCache.load(r.Context(), *row)
	if err != nil {
		logctx.From(r.Context()).Error("oidc backchannel logout: provider init", "err", err, "providerID", row.ID)
		http.Error(w, "OIDC provider misconfigured", http.StatusInternalServerError)
		return
	}

	// Verify signature, issuer, audience (= client_id) and expiry against the
	// OP's discovered keyset. The logout token's aud is the client_id, so the
	// existing ID-token verifier applies. go-oidc does NOT check nonce — that is
	// our job below, and for a logout token the nonce must be absent.
	idToken, err := cached.verifier.Verify(r.Context(), rawToken)
	if err != nil {
		logctx.From(r.Context()).Warn("oidc backchannel logout: token verify failed", "err", err)
		backchannelLogoutError(w, http.StatusBadRequest, "invalid logout_token")
		return
	}
	var claims logoutTokenClaims
	if err := idToken.Claims(&claims); err != nil {
		backchannelLogoutError(w, http.StatusBadRequest, "unreadable logout_token claims")
		return
	}
	if err := validateLogoutClaims(claims); err != nil {
		logctx.From(r.Context()).Warn("oidc backchannel logout: claim validation failed", "err", err)
		backchannelLogoutError(w, http.StatusBadRequest, "invalid logout_token")
		return
	}

	// Map sub -> JustRAG user and revoke all their JWTs. A sid-only token carries
	// nothing we can act on (JustRAG JWTs don't embed the OP session id), so we
	// still return 200 per spec: the token was valid, we simply hold no matching
	// session. Same for an unknown sub (user never logged into JustRAG).
	switch {
	case claims.Sub == "":
		// sid-only logout token: JustRAG keys revocation on sub (JustRAG JWTs
		// don't embed the OP session id), so there is nothing we can act on.
		// Still 200 per spec — the token was valid, we simply hold no matching
		// session. Logged so this is not a silent no-op during debugging.
		logctx.From(r.Context()).Warn("oidc backchannel logout: token has no sub (sid-only); nothing revoked", "sid", claims.Sid)
	case h.blacklist == nil:
		logctx.From(r.Context()).Error("oidc backchannel logout: blacklist not configured; cannot revoke", "sub", claims.Sub)
	default:
		user, err := oStore.GetUserByExternalID(r.Context(), claims.Sub)
		if err != nil {
			logctx.From(r.Context()).Error("oidc backchannel logout: user lookup", "err", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}
		if user == nil {
			// Token valid but its sub matches no JustRAG external_id: either the
			// user never logged in via OIDC (local/LDAP row → external_id NULL),
			// or this sub belongs to a different deployment. 200 per spec, but
			// logged because this is the common "logged out elsewhere yet still
			// logged in here" cause.
			logctx.From(r.Context()).Warn("oidc backchannel logout: no JustRAG user for sub; nothing revoked", "sub", claims.Sub, "sid", claims.Sid)
		} else {
			h.blacklist.InvalidateUserTokens(r.Context(), user.ID)
			logctx.From(r.Context()).Info("oidc backchannel logout: revoked user tokens", "userId", user.ID, "sub", claims.Sub)
		}
	}

	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
}

// backchannelLogoutError writes the OAuth-style JSON error body the
// Back-Channel Logout spec recommends for a rejected logout_token.
func backchannelLogoutError(w http.ResponseWriter, status int, desc string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":             "logout_failed",
		"error_description": desc,
	})
}

// oidcClaims captures every ID-token claim the matching logic + auto-provision
// path reads.
type oidcClaims struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	GivenName     string `json:"given_name"`
	FamilyName    string `json:"family_name"`
	Name          string `json:"name"`
	PreferredUN   string `json:"preferred_username"`
}

// oidcErrRedirect bounces to /?oidc_error=<code> so the login page can render
// a friendly message. Details stay in server logs.
func oidcErrRedirect(w http.ResponseWriter, r *http.Request, code string) {
	u := &url.URL{Path: "/"}
	q := u.Query()
	q.Set("oidc_error", code)
	u.RawQuery = q.Encode()
	http.Redirect(w, r, u.String(), http.StatusFound)
}

// appendAuthFragment puts the JWT + user JSON into the URL fragment of `target`
// so the frontend can read them on mount. Fragments are not sent to servers,
// so the token doesn't leak into access logs.
func appendAuthFragment(target, token string, user *users.UserRow) string {
	payload := struct {
		Token string `json:"token"`
		User  struct {
			ID         string `json:"id"`
			Username   string `json:"username"`
			Role       string `json:"role"`
			AuthMethod string `json:"authMethod"`
		} `json:"user"`
	}{Token: token}
	payload.User.ID = user.ID
	payload.User.Username = user.Username
	payload.User.Role = user.Role
	payload.User.AuthMethod = user.AuthMethod

	raw, _ := json.Marshal(payload)
	encoded := base64.RawURLEncoding.EncodeToString(raw)

	u, err := url.Parse(target)
	if err != nil {
		return "/#oidc=" + encoded
	}
	u.Fragment = "oidc=" + encoded
	return u.String()
}

// ErrOIDCLinkRefused marks a preferred_username match that branch 2 of
// resolveOIDCUser will not link. The callback treats it like any other
// resolution failure; the wrapped reason is for the log.
var ErrOIDCLinkRefused = errors.New("oidc_link_refused")

// oidcLinkRefusal returns why an existing row may not be linked to a new
// OIDC subject by username, or "" when it may. preferred_username is chosen
// by whoever runs the IdP — and, where the IdP allows self-service renames,
// by its users — so a username match proves nothing about who owns the row.
// Branch 2 exists for the LDAP→OIDC migration, so it is limited to that:
//   - only ldap/oidc rows (a local password account is never taken over; the
//     LDAP login path refuses the same thing),
//   - never a row already linked to another sub (that would silently move
//     the account to a different IdP identity),
//   - never an admin or superadmin row (taking one over is a privilege
//     escalation; an operator links those by hand).
//
// LinkUserExternalID repeats these conditions in its UPDATE, which is the
// actual gate; this pre-check only names the reason.
func oidcLinkRefusal(u *users.UserRow) string {
	switch {
	case u.AuthMethod != "ldap" && u.AuthMethod != "oidc":
		return "auth_method " + u.AuthMethod + " is not linkable"
	case u.ExternalID != nil:
		return "already linked to another subject"
	case u.Role != auth.RoleUser && u.Role != auth.RoleAPIUser:
		return "role " + u.Role + " is not linkable"
	}
	return ""
}

// resolveOIDCUser implements the three-branch match:
//  1. external_id match → existing OIDC user.
//  2. case-insensitive single preferred_username match → link + return
//     (LDAP→OIDC migration). Keyed on username (not email) because usernames
//     are stable across an employee's lifecycle; emails change. Only rows
//     oidcLinkRefusal accepts are linked; any other match fails the login
//     (ErrOIDCLinkRefused) rather than falling through to create.
//  3. no match → create new OIDC-provisioned user.
//
// Fails closed if the username matches >1 rows. users.username has a unique
// constraint, but it is case-sensitive in Postgres, so legacy mixed-case
// dupes can exist and must not be auto-linked to a single OIDC identity.
//
// If preferred_username is empty, the link branch is skipped entirely (no
// fallback to email — that would defeat the point of switching). The create
// branch still derives a username from email-local-part / sub as last resort.
func resolveOIDCUser(ctx context.Context, store OIDCStore, claims oidcClaims) (*users.UserRow, error) {
	if existing, err := store.GetUserByExternalID(ctx, claims.Sub); err != nil {
		return nil, fmt.Errorf("lookup by external_id: %w", err)
	} else if existing != nil {
		return existing, nil
	}

	email := strings.TrimSpace(claims.Email)
	preferredUN := strings.TrimSpace(claims.PreferredUN)

	if preferredUN != "" {
		matches, err := store.GetUsersByUsername(ctx, preferredUN)
		if err != nil {
			return nil, fmt.Errorf("lookup by username: %w", err)
		}
		if len(matches) > 1 {
			return nil, fmt.Errorf("oidc_username_conflict: %d users share username %q", len(matches), preferredUN)
		}
		if len(matches) == 1 {
			m := matches[0]
			if reason := oidcLinkRefusal(m); reason != "" {
				return nil, fmt.Errorf("%w: %s (user %s)", ErrOIDCLinkRefused, reason, m.ID)
			}
			linked, err := store.LinkUserExternalID(ctx, m.ID, claims.Sub)
			if err != nil {
				return nil, err
			}
			if linked == nil {
				return nil, fmt.Errorf("%w: account changed before the link (user %s)", ErrOIDCLinkRefused, m.ID)
			}
			return linked, nil
		}
	}

	username := preferredUN
	if username == "" {
		username = emailLocalPart(email)
	}
	if username == "" {
		username = "user-" + claims.Sub
	}

	first := claims.GivenName
	last := claims.FamilyName
	if first == "" && last == "" && claims.Name != "" {
		if parts := strings.SplitN(claims.Name, " ", 2); len(parts) == 2 {
			first, last = parts[0], parts[1]
		} else {
			first = claims.Name
		}
	}

	var fn, ln, em *string
	if first != "" {
		fn = &first
	}
	if last != "" {
		ln = &last
	}
	if email != "" {
		em = &email
	}
	sub := claims.Sub

	return store.CreateUser(ctx, users.UserCreate{
		Username:     username,
		PasswordHash: "$oidc$provisioned",
		AuthMethod:   "oidc",
		FirstName:    fn,
		LastName:     ln,
		Email:        em,
		Role:         "user",
		ExternalID:   &sub,
	})
}

func emailLocalPart(email string) string {
	at := strings.IndexByte(email, '@')
	if at <= 0 {
		return ""
	}
	return email[:at]
}
