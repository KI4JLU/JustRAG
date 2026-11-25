package app

// Tests for the translator route chains.
//
// Oracle: the documented contract (API.md, "Translator and glossaries") and
// the card's access rules, not the handlers' code — a request without a token
// is 401; while the switch is off every route but the configuration one is
// 403 translator_disabled; a glossary role gates every {id} route (a stranger
// is 403 on a private glossary, a global glossary reads as viewer and nothing
// more, the member list needs admin, system roles open no glossary); the
// text routes have a per-user budget. The REAL wiring (registerTranslatorRoutes)
// runs with the real auth middleware and a real limiter on miniredis; only the
// stores are fakes, because there is no database here.

import (
	"bytes"
	"context"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/glossaryaccess"
	"github.com/justrag/go-backend/internal/glossarymembers"
	"github.com/justrag/go-backend/internal/middleware"
	"github.com/justrag/go-backend/internal/redisclient"
	"github.com/justrag/go-backend/internal/translator"
)

const translatorTestSecret = "test-secret-at-least-32-characters-long-x"

const (
	privateGlossaryID = "3f2b8c1e-0b1d-4a55-9d3e-7c1a2b3c4d01"
	globalGlossaryID  = "3f2b8c1e-0b1d-4a55-9d3e-7c1a2b3c4d02"
)

type cfgMap map[string]string

func (c cfgMap) GetSiteConfigValue(_ context.Context, key string) (*string, error) {
	if v, ok := c[key]; ok {
		return &v, nil
	}
	return nil, nil
}

type fakeCompleter struct{ calls int }

func (f *fakeCompleter) Complete(_ context.Context, _, _ string, _ *ai.StructuredSpec, _ any) error {
	f.calls++
	return nil
}
func (f *fakeCompleter) Model(context.Context) (string, string) {
	return "fast-model", translator.ModelSourceFastTier
}

// fakeAccess answers the gate's two lookups from maps: the glossaries and the
// caller's membership rows ("<glossary>/<user>" -> role).
type fakeAccess struct {
	glossaries map[string]string
	members    map[string]string
}

func (f fakeAccess) GetGlossary(_ context.Context, id string) (*glossaryaccess.Glossary, error) {
	v, ok := f.glossaries[id]
	if !ok {
		return nil, nil
	}
	return &glossaryaccess.Glossary{ID: id, Visibility: v}, nil
}
func (f fakeAccess) GetMemberRole(_ context.Context, g, u string) (string, error) {
	return f.members[g+"/"+u], nil
}

// Embedding the interface leaves every method not overridden nil: a request
// that reaches one of them panics, which a gate test must never do.
type fakeGlossaryStore struct{ translator.GlossaryStore }

func (fakeGlossaryStore) Get(_ context.Context, id string) (*translator.GlossaryDetail, error) {
	return &translator.GlossaryDetail{GlossarySummary: translator.GlossarySummary{ID: id}, Entries: []translator.GlossaryEntry{}}, nil
}
func (fakeGlossaryStore) List(context.Context, string) ([]translator.GlossarySummary, error) {
	return nil, nil
}
func (fakeGlossaryStore) Create(context.Context, string, translator.GlossaryInput) (string, error) {
	return privateGlossaryID, nil
}

type fakeMembersStore struct{ glossarymembers.Store }

func (fakeMembersStore) ListMembers(context.Context, string) ([]glossarymembers.Member, error) {
	return nil, nil
}
func (fakeMembersStore) ListPendingInvites(context.Context, string) ([]glossarymembers.PendingInvite, error) {
	return nil, nil
}

type translatorRig struct {
	mux       *http.ServeMux
	cfg       cfgMap
	completer *fakeCompleter
	access    fakeAccess
}

func newTranslatorRig(t *testing.T) *translatorRig {
	t.Helper()
	authRedis := miniredis.RunT(t)
	authClient := redis.NewClient(&redis.Options{Addr: authRedis.Addr()})
	t.Cleanup(func() { _ = authClient.Close() })
	blacklist := auth.NewBlacklist((&redisclient.Client{Client: authClient}).NewBlacklistAdapter(), false)

	limitRedis := miniredis.RunT(t)
	limitClient := redis.NewClient(&redis.Options{Addr: limitRedis.Addr()})
	t.Cleanup(func() { _ = limitClient.Close() })

	rig := &translatorRig{
		cfg:       cfgMap{translator.KeyEnabled: "true"},
		completer: &fakeCompleter{},
		access: fakeAccess{
			glossaries: map[string]string{privateGlossaryID: "private", globalGlossaryID: "global"},
			members: map[string]string{
				privateGlossaryID + "/u-owner":  glossaryaccess.RoleOwner,
				privateGlossaryID + "/u-editor": glossaryaccess.RoleEditor,
				privateGlossaryID + "/u-admin":  glossaryaccess.RoleAdmin,
				globalGlossaryID + "/u-owner":   glossaryaccess.RoleOwner,
			},
		},
	}
	rc := &routeCtx{mux: http.NewServeMux(), authMw: auth.NewMiddleware(translatorTestSecret, blacklist)}
	rig.mux = rc.mux
	registerTranslatorRoutes(rc, translatorDeps{
		text:     translator.NewHandler(translator.NewService(rig.completer, nil), rig.completer, rig.cfg),
		glossary: translator.NewGlossaryHandler(fakeGlossaryStore{}),
		members:  glossarymembers.NewHandler(fakeMembersStore{}),
		access:   glossaryaccess.NewMiddleware(rig.access),
		textRL:   newTranslatorTextLimiter(limitClient),
		inviteRL: middleware.NewRedisRateLimiter(limitClient, middleware.RedisRateLimitConfig{Max: 30, Window: 60e9, Category: "invite"}),
	})
	return rig
}

func (r *translatorRig) do(t *testing.T, method, path, body, userID, sysRole string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.RemoteAddr = "192.0.2.10:1234"
	if userID != "" {
		req.Header.Set("Authorization", "Bearer "+mintJWT(t, translatorTestSecret, userID, sysRole))
	}
	rec := httptest.NewRecorder()
	r.mux.ServeHTTP(rec, req)
	return rec
}

func TestTranslatorRoutesNeedAToken(t *testing.T) {
	rig := newTranslatorRig(t)
	gp := "/api/glossaries/" + privateGlossaryID
	routes := []struct{ method, path string }{
		{"GET", "/api/translator/config"}, {"POST", "/api/translator/translate"}, {"POST", "/api/translator/rephrase"},
		{"POST", "/api/translator/detect"}, {"POST", "/api/translator/suggest"},
		{"GET", "/api/glossaries"}, {"POST", "/api/glossaries"}, {"POST", "/api/glossaries/import"},
		{"GET", gp}, {"PUT", gp}, {"PATCH", gp}, {"DELETE", gp},
		{"GET", gp + "/members"}, {"PUT", gp + "/members/u-1"}, {"DELETE", gp + "/members/u-1"},
		{"POST", gp + "/members/bulk"}, {"DELETE", gp + "/members/pending/anna"},
		{"GET", gp + "/invite-links"}, {"POST", gp + "/invite-links"}, {"DELETE", gp + "/invite-links/l1"},
		{"POST", gp + "/transfer-owner"}, {"DELETE", gp + "/membership"},
		{"GET", "/api/glossary-invites/tok"}, {"POST", "/api/glossary-invites/tok/redeem"},
	}
	for _, rt := range routes {
		if rec := rig.do(t, rt.method, rt.path, "{}", "", ""); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without a token: %d, want 401", rt.method, rt.path, rec.Code)
		}
	}
}

func TestTranslatorSwitchOffRefusesEverythingButConfig(t *testing.T) {
	rig := newTranslatorRig(t)
	rig.cfg[translator.KeyEnabled] = "false"
	for _, rt := range []struct{ method, path string }{
		{"POST", "/api/translator/translate"}, {"GET", "/api/glossaries"},
		{"GET", "/api/glossaries/" + privateGlossaryID}, {"GET", "/api/glossary-invites/tok"},
	} {
		rec := rig.do(t, rt.method, rt.path, `{}`, "u-owner", auth.RoleUser)
		if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "translator_disabled") {
			t.Errorf("%s %s while off: %d %s, want 403 translator_disabled", rt.method, rt.path, rec.Code, rec.Body.String())
		}
	}
	rec := rig.do(t, "GET", "/api/translator/config", "", "u-owner", auth.RoleUser)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"enabled":false`) {
		t.Errorf("config while off: %d %s", rec.Code, rec.Body.String())
	}
}

func TestEverySystemRoleMayUseTheTranslation(t *testing.T) {
	rig := newTranslatorRig(t)
	for _, role := range []string{auth.RoleUser, auth.RoleAdmin, auth.RoleSuperAdmin, auth.RoleAPIUser} {
		if rec := rig.do(t, "GET", "/api/translator/config", "", "u-"+role, role); rec.Code != http.StatusOK {
			t.Errorf("role %s: config %d, want 200", role, rec.Code)
		}
	}
	if rec := rig.do(t, "GET", "/api/translator/config", "", "u-x", "guest"); rec.Code != http.StatusForbidden {
		t.Errorf("a role outside the four: %d, want 403", rec.Code)
	}
}

func TestGlossaryRoleGate(t *testing.T) {
	rig := newTranslatorRig(t)
	priv, glob := "/api/glossaries/"+privateGlossaryID, "/api/glossaries/"+globalGlossaryID
	tests := []struct {
		name         string
		method, path string
		user, sys    string
		want         int
	}{
		{"stranger reads a private glossary", "GET", priv, "u-stranger", auth.RoleUser, http.StatusForbidden},
		{"superadmin is a stranger on a private glossary", "GET", priv, "u-super", auth.RoleSuperAdmin, http.StatusForbidden},
		{"system admin is a stranger on a private glossary", "GET", priv, "u-sysadmin", auth.RoleAdmin, http.StatusForbidden},
		{"editor reads", "GET", priv, "u-editor", auth.RoleUser, http.StatusOK},
		{"stranger reads a global glossary", "GET", glob, "u-stranger", auth.RoleUser, http.StatusOK},
		{"global viewer cannot edit", "PUT", glob, "u-stranger", auth.RoleUser, http.StatusForbidden},
		{"global viewer cannot change visibility", "PATCH", glob, "u-stranger", auth.RoleUser, http.StatusForbidden},
		{"editor cannot change visibility", "PATCH", priv, "u-editor", auth.RoleUser, http.StatusForbidden},
		{"admin may not delete", "DELETE", priv, "u-admin", auth.RoleUser, http.StatusForbidden},
		{"global viewer cannot read the member list", "GET", glob + "/members", "u-stranger", auth.RoleUser, http.StatusForbidden},
		{"editor cannot read the member list", "GET", priv + "/members", "u-editor", auth.RoleUser, http.StatusForbidden},
		{"admin reads the member list", "GET", priv + "/members", "u-admin", auth.RoleUser, http.StatusOK},
		{"unknown glossary", "GET", "/api/glossaries/3f2b8c1e-0b1d-4a55-9d3e-7c1a2b3c4dff", "u-owner", auth.RoleUser, http.StatusNotFound},
		{"malformed id", "GET", "/api/glossaries/not-a-uuid", "u-owner", auth.RoleUser, http.StatusNotFound},
		{"stranger may not leave what is not theirs", "DELETE", priv + "/membership", "u-stranger", auth.RoleUser, http.StatusForbidden},
		{"a non-owner cannot transfer", "POST", priv + "/transfer-owner", "u-admin", auth.RoleUser, http.StatusForbidden},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			body := "{}"
			rec := rig.do(t, tc.method, tc.path, body, tc.user, tc.sys)
			if rec.Code != tc.want {
				t.Errorf("%s %s as %s: %d, want %d (%s)", tc.method, tc.path, tc.user, rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}

func TestTranslatorTextRoutesHaveAPerUserBudget(t *testing.T) {
	rig := newTranslatorRig(t)
	body := `{"text":["x"],"target":"de"}`
	for i := 1; i <= translatorTextPerMinute; i++ {
		if rec := rig.do(t, "POST", "/api/translator/translate", body, "u-a", auth.RoleUser); rec.Code == http.StatusTooManyRequests {
			t.Fatalf("request %d was limited, budget is %d", i, translatorTextPerMinute)
		}
	}
	if rec := rig.do(t, "POST", "/api/translator/translate", body, "u-a", auth.RoleUser); rec.Code != http.StatusTooManyRequests {
		t.Errorf("request %d: %d, want 429", translatorTextPerMinute+1, rec.Code)
	}
	if rec := rig.do(t, "POST", "/api/translator/translate", body, "u-b", auth.RoleUser); rec.Code == http.StatusTooManyRequests {
		t.Error("the budget is per user: another user must not share it")
	}
}

// The CSV import takes files up to 5 MiB, while the server caps every other
// request body at 1 MiB. Through the real server wiring (the same cap
// middleware RunServer installs, the real route chain and handler) a 1.2 MiB
// CSV must get through, and the same size on a JSON route must still be refused.
func TestGlossaryImportIsNotCutByTheGlobalBodyCap(t *testing.T) {
	const globalCap = 1 << 20
	rig := newTranslatorRig(t)
	server := globalBodyCap(globalCap)(rig.mux)

	var csv strings.Builder
	term := strings.Repeat("x", 150)
	for i := range 4_000 {
		fmt.Fprintf(&csv, "%s%04d,%s%04d\n", term, i, term, i)
	}
	if csv.Len() <= globalCap || csv.Len() >= translator.GlossaryImportMaxBytes {
		t.Fatalf("test file is %d bytes, want between the global cap and the import limit", csv.Len())
	}

	var form bytes.Buffer
	mw := multipart.NewWriter(&form)
	_ = mw.WriteField("name", "Big import")
	_ = mw.WriteField("sourceLanguage", "de")
	_ = mw.WriteField("targetLanguage", "en")
	fw, _ := mw.CreateFormFile("file", "terms.csv")
	_, _ = fw.Write([]byte(csv.String()))
	_ = mw.Close()

	send := func(method, path, contentType string, body []byte) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewReader(body))
		req.RemoteAddr = "192.0.2.10:1234"
		req.Header.Set("Content-Type", contentType)
		req.Header.Set("Authorization", "Bearer "+mintJWT(t, translatorTestSecret, "u-owner", auth.RoleUser))
		rec := httptest.NewRecorder()
		server.ServeHTTP(rec, req)
		return rec
	}

	if rec := send("POST", "/api/glossaries/import", mw.FormDataContentType(), form.Bytes()); rec.Code != http.StatusCreated {
		t.Errorf("import of a %d byte CSV: %d %s, want 201", csv.Len(), rec.Code, rec.Body.String())
	}
	// Control: the cap is in force on the neighbouring JSON routes.
	big := []byte(`{"name":"` + strings.Repeat("x", globalCap) + `"}`)
	for _, path := range []string{"/api/glossaries", "/api/translator/translate"} {
		if rec := send("POST", path, "application/json", big); rec.Code != http.StatusRequestEntityTooLarge {
			t.Errorf("POST %s with a body over the global cap: %d, want 413", path, rec.Code)
		}
	}
	// And a CSV over the import's own limit is still refused by the handler.
	var huge bytes.Buffer
	mw = multipart.NewWriter(&huge)
	_ = mw.WriteField("name", "Too big")
	_ = mw.WriteField("sourceLanguage", "de")
	_ = mw.WriteField("targetLanguage", "en")
	fw, _ = mw.CreateFormFile("file", "terms.csv")
	_, _ = fw.Write(bytes.Repeat([]byte("a,b\n"), translator.GlossaryImportMaxBytes/4+1000))
	_ = mw.Close()
	if rec := send("POST", "/api/glossaries/import", mw.FormDataContentType(), huge.Bytes()); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("a CSV over 5 MiB: %d, want 413", rec.Code)
	}
}
