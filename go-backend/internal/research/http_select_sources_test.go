package research_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/chat"
	"github.com/justrag/go-backend/internal/kbaccess"
	"github.com/justrag/go-backend/internal/research"
)

// countingStore counts CreateResearchSession calls and fails them, so an
// accepted request ends in a 500 right after the session write was
// attempted — no relay or worker needed.
type countingStore struct {
	stubStore
	sessions int
}

func (s *countingStore) CreateResearchSession(context.Context, string, string, string, string) (*chat.ChatRow, error) {
	s.sessions++
	return nil, errors.New("stop here")
}

// TestStartResearch_FileIDsNeedSelectSources pins the selectSources gate on
// POST /api/kb/{id}/research: fileIds is the same per-request source
// selection as a chat turn's selectedFileIds.
//
// Oracle: the CreateResearchSession call counter — a refused request must
// not create a research session (no side effect before the 403); an
// accepted one reaches it exactly once. Expected outcomes written by hand
// from the spec: viewers follow viewer_select_sources, editors
// editor_select_sources.
func TestStartResearch_FileIDsNeedSelectSources(t *testing.T) {
	cases := []struct {
		name     string
		role     string
		flags    kbaccess.SourcePermissions
		body     string
		accepted bool
	}{
		{"viewer_flag_off_with_files", kbaccess.RoleView, kbaccess.SourcePermissions{}, `{"goal":"g","fileIds":["f1"]}`, false},
		{"viewer_flag_on_with_files", kbaccess.RoleView, kbaccess.SourcePermissions{ViewerSelectSources: true}, `{"goal":"g","fileIds":["f1"]}`, true},
		{"viewer_flag_off_without_files", kbaccess.RoleView, kbaccess.SourcePermissions{}, `{"goal":"g"}`, true},
		{"editor_flag_off_with_files", kbaccess.RoleEdit, kbaccess.SourcePermissions{ViewerSelectSources: true}, `{"goal":"g","fileIds":["f1"]}`, false},
		{"editor_flag_on_with_files", kbaccess.RoleEdit, kbaccess.SourcePermissions{EditorSelectSources: true}, `{"goal":"g","fileIds":["f1"]}`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &countingStore{}
			h := research.NewHandler(store, nil, nil, nil, nil)
			r := httptest.NewRequest(http.MethodPost, "/api/kb/kb-1/research?stream=true", strings.NewReader(tc.body))
			r.SetPathValue("id", "kb-1")
			r = withUser(r, "user-1")
			r = r.WithContext(kbaccess.WithAccess(r.Context(), &kbaccess.KBAccessResult{
				KB: &kbaccess.KnowledgeBase{ID: "kb-1", Sources: tc.flags}, Role: tc.role,
			}))
			w := httptest.NewRecorder()
			h.StartResearch(w, r)

			if tc.accepted {
				if w.Code != http.StatusInternalServerError || store.sessions != 1 {
					t.Fatalf("status %d, sessions %d; want 500 from the stub and 1 session attempt", w.Code, store.sessions)
				}
				return
			}
			if w.Code != http.StatusForbidden || store.sessions != 0 {
				t.Fatalf("status %d, sessions %d; want 403 and no session", w.Code, store.sessions)
			}
		})
	}
}
