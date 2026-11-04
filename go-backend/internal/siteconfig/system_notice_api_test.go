package siteconfig_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/siteconfig"
)

// memStore applies writes, so a PUT's answer can be checked against what a
// following read returns — the oracle is the stored state, not the request.
type memStore struct{ values map[string]*string }

func (m *memStore) GetAllSiteConfigs(context.Context) ([]siteconfig.SiteConfigRow, error) {
	rows := make([]siteconfig.SiteConfigRow, 0, len(m.values))
	for k, v := range m.values {
		rows = append(rows, siteconfig.SiteConfigRow{Key: k, Value: v})
	}
	return rows, nil
}

func (m *memStore) UpdateSiteConfigsBatch(_ context.Context, kvs []siteconfig.KeyValue) ([]siteconfig.SiteConfigRow, error) {
	for _, kv := range kvs {
		m.values[kv.Key] = kv.Value
	}
	return nil, nil
}

func (m *memStore) UpdateSiteConfig(_ context.Context, key, value string) error {
	m.values[key] = &value
	return nil
}

func noticeAPI(t *testing.T, store *memStore, method, body string) (*httptest.ResponseRecorder, siteconfig.SystemNoticeState) {
	t.Helper()
	h := siteconfig.NewHandler(store)
	req := httptest.NewRequest(method, "/api/v1/system-notice", strings.NewReader(body))
	rec := httptest.NewRecorder()
	if method == http.MethodGet {
		h.GetSystemNoticeAPI(rec, req)
	} else {
		h.UpdateSystemNoticeAPI(rec, req)
	}
	var state siteconfig.SystemNoticeState
	if rec.Code == http.StatusOK {
		if err := json.NewDecoder(rec.Body).Decode(&state); err != nil {
			t.Fatalf("decode: %v", err)
		}
	}
	return rec, state
}

func TestSystemNoticeAPI_SwitchOnAndOff(t *testing.T) {
	store := &memStore{values: map[string]*string{}}

	rec, state := noticeAPI(t, store, http.MethodPut, `{"enabled":true,"title":"Dienst nicht verfügbar","text":"Der Dienst ist gestört.","tone":"error"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("enable: %d %s", rec.Code, rec.Body.String())
	}
	if !state.Enabled || state.Title != "Dienst nicht verfügbar" || state.Text != "Der Dienst ist gestört." || state.Tone != "error" {
		t.Fatalf("after enable: %+v", state)
	}

	// Partial: only the switch moves, the text stays for next time.
	_, state = noticeAPI(t, store, http.MethodPut, `{"enabled":false}`)
	if state.Enabled || state.Text != "Der Dienst ist gestört." {
		t.Fatalf("after disable: %+v", state)
	}
	if v := store.values["system_notice_enabled"]; v == nil || *v != "false" {
		t.Fatalf("stored enabled = %v", v)
	}

	_, got := noticeAPI(t, store, http.MethodGet, "")
	if got != state {
		t.Fatalf("GET %+v differs from PUT answer %+v", got, state)
	}
}

func TestSystemNoticeAPI_Refusals(t *testing.T) {
	cases := []struct{ name, body string }{
		{"empty body", `{}`},
		{"unknown field", `{"enabled":true,"text":"x","colour":"red"}`},
		{"wrong type", `{"enabled":"yes"}`},
		{"bad tone", `{"tone":"success"}`},
		{"unsafe link", `{"linkUrl":"javascript:alert(1)"}`},
		{"enable without any text", `{"enabled":true}`},
		{"not json", `nope`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &memStore{values: map[string]*string{}}
			rec, _ := noticeAPI(t, store, http.MethodPut, tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("want 400, got %d", rec.Code)
			}
			if len(store.values) != 0 {
				t.Fatalf("store was written: %v", store.values)
			}
		})
	}
}

// Clearing the text of a notice that is on would leave an enabled notice
// that shows nothing: refused, and nothing is written.
func TestSystemNoticeAPI_RefusesClearingTextWhileEnabled(t *testing.T) {
	on, text := "true", "Wartung am Freitag"
	store := &memStore{values: map[string]*string{"system_notice_enabled": &on, "system_notice_text": &text}}
	rec, _ := noticeAPI(t, store, http.MethodPut, `{"text":"  "}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
	if got := *store.values["system_notice_text"]; got != text {
		t.Fatalf("text was overwritten: %q", got)
	}
	// Switching off and clearing in one go is fine.
	rec, state := noticeAPI(t, store, http.MethodPut, `{"enabled":false,"text":""}`)
	if rec.Code != http.StatusOK || state.Enabled || state.Text != "" {
		t.Fatalf("%d %+v", rec.Code, state)
	}
}

// An empty string clears the link (null would mean "leave it").
func TestSystemNoticeAPI_EmptyLinkClearsIt(t *testing.T) {
	link := "https://www.uni-giessen.de"
	store := &memStore{values: map[string]*string{"system_notice_link_url": &link}}
	rec, state := noticeAPI(t, store, http.MethodPut, `{"linkUrl":""}`)
	if rec.Code != http.StatusOK || state.LinkURL != "" {
		t.Fatalf("%d %+v", rec.Code, state)
	}
}

// Enabling with the text already stored (set earlier in the admin UI) works.
func TestSystemNoticeAPI_EnableUsesStoredText(t *testing.T) {
	text := "Wartung am Freitag"
	store := &memStore{values: map[string]*string{"system_notice_text": &text}}
	rec, state := noticeAPI(t, store, http.MethodPut, `{"enabled":true}`)
	if rec.Code != http.StatusOK || !state.Enabled || state.Text != text {
		t.Fatalf("%d %+v", rec.Code, state)
	}
}
