package publicapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/chat"
	"github.com/justrag/go-backend/internal/kb"
	"github.com/justrag/go-backend/internal/kbaccess"
	"github.com/justrag/go-backend/internal/publicapi"
)

// creatingStore counts CreateChat calls on top of mockStore.
type creatingStore struct {
	mockStore
	created int
}

func (s *creatingStore) CreateChat(ctx context.Context, kbID, userID, title string) (*chat.ChatRow, error) {
	s.created++
	return s.mockStore.CreateChat(ctx, kbID, userID, title)
}

// TestSendMessage_SelectedFilesNeedSelectSources pins the selectSources gate
// on POST /api/v1/kb/{id}/chat — the same selectedFileIds field and the same
// rule as the web chat, so an API key cannot select what the UI may not.
//
// Oracles: the CreateChat counter and the usage recorder — a refused turn
// writes neither; an accepted one creates one chat and records one event
// (it then fails at erroringSearcher with 500, as in
// TestSendMessage_RecordsOneAPIv1UsageEvent). Expected outcomes written by
// hand from the spec.
func TestSendMessage_SelectedFilesNeedSelectSources(t *testing.T) {
	cases := []struct {
		name     string
		role     string
		flags    kbaccess.SourcePermissions
		body     string
		accepted bool
	}{
		{"viewer_flag_off_with_selection", kbaccess.RoleView, kbaccess.SourcePermissions{}, `{"message":"hallo","selectedFileIds":["f1"]}`, false},
		{"viewer_flag_on_with_selection", kbaccess.RoleView, kbaccess.SourcePermissions{ViewerSelectSources: true}, `{"message":"hallo","selectedFileIds":["f1"]}`, true},
		{"viewer_flag_off_without_selection", kbaccess.RoleView, kbaccess.SourcePermissions{}, `{"message":"hallo"}`, true},
		{"editor_flag_off_with_selection", kbaccess.RoleEdit, kbaccess.SourcePermissions{ViewerSelectSources: true}, `{"message":"hallo","selectedFileIds":["f1"]}`, false},
		{"editor_flag_on_with_selection", kbaccess.RoleEdit, kbaccess.SourcePermissions{EditorSelectSources: true}, `{"message":"hallo","selectedFileIds":["f1"]}`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &fakeUsageRecorder{}
			chatRow := makeChat("chat-1", "kb-1", "user-1")
			store := &creatingStore{mockStore: mockStore{chatRow: &chatRow}}
			h := publicapi.NewHandler(store, nil, erroringSearcher{})
			h.SetUsageRecorder(rec)

			req := httptest.NewRequest(http.MethodPost, "/api/v1/kb/kb-1/chat", strings.NewReader(tc.body))
			req.SetPathValue("id", "kb-1")
			ctx := auth.WithUser(req.Context(), &auth.Claims{ID: "user-1", Username: "u", Role: auth.RoleAPIUser})
			ctx = kbaccess.WithAccess(ctx, &kbaccess.KBAccessResult{
				KB: &kbaccess.KnowledgeBase{ID: "kb-1", Sources: tc.flags}, Role: tc.role,
			})
			rr := httptest.NewRecorder()
			h.SendMessage(rr, req.WithContext(ctx))

			events := len(rec.snapshot())
			if tc.accepted {
				if rr.Code == http.StatusForbidden || store.created != 1 || events != 1 {
					t.Fatalf("status %d, chats %d, events %d; want accepted with 1 chat and 1 event", rr.Code, store.created, events)
				}
				return
			}
			if rr.Code != http.StatusForbidden || store.created != 0 || events != 0 {
				t.Fatalf("status %d, chats %d, events %d; want 403 with nothing written", rr.Code, store.created, events)
			}
		})
	}
}

// TestListKBs_CarryCapabilities pins that GET /api/v1/kb carries the same
// capabilities object as the session list, resolved for the API key's owner
// (here an api-user, whose system role adds no rung: only its kb_members
// rows count).
//
// Oracle: expected capabilities written by hand from the spec per row —
// owner: everything; view member: exactly the viewer flags that are on;
// edit member with editor see/download on and select/citations off: exactly
// those two plus manage (role only). The
// response is decoded as raw JSON so a missing key fails.
func TestListKBs_CarryCapabilities(t *testing.T) {
	role := func(r string) *string { return &r }
	owner := makeKB("kb-own", "Own")
	owner.MyRole = role(kbaccess.RoleOwner)
	viewer := makeKB("kb-view", "Viewed")
	viewer.MyRole = role(kbaccess.RoleView)
	viewer.ViewerSeeSources, viewer.ViewerDownloadSources = true, true
	editor := makeKB("kb-edit", "Edited")
	editor.MyRole = role(kbaccess.RoleEdit)
	editor.EditorSeeSources, editor.EditorDownloadSources = true, true

	h := publicapi.NewHandler(&mockStore{kbs: []kb.KBRow{owner, viewer, editor}}, nil, nil)
	req := withUser(newRequest(http.MethodGet, "/api/v1/kb"), &auth.Claims{ID: "svc", Role: auth.RoleAPIUser})
	rr := httptest.NewRecorder()
	h.ListKBs(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d", rr.Code)
	}
	var rows []map[string]json.RawMessage
	if err := json.Unmarshal(rr.Body.Bytes(), &rows); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := []kbaccess.Capabilities{
		{SeeSources: true, SelectSources: true, DownloadSources: true, SeeCitations: true, ManageSources: true},
		{SeeSources: true, DownloadSources: true},
		{SeeSources: true, DownloadSources: true, ManageSources: true},
	}
	if len(rows) != len(want) {
		t.Fatalf("rows %d, want %d", len(rows), len(want))
	}
	for i, row := range rows {
		raw, ok := row["capabilities"]
		if !ok {
			t.Fatalf("row %d has no capabilities key", i)
		}
		var got kbaccess.Capabilities
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatalf("row %d: %v", i, err)
		}
		if got != want[i] {
			t.Errorf("row %d: %+v, want %+v", i, got, want[i])
		}
	}
}
