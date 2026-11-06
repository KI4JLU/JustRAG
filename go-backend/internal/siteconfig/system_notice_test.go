package siteconfig_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/siteconfig"
)

// TestValidateGlobalValues_SystemNotice walks each system-notice key through
// its accepted and refused values. The oracle for the URL cases is what a
// browser would do with the value in an href: anything that can leave the
// http(s) schemes or this origin's paths unannounced is refused.
func TestValidateGlobalValues_SystemNotice(t *testing.T) {
	t.Parallel()
	cases := []struct {
		key     string
		value   string
		wantErr bool
	}{
		{"system_notice_enabled", "true", false},
		{"system_notice_enabled", "false", false},
		{"system_notice_enabled", "yes", true},
		{"system_notice_dismissible", "true", false},
		{"system_notice_dismissible", "1", true},
		// Exact form only: the readers compare the raw value.
		{"system_notice_enabled", " true ", true},
		{"system_notice_tone", " warning", true},

		{"system_notice_tone", "neutral", false},
		{"system_notice_tone", "info", false},
		{"system_notice_tone", "warning", false},
		{"system_notice_tone", "error", false},
		{"system_notice_tone", "success", true},
		{"system_notice_tone", "danger", true},

		// Placement: "" (by tone) or one of three exact values.
		{"system_notice_placement", "", false},
		{"system_notice_placement", "banner", false},
		{"system_notice_placement", "inline", false},
		{"system_notice_placement", "toast", false},
		{"system_notice_placement", "Banner", true},
		{"system_notice_placement", "TOAST", true},
		{"system_notice_placement", " banner", true},
		{"system_notice_placement", "inline ", true},
		{"system_notice_placement", "top", true},
		{"system_notice_placement", "error", true},

		{"system_notice_text", strings.Repeat("ä", 1000), false},
		{"system_notice_text", strings.Repeat("ä", 1001), true},
		{"system_notice_title", strings.Repeat("ö", 80), false},
		{"system_notice_title", strings.Repeat("ö", 81), true},
		{"system_notice_link_label", strings.Repeat("ü", 80), false},
		{"system_notice_link_label", strings.Repeat("ü", 81), true},

		{"system_notice_link_url", "https://www.uni-giessen.de/wartung", false},
		{"system_notice_link_url", "http://intranet.example/status?x=1", false},
		{"system_notice_link_url", "/kb/abc", false},
		{"system_notice_link_url", "mailto:ki@uni-giessen.de", false},
		{"system_notice_link_url", "mailto://ki@uni-giessen.de", false},
		{"system_notice_link_url", "MAILTO:ki@uni-giessen.de?subject=Wartung", false},
		{"system_notice_link_url", "mailto:", true},
		{"system_notice_link_url", "mailto:not-an-address", true},
		{"system_notice_link_url", "mailto:Jamie <ki@uni-giessen.de>", true},
		{"system_notice_link_url", "javascript:alert(1)", true},
		{"system_notice_link_url", "JavaScript:alert(1)", true},
		{"system_notice_link_url", "data:text/html,hi", true},
		{"system_notice_link_url", "//evil.example/x", true},
		{"system_notice_link_url", `/\evil.example/x`, true},
		{"system_notice_link_url", "https://", true},
		{"system_notice_link_url", "www.uni-giessen.de", true},
		{"system_notice_link_url", " https://www.uni-giessen.de", true},
		{"system_notice_link_url", "https://a.example/a b", true},
		{"system_notice_link_url", "https://a.example/" + strings.Repeat("a", 2048), true},
	}
	for _, tc := range cases {
		name := tc.key + "=" + tc.value
		if len(name) > 80 {
			name = name[:80]
		}
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			v := tc.value
			err := siteconfig.ValidateGlobalValues([]siteconfig.KeyValue{{Key: tc.key, Value: &v}})
			if tc.wantErr {
				if err == nil {
					t.Fatalf("want error for %q", tc.value)
				}
				if !strings.Contains(err.Error(), tc.key) {
					t.Fatalf("error %q does not name the key %q", err.Error(), tc.key)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

// TestGetSiteConfig_SystemNoticeIsPublic — the notice is for every user, so a
// regular user's GET must carry all eight keys. Without the allowlist entries
// the handler drops them and the notice never renders for non-admins.
func TestGetSiteConfig_SystemNoticeIsPublic(t *testing.T) {
	keys := []string{
		"system_notice_enabled", "system_notice_title", "system_notice_text", "system_notice_tone",
		"system_notice_placement", "system_notice_dismissible", "system_notice_link_url",
		"system_notice_link_label",
	}
	rows := make([]siteconfig.SiteConfigRow, 0, len(keys))
	for _, k := range keys {
		rows = append(rows, siteconfig.SiteConfigRow{Key: k, Value: strPtr("x")})
	}
	h := siteconfig.NewHandler(&mockStore{rows: rows})

	req := httptest.NewRequest(http.MethodGet, "/api/site-config", nil)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: "3", Role: "user"}))
	rec := httptest.NewRecorder()
	h.GetSiteConfig(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, k := range keys {
		if _, ok := body[k]; !ok {
			t.Errorf("regular user does not see %s", k)
		}
	}
}

// TestUpdateSiteConfig_RejectsUnsafeNoticeURL is the wiring test for the
// URL check: a javascript: link must not reach the store.
func TestUpdateSiteConfig_RejectsUnsafeNoticeURL(t *testing.T) {
	store := &mockStore{}
	h := siteconfig.NewHandler(store)

	body := strings.NewReader(`{"configs":{"system_notice_link_url":"javascript:alert(1)"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/site-config", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.UpdateSiteConfig(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
	if store.lastBatch != nil {
		t.Fatalf("store received %v; the batch must be refused before the write", store.lastBatch)
	}
}

func putSystemNotice(t *testing.T, store *mockStore, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/api/admin/system-notice", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	siteconfig.NewHandler(store).UpdateSystemNotice(rec, req)
	return rec
}

// TestUpdateSystemNotice_WritesTheNoticeKeys — strings, booleans and null all
// reach the store in their stored form ("true", nil).
func TestUpdateSystemNotice_WritesTheNoticeKeys(t *testing.T) {
	store := &mockStore{batchRows: []siteconfig.SiteConfigRow{{Key: "system_notice_text", Value: strPtr("Wartung")}}}
	rec := putSystemNotice(t, store, `{"configs":{"system_notice_text":"Wartung","system_notice_enabled":true,"system_notice_link_url":null}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	got := map[string]*string{}
	for _, kv := range store.lastBatch {
		got[kv.Key] = kv.Value
	}
	if v := got["system_notice_enabled"]; v == nil || *v != "true" {
		t.Errorf("system_notice_enabled = %v, want \"true\"", v)
	}
	if v, ok := got["system_notice_link_url"]; !ok || v != nil {
		t.Errorf("system_notice_link_url should be cleared (nil), got %v (present %v)", v, ok)
	}
	if len(got) != 3 {
		t.Errorf("store got %d keys, want 3", len(got))
	}
}

// TestUpdateSystemNotice_RefusesOtherKeys is the boundary of this route: a
// plain admin reaches it, so it must not write any other site_config key —
// and the refusal comes before the write.
func TestUpdateSystemNotice_RefusesOtherKeys(t *testing.T) {
	for _, body := range []string{
		`{"configs":{"system_notice_text":"x","chat_sql_query_enabled":"true"}}`,
		`{"configs":{"google_search_api_key":"k"}}`,
	} {
		store := &mockStore{}
		rec := putSystemNotice(t, store, body)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: want 400, got %d", body, rec.Code)
		}
		if store.lastBatch != nil {
			t.Errorf("%s: store received %v", body, store.lastBatch)
		}
	}
}

func TestUpdateSystemNotice_RejectsInvalidValues(t *testing.T) {
	for _, body := range []string{
		`{"configs":{"system_notice_link_url":"javascript:alert(1)"}}`,
		`{"configs":{"system_notice_tone":"success"}}`,
		`{"configs":{"system_notice_placement":"top"}}`,
		`{"configs":{"system_notice_placement":"Toast"}}`,
		`{"configs":{"system_notice_placement":true}}`,
		`{"configs":{"system_notice_enabled":1}}`,
		`{"configs":{}}`,
		`not json`,
	} {
		store := &mockStore{}
		rec := putSystemNotice(t, store, body)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: want 400, got %d", body, rec.Code)
		}
		if store.lastBatch != nil {
			t.Errorf("%s: store received %v", body, store.lastBatch)
		}
	}
}

// TestUpdateSystemNotice_WritesPlacement — the admin route takes the
// placement key in its stored form; "" and null both leave the placement to
// the tone.
func TestUpdateSystemNotice_WritesPlacement(t *testing.T) {
	cases := []struct {
		name, body string
		want       *string
	}{
		{"banner", `{"configs":{"system_notice_placement":"banner"}}`, strPtr("banner")},
		{"inline", `{"configs":{"system_notice_placement":"inline"}}`, strPtr("inline")},
		{"toast", `{"configs":{"system_notice_placement":"toast"}}`, strPtr("toast")},
		{"empty (by tone)", `{"configs":{"system_notice_placement":""}}`, strPtr("")},
		{"null (cleared)", `{"configs":{"system_notice_placement":null}}`, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &mockStore{}
			rec := putSystemNotice(t, store, tc.body)
			if rec.Code != http.StatusOK {
				t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
			}
			if len(store.lastBatch) != 1 || store.lastBatch[0].Key != "system_notice_placement" {
				t.Fatalf("store got %v", store.lastBatch)
			}
			got := store.lastBatch[0].Value
			switch {
			case tc.want == nil && got != nil:
				t.Fatalf("value = %q, want nil", *got)
			case tc.want != nil && (got == nil || *got != *tc.want):
				t.Fatalf("value = %v, want %q", got, *tc.want)
			}
		})
	}
}

func TestValidateGlobalValues_SystemNoticeTemplates(t *testing.T) {
	t.Parallel()
	ok := `[{"name":"Wartung","text":"Wartung am Freitag","tone":"warning","dismissible":true,"linkUrl":"mailto:ki@uni-giessen.de","linkLabel":"Kontakt"}]`
	many := "[" + strings.TrimSuffix(strings.Repeat(`{"name":"n","text":"t","tone":"info"},`, 21), ",") + "]"
	cases := []struct {
		name, value string
		wantErr     bool
	}{
		{"valid", ok, false},
		{"empty list (all deleted)", `[]`, false},
		{"not an array", `{"name":"x"}`, true},
		{"unknown field", `[{"name":"n","text":"t","tone":"info","html":"<b>"}]`, true},
		{"no name", `[{"name":" ","text":"t","tone":"info"}]`, true},
		{"long name", `[{"name":"` + strings.Repeat("n", 61) + `","text":"t","tone":"info"}]`, true},
		{"no text", `[{"name":"n","text":"","tone":"info"}]`, true},
		{"bad tone", `[{"name":"n","text":"t","tone":"success"}]`, true},
		// Templates saved before the placement field existed have none.
		{"without placement", `[{"name":"n","text":"t","tone":"error"}]`, false},
		{"placement empty (by tone)", `[{"name":"n","text":"t","tone":"error","placement":""}]`, false},
		{"placement banner", `[{"name":"n","text":"t","tone":"info","placement":"banner"}]`, false},
		{"placement inline", `[{"name":"n","text":"t","tone":"error","placement":"inline"}]`, false},
		{"placement toast", `[{"name":"n","text":"t","tone":"warning","placement":"toast"}]`, false},
		{"bad placement", `[{"name":"n","text":"t","tone":"info","placement":"top"}]`, true},
		{"placement wrong case", `[{"name":"n","text":"t","tone":"info","placement":"Toast"}]`, true},
		{"placement with spaces", `[{"name":"n","text":"t","tone":"info","placement":" toast"}]`, true},
		{"placement blank", `[{"name":"n","text":"t","tone":"info","placement":" "}]`, true},
		{"placement not a string", `[{"name":"n","text":"t","tone":"info","placement":true}]`, true},
		{"unsafe link", `[{"name":"n","text":"t","tone":"info","linkUrl":"javascript:alert(1)"}]`, true},
		{"too many", many, true},
		{"trailing data", `[] garbage`, true},
		{"two arrays", `[][]`, true},
		{"trailing whitespace", "[]\n", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			v := tc.value
			err := siteconfig.ValidateGlobalValues([]siteconfig.KeyValue{{Key: "system_notice_templates", Value: &v}})
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}

// TestUpdateSystemNotice_SavesTemplates — the admin route writes the
// template list too; it is one of its keys.
func TestUpdateSystemNotice_SavesTemplates(t *testing.T) {
	store := &mockStore{}
	rec := putSystemNotice(t, store, `{"configs":{"system_notice_templates":"[]"}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(store.lastBatch) != 1 || store.lastBatch[0].Key != "system_notice_templates" {
		t.Fatalf("store got %v", store.lastBatch)
	}
}
