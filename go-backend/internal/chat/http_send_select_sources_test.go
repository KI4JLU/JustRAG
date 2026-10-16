package chat

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/kbaccess"
)

// TestSendMessage_SelectedFilesNeedSelectSources pins the selectSources gate
// on POST /api/kb/{id}/chat: a turn carrying selectedFileIds from a caller
// whose capabilities withhold source selection is refused with 403 before
// any chat row or usage event is written; the same turn without a
// selection, or from a caller whose own role's flag is on, is accepted.
//
// Oracles, both independent of the gate's own code:
//   - the mock store's chats map — a refused turn must leave it empty, an
//     accepted turn creates exactly one chat (CreateChat writes into it);
//   - the fake usage recorder — a refused turn records nothing, an accepted
//     one exactly one event.
//
// Accepted turns run into erroringSearcher and end in 500; that is the
// established way (TestSendMessage_AcceptedTurnRecordsOneUsageEventEvenOnLaterFailure)
// to prove a turn got past every up-front check without a live AI backend.
// Expected statuses are written by hand from the spec: viewers follow
// viewer_select_sources, editors editor_select_sources (the other role's
// flag never helps), KB admins always select.
func TestSendMessage_SelectedFilesNeedSelectSources(t *testing.T) {
	// Every flag on except the select flag of the role under test, so a
	// refusal cannot come from some other flag being off.
	viewerSelectOff := kbaccess.SourcePermissions{
		ViewerSeeSources: true, ViewerDownloadSources: true, ViewerSeeCitations: true,
		EditorSeeSources: true, EditorSelectSources: true, EditorDownloadSources: true, EditorSeeCitations: true,
	}
	editorSelectOff := kbaccess.SourcePermissions{
		ViewerSeeSources: true, ViewerSelectSources: true, ViewerDownloadSources: true, ViewerSeeCitations: true,
		EditorSeeSources: true, EditorDownloadSources: true, EditorSeeCitations: true,
	}
	cases := []struct {
		name     string
		role     string
		flags    kbaccess.SourcePermissions
		body     string
		accepted bool
	}{
		{"viewer_flag_off_with_selection", kbaccess.RoleView, viewerSelectOff, `{"message":"hi","selectedFileIds":["f1"]}`, false},
		{"viewer_flag_on_with_selection", kbaccess.RoleView, kbaccess.SourcePermissions{ViewerSelectSources: true}, `{"message":"hi","selectedFileIds":["f1"]}`, true},
		{"viewer_flag_off_without_selection", kbaccess.RoleView, kbaccess.SourcePermissions{}, `{"message":"hi"}`, true},
		{"viewer_flag_off_empty_selection", kbaccess.RoleView, kbaccess.SourcePermissions{}, `{"message":"hi","selectedFileIds":[]}`, true},
		{"editor_flag_off_with_selection", kbaccess.RoleEdit, editorSelectOff, `{"message":"hi","selectedFileIds":["f1"]}`, false},
		{"editor_flag_on_with_selection", kbaccess.RoleEdit, kbaccess.SourcePermissions{EditorSelectSources: true}, `{"message":"hi","selectedFileIds":["f1"]}`, true},
		{"editor_flag_off_without_selection", kbaccess.RoleEdit, kbaccess.SourcePermissions{}, `{"message":"hi"}`, true},
		{"kb_admin_no_flags_with_selection", kbaccess.RoleAdmin, kbaccess.SourcePermissions{}, `{"message":"hi","selectedFileIds":["f1"]}`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newMockStore()
			rec := &fakeUsageRecorder{}
			h := &Handler{store: store, searchService: erroringSearcher{}, usageRecorder: rec}

			r := httptest.NewRequest(http.MethodPost, "/api/kb/kb1/chat", strings.NewReader(tc.body))
			r.Header.Set("Content-Type", "application/json")
			r = injectUser(r, "user1")
			r.SetPathValue("id", "kb1")
			// What kbViewChain's RequireKBRole stores for this caller.
			r = r.WithContext(kbaccess.WithAccess(r.Context(), &kbaccess.KBAccessResult{
				KB:   &kbaccess.KnowledgeBase{ID: "kb1", Sources: tc.flags},
				Role: tc.role,
			}))
			w := httptest.NewRecorder()
			h.SendMessage(w, r)

			if !tc.accepted {
				if w.Code != http.StatusForbidden {
					t.Fatalf("status %d, want 403: %s", w.Code, w.Body.String())
				}
				if !strings.Contains(w.Body.String(), MsgSelectSourcesForbidden) {
					t.Errorf("body %q does not name the refusal", w.Body.String())
				}
				if len(store.chats) != 0 {
					t.Fatalf("refused turn created %d chat(s)", len(store.chats))
				}
				if n := len(rec.snapshot()); n != 0 {
					t.Fatalf("refused turn recorded %d usage event(s)", n)
				}
				return
			}
			if w.Code == http.StatusForbidden {
				t.Fatalf("accepted case refused: %s", w.Body.String())
			}
			if len(store.chats) != 1 {
				t.Fatalf("accepted turn created %d chats, want 1 (status %d)", len(store.chats), w.Code)
			}
			if n := len(rec.snapshot()); n != 1 {
				t.Fatalf("accepted turn recorded %d usage events, want 1", n)
			}
		})
	}
}

// TestSendMessage_SelectionWithoutAccessResultFailsClosed: a handler reached
// without RequireKBRole in front has no capabilities to consult, so a
// selection is refused rather than waved through. Oracle: the chats map.
func TestSendMessage_SelectionWithoutAccessResultFailsClosed(t *testing.T) {
	store := newMockStore()
	h := &Handler{store: store, searchService: erroringSearcher{}}
	r := httptest.NewRequest(http.MethodPost, "/api/kb/kb1/chat",
		strings.NewReader(`{"message":"hi","selectedFileIds":["f1"]}`))
	r = injectUser(r, "user1")
	r.SetPathValue("id", "kb1")
	w := httptest.NewRecorder()
	h.SendMessage(w, r)
	if w.Code != http.StatusForbidden || len(store.chats) != 0 {
		t.Fatalf("status %d, chats %d; want 403 and none", w.Code, len(store.chats))
	}
}
