package chat

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/store"
)

// fakeSections records what reaches the store.
type fakeSections struct {
	created, renamed []string
	deleted, ordered []string
	err              error
}

func (f *fakeSections) List(context.Context, string) ([]Section, error) { return nil, f.err }
func (f *fakeSections) Create(_ context.Context, _, name string) (*Section, error) {
	if f.err != nil {
		return nil, f.err
	}
	f.created = append(f.created, name)
	return &Section{ID: "11111111-1111-4111-8111-111111111111", Name: name}, nil
}
func (f *fakeSections) Rename(_ context.Context, _, _, name string) error {
	if f.err != nil {
		return f.err
	}
	f.renamed = append(f.renamed, name)
	return nil
}
func (f *fakeSections) SetOrder(_ context.Context, _ string, ids []string) error {
	if f.err != nil {
		return f.err
	}
	f.ordered = ids
	return nil
}
func (f *fakeSections) Delete(_ context.Context, id, _ string) error {
	if f.err != nil {
		return f.err
	}
	f.deleted = append(f.deleted, id)
	return nil
}

func sectionsRequest(method, target, body, pathID string) *http.Request {
	r := httptest.NewRequest(method, target, strings.NewReader(body))
	if pathID != "" {
		r.SetPathValue("id", pathID)
	}
	return r.WithContext(auth.WithUser(r.Context(), &auth.Claims{ID: "22222222-2222-4222-8222-222222222222", Role: "user"}))
}

// ORACLE: the name rule — one line, 1 to maxSectionNameLen characters
// (runes, not bytes), no control characters — and that a refused name is
// refused before anything is written.
func TestSectionsHandler_Create_Name(t *testing.T) {
	longest := strings.Repeat("ä", maxSectionNameLen)
	cases := []struct {
		name   string
		body   string
		status int
		stored string
	}{
		{"plain", `{"name":"Arbeit"}`, http.StatusCreated, "Arbeit"},
		{"whitespace collapsed", `{"name":"  Mein \n Projekt  "}`, http.StatusCreated, "Mein Projekt"},
		{"longest, counted in runes", `{"name":"` + longest + `"}`, http.StatusCreated, longest},
		{"one too long", `{"name":"` + longest + `ä"}`, http.StatusBadRequest, ""},
		{"empty", `{"name":"   "}`, http.StatusBadRequest, ""},
		{"missing", `{}`, http.StatusBadRequest, ""},
		{"control character", `{"name":"a\u0000b"}`, http.StatusBadRequest, ""},
		{"not JSON", `name`, http.StatusBadRequest, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fake := &fakeSections{}
			w := httptest.NewRecorder()
			NewSectionsHandler(fake).Create(w, sectionsRequest(http.MethodPost, "/api/chat-sections", tc.body, ""))
			if w.Code != tc.status {
				t.Fatalf("status = %d, want %d (%s)", w.Code, tc.status, w.Body.String())
			}
			switch {
			case tc.stored == "" && len(fake.created) != 0:
				t.Errorf("a refused name reached the store: %q", fake.created)
			case tc.stored != "" && (len(fake.created) != 1 || fake.created[0] != tc.stored):
				t.Errorf("stored %q, want %q", fake.created, tc.stored)
			}
		})
	}
}

func TestSectionsHandler_StatusCodes(t *testing.T) {
	const id = "33333333-3333-4333-8333-333333333333"
	h := func(f *fakeSections) *SectionsHandler { return NewSectionsHandler(f) }

	t.Run("too many sections is a conflict", func(t *testing.T) {
		w := httptest.NewRecorder()
		h(&fakeSections{err: ErrTooManySections}).Create(w, sectionsRequest(http.MethodPost, "/api/chat-sections", `{"name":"x"}`, ""))
		if w.Code != http.StatusConflict {
			t.Errorf("status = %d, want 409", w.Code)
		}
	})
	t.Run("a section that is not the caller's is not found", func(t *testing.T) {
		for _, call := range []func(*SectionsHandler, http.ResponseWriter){
			func(s *SectionsHandler, w http.ResponseWriter) {
				s.Rename(w, sectionsRequest(http.MethodPatch, "/api/chat-sections/"+id, `{"name":"x"}`, id))
			},
			func(s *SectionsHandler, w http.ResponseWriter) {
				s.Delete(w, sectionsRequest(http.MethodDelete, "/api/chat-sections/"+id, "", id))
			},
		} {
			w := httptest.NewRecorder()
			call(h(&fakeSections{err: store.ErrNotFound}), w)
			if w.Code != http.StatusNotFound {
				t.Errorf("status = %d, want 404", w.Code)
			}
		}
	})
	t.Run("a malformed id is not found and reaches no store", func(t *testing.T) {
		fake := &fakeSections{}
		w := httptest.NewRecorder()
		h(fake).Delete(w, sectionsRequest(http.MethodDelete, "/api/chat-sections/nope", "", "nope"))
		if w.Code != http.StatusNotFound || len(fake.deleted) != 0 {
			t.Errorf("status = %d, deleted = %v", w.Code, fake.deleted)
		}
	})
	t.Run("rename and delete answer 204", func(t *testing.T) {
		fake := &fakeSections{}
		w := httptest.NewRecorder()
		h(fake).Rename(w, sectionsRequest(http.MethodPatch, "/api/chat-sections/"+id, `{"name":" Neu "}`, id))
		if w.Code != http.StatusNoContent || len(fake.renamed) != 1 || fake.renamed[0] != "Neu" {
			t.Errorf("rename: status = %d, renamed = %v", w.Code, fake.renamed)
		}
		w = httptest.NewRecorder()
		h(fake).Delete(w, sectionsRequest(http.MethodDelete, "/api/chat-sections/"+id, "", id))
		if w.Code != http.StatusNoContent || len(fake.deleted) != 1 || fake.deleted[0] != id {
			t.Errorf("delete: status = %d, deleted = %v", w.Code, fake.deleted)
		}
	})
	t.Run("a refused rename body writes one answer and no rename", func(t *testing.T) {
		fake := &fakeSections{}
		w := httptest.NewRecorder()
		h(fake).Rename(w, sectionsRequest(http.MethodPatch, "/api/chat-sections/"+id, `{"name":""}`, id))
		if w.Code != http.StatusBadRequest || len(fake.renamed) != 0 {
			t.Errorf("status = %d, renamed = %v", w.Code, fake.renamed)
		}
	})
}

// ORACLE: the route's contract — the ids reach the store in the order sent,
// in canonical form; a malformed id or more ids than a user can have
// sections is refused before anything is written.
func TestSectionsHandler_SetOrder(t *testing.T) {
	const a, b = "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"
	tooMany := `{"sectionIds":[` + strings.TrimSuffix(strings.Repeat(`"`+a+`",`, MaxSectionsPerUser+1), ",") + `]}`
	tests := []struct {
		name, body string
		wantStatus int
		wantIDs    []string
	}{
		{"saves the order as sent", `{"sectionIds":["` + b + `","` + strings.ToUpper(a) + `"]}`, http.StatusNoContent, []string{b, a}},
		{"an empty order is saved", `{"sectionIds":[]}`, http.StatusNoContent, []string{}},
		{"a malformed id is refused", `{"sectionIds":["nope"]}`, http.StatusBadRequest, nil},
		{"too many ids are refused", tooMany, http.StatusBadRequest, nil},
		{"a broken body is refused", `{`, http.StatusBadRequest, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeSections{}
			w := httptest.NewRecorder()
			NewSectionsHandler(fake).SetOrder(w, sectionsRequest(http.MethodPut, "/api/chat-sections/order", tt.body, ""))
			if w.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", w.Code, tt.wantStatus)
			}
			if len(fake.ordered) != len(tt.wantIDs) || (tt.wantIDs == nil) != (fake.ordered == nil) {
				t.Fatalf("ordered = %v, want %v", fake.ordered, tt.wantIDs)
			}
			for i, id := range tt.wantIDs {
				if fake.ordered[i] != id {
					t.Errorf("ordered[%d] = %s, want %s", i, fake.ordered[i], id)
				}
			}
		})
	}
}
