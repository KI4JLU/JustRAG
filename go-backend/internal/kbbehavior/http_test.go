package kbbehavior

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/store"
)

type fakeStore struct {
	saved   *Behavior
	reset   bool
	missing bool
}

func (f *fakeStore) Load(_ context.Context, kbID string) (Settings, error) {
	if f.missing {
		return Settings{}, fmt.Errorf("kb %s: %w", kbID, store.ErrNotFound)
	}
	if f.saved != nil {
		stored, legacy := ForStorage(*f.saved)
		return Settings{Behavior: Effective(&stored, legacy, "", "de"), Customized: true, Language: "de"}, nil
	}
	return Settings{Behavior: Effective(nil, nil, "", "de"), Language: "de"}, nil
}

func (f *fakeStore) Save(_ context.Context, _ string, b Behavior) error {
	if f.missing {
		return store.ErrNotFound
	}
	f.saved = &b
	return nil
}

func (f *fakeStore) Reset(_ context.Context, _ string) error {
	f.reset, f.saved = true, nil
	return nil
}

func do(t *testing.T, h http.HandlerFunc, method, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, "/api/kb/kb-1/behavior", strings.NewReader(body))
	req.SetPathValue("id", "kb-1")
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

// Oracle: a refused body leaves the stored behavior untouched and answers 400
// with the validation reason; a valid one is saved and read back.
func TestPut(t *testing.T) {
	f := &fakeStore{}
	h := &Handler{store: f}

	rec := do(t, h.Put, http.MethodPut, `{"version":1,"activeRoleId":"nope","customRoles":[],"roleRules":{}}`)
	if rec.Code != http.StatusBadRequest || f.saved != nil {
		t.Fatalf("invalid: code=%d saved=%v body=%s", rec.Code, f.saved, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), `active role \"nope\" does not exist`) {
		t.Errorf("reason missing: %s", rec.Body)
	}

	rec = do(t, h.Put, http.MethodPut, `{"version":1,"activeRoleId":"tutor","customRoles":[],"roleRules":{},"extra":1}`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("unknown field: code=%d", rec.Code)
	}

	rec = do(t, h.Put, http.MethodPut, `{"version":1,"activeRoleId":"tutor","customRoles":[],"roleRules":{}}`)
	if rec.Code != http.StatusOK || f.saved == nil {
		t.Fatalf("valid: code=%d body=%s", rec.Code, rec.Body)
	}
	var s Settings
	if err := json.Unmarshal(rec.Body.Bytes(), &s); err != nil {
		t.Fatal(err)
	}
	if !s.Customized || s.Behavior.ActiveRoleID != "tutor" || !RulesFor(s.Behavior, "tutor").Rules["pages"] {
		t.Errorf("response = %+v", s)
	}
}

func TestDeleteAndGet(t *testing.T) {
	f := &fakeStore{saved: &Behavior{Version: 1, ActiveRoleID: "tutor"}}
	h := &Handler{store: f}
	rec := do(t, h.Delete, http.MethodDelete, "")
	if rec.Code != http.StatusOK || !f.reset {
		t.Fatalf("delete: code=%d", rec.Code)
	}
	var s Settings
	_ = json.Unmarshal(rec.Body.Bytes(), &s)
	if s.Customized || s.Behavior.ActiveRoleID != LegacyRoleID {
		t.Errorf("after delete = %+v", s)
	}

	f.missing = true
	if rec := do(t, h.Get, http.MethodGet, ""); rec.Code != http.StatusNotFound {
		t.Errorf("missing KB: code=%d", rec.Code)
	}
}

func TestCatalogHandlerLanguage(t *testing.T) {
	h := &Handler{}
	for q, want := range map[string]string{"en": "en", "de": "de", "fr": "de", "": "de"} {
		req := httptest.NewRequest(http.MethodGet, "/api/kb-behavior/catalog?lang="+q, nil)
		rec := httptest.NewRecorder()
		h.Catalog(rec, req)
		var c Catalog
		if err := json.Unmarshal(rec.Body.Bytes(), &c); err != nil || c.Language != want {
			t.Errorf("lang=%q: got %q (%v)", q, c.Language, err)
		}
	}
}
