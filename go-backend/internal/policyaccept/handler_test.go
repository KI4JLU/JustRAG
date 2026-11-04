// Unit tests for the policyaccept HTTP surface.
//
// Oracle: the contract in API.md — GET reports {version, required,
// acceptedAt?} with version "" and required false while the key is unset;
// POST stores only the current version (409 policy_version_changed for any
// other, including while the notice is off), 400 for a missing version or bad
// JSON, 200 with the acceptance time otherwise. The store and the site_config
// reader are fakes whose answers the test picks.

package policyaccept_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/policyaccept"
)

const testUserID = "11111111-1111-1111-1111-111111111111"

type fakeCfg struct {
	value *string
	err   error
}

func (f fakeCfg) GetSiteConfigValue(_ context.Context, key string) (*string, error) {
	if key != policyaccept.VersionKey {
		return nil, nil
	}
	return f.value, f.err
}

type fakeStore struct {
	accepted map[string]time.Time // version → time, for testUserID
	gotUser  string
	err      error
}

func (f *fakeStore) AcceptedAt(_ context.Context, userID, version string) (*time.Time, error) {
	f.gotUser = userID
	if f.err != nil {
		return nil, f.err
	}
	if at, ok := f.accepted[version]; ok {
		return &at, nil
	}
	return nil, nil
}

func (f *fakeStore) Accept(_ context.Context, userID, version string) (time.Time, error) {
	f.gotUser = userID
	if f.err != nil {
		return time.Time{}, f.err
	}
	if at, ok := f.accepted[version]; ok {
		return at, nil
	}
	at := time.Date(2026, 11, 3, 10, 0, 0, 0, time.UTC)
	f.accepted[version] = at
	return at, nil
}

func strp(s string) *string { return &s }

func authed(method, body string) *http.Request {
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, "/api/user/policy-acceptance", nil)
	} else {
		req = httptest.NewRequest(method, "/api/user/policy-acceptance", strings.NewReader(body))
	}
	return req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: testUserID, Role: auth.RoleUser}))
}

type state struct {
	Version    string  `json:"version"`
	Required   bool    `json:"required"`
	AcceptedAt *string `json:"acceptedAt"`
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) state {
	t.Helper()
	var s state
	if err := json.Unmarshal(rec.Body.Bytes(), &s); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return s
}

func TestGet(t *testing.T) {
	earlier := time.Date(2026, 7, 14, 8, 0, 0, 0, time.UTC)
	tests := []struct {
		name         string
		cfg          fakeCfg
		accepted     map[string]time.Time
		wantStatus   int
		wantVersion  string
		wantRequired bool
		wantAccepted bool
	}{
		{name: "unset is off", cfg: fakeCfg{}, wantStatus: 200},
		{name: "blank is off", cfg: fakeCfg{value: strp("  ")}, wantStatus: 200},
		{name: "invalid stored value is off", cfg: fakeCfg{value: strp("v 2 <b>")}, wantStatus: 200},
		{name: "not yet accepted", cfg: fakeCfg{value: strp("2026-07-13")}, wantStatus: 200,
			wantVersion: "2026-07-13", wantRequired: true},
		{name: "only an older version accepted", cfg: fakeCfg{value: strp("2026-11-01")},
			accepted: map[string]time.Time{"2026-07-13": earlier}, wantStatus: 200,
			wantVersion: "2026-11-01", wantRequired: true},
		{name: "current version accepted", cfg: fakeCfg{value: strp(" 2026-07-13 ")},
			accepted: map[string]time.Time{"2026-07-13": earlier}, wantStatus: 200,
			wantVersion: "2026-07-13", wantAccepted: true},
		{name: "config read fails", cfg: fakeCfg{err: errors.New("db down")}, wantStatus: 500},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeStore{accepted: tc.accepted}
			h := policyaccept.NewHandler(store, tc.cfg)
			rec := httptest.NewRecorder()
			h.Get(rec, authed(http.MethodGet, ""))
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d (%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if tc.wantStatus != 200 {
				return
			}
			s := decode(t, rec)
			if s.Version != tc.wantVersion || s.Required != tc.wantRequired || (s.AcceptedAt != nil) != tc.wantAccepted {
				t.Fatalf("got %+v, want version=%q required=%v accepted=%v", s, tc.wantVersion, tc.wantRequired, tc.wantAccepted)
			}
			if tc.wantVersion != "" && store.gotUser != testUserID {
				t.Fatalf("store asked for user %q, want the caller", store.gotUser)
			}
		})
	}
}

func TestAccept(t *testing.T) {
	tests := []struct {
		name       string
		cfg        fakeCfg
		body       string
		wantStatus int
		wantCode   string
		wantStored bool
	}{
		{name: "current version", cfg: fakeCfg{value: strp("2026-07-13")}, body: `{"version":"2026-07-13"}`,
			wantStatus: 200, wantStored: true},
		{name: "stale version", cfg: fakeCfg{value: strp("2026-11-01")}, body: `{"version":"2026-07-13"}`,
			wantStatus: 409, wantCode: "policy_version_changed"},
		{name: "notice off", cfg: fakeCfg{}, body: `{"version":"2026-07-13"}`,
			wantStatus: 409, wantCode: "policy_version_changed"},
		{name: "missing version", cfg: fakeCfg{value: strp("2026-07-13")}, body: `{}`, wantStatus: 400},
		{name: "bad json", cfg: fakeCfg{value: strp("2026-07-13")}, body: `{`, wantStatus: 400},
		{name: "oversized body", cfg: fakeCfg{value: strp("2026-07-13")},
			body: `{"version":"` + strings.Repeat("x", 2000) + `"}`, wantStatus: 400},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeStore{accepted: map[string]time.Time{}}
			h := policyaccept.NewHandler(store, tc.cfg)
			rec := httptest.NewRecorder()
			h.Accept(rec, authed(http.MethodPost, tc.body))
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d (%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if tc.wantCode != "" {
				var e struct {
					Code string `json:"code"`
				}
				_ = json.Unmarshal(rec.Body.Bytes(), &e)
				if e.Code != tc.wantCode {
					t.Fatalf("code = %q, want %q", e.Code, tc.wantCode)
				}
			}
			if stored := len(store.accepted) > 0; stored != tc.wantStored {
				t.Fatalf("stored = %v, want %v", stored, tc.wantStored)
			}
			if tc.wantStored {
				s := decode(t, rec)
				if s.Required || s.AcceptedAt == nil || store.gotUser != testUserID {
					t.Fatalf("got %+v for user %q", s, store.gotUser)
				}
			}
		})
	}
}

func TestUnauthenticated(t *testing.T) {
	h := policyaccept.NewHandler(&fakeStore{}, fakeCfg{value: strp("v1")})
	for _, m := range []string{http.MethodGet, http.MethodPost} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(m, "/api/user/policy-acceptance", strings.NewReader(`{"version":"v1"}`))
		if m == http.MethodGet {
			h.Get(rec, req)
		} else {
			h.Accept(rec, req)
		}
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s: status = %d, want 401", m, rec.Code)
		}
	}
}

func TestValidateVersion(t *testing.T) {
	for _, v := range []string{"", "  ", "2026-07-13", "v2", "terms_1.4", strings.Repeat("a", 64)} {
		if err := policyaccept.ValidateVersion(v); err != nil {
			t.Errorf("ValidateVersion(%q) = %v, want nil", v, err)
		}
	}
	for _, v := range []string{"v 2", "<b>", "ä", strings.Repeat("a", 65), "v1\nv2"} {
		if err := policyaccept.ValidateVersion(v); err == nil {
			t.Errorf("ValidateVersion(%q) = nil, want an error", v)
		}
	}
}
