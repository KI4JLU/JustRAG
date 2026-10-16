package kb_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/kb"
	"github.com/justrag/go-backend/internal/kbaccess"
)

var (
	capsAll  = kbaccess.Capabilities{SeeSources: true, SelectSources: true, DownloadSources: true, SeeCitations: true, ManageSources: true}
	capsNone = kbaccess.Capabilities{}
)

// decodeCaps reads the capabilities object off one KB in a JSON response.
// It decodes the raw JSON rather than the Go struct, so a missing key is a
// failure, not a zero value.
func decodeCaps(t *testing.T, raw json.RawMessage) kbaccess.Capabilities {
	t.Helper()
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		t.Fatalf("decode kb: %v", err)
	}
	c, ok := obj["capabilities"]
	if !ok {
		t.Fatalf("response has no capabilities key: %s", raw)
	}
	var caps kbaccess.Capabilities
	if err := json.Unmarshal(c, &caps); err != nil {
		t.Fatalf("decode capabilities: %v", err)
	}
	return caps
}

// TestListKnowledgeBases_CarryResolvedCapabilities pins that both list
// routes resolve the caller's capabilities per row, including the implicit
// viewer whose myRole is null — the case the UI cannot derive itself.
//
// Oracle: expected capabilities written by hand from the spec for each
// (caller, row) — owner: everything; implicit viewer on a published public
// KB: exactly the viewer flags that are on; system admin on the same KB:
// everything; editor with only editor_see_sources and editor_select_sources
// on: those two plus manageSources (role only).
func TestListKnowledgeBases_CarryResolvedCapabilities(t *testing.T) {
	owner := makeKB("kb-own", "Mine")
	owner.MyRole = strp(kbaccess.RoleOwner)

	public := makeKB("kb-pub", "Public")
	public.IsGlobal, public.IsPublished = true, true
	public.ViewerSeeSources, public.ViewerSeeCitations = true, true
	// Editor flags on, so an implicit viewer that read them would be caught.
	public.EditorSeeSources, public.EditorSelectSources = true, true
	public.EditorDownloadSources, public.EditorSeeCitations = true, true

	editor := makeKB("kb-edit", "Shared")
	editor.MyRole = strp(kbaccess.RoleEdit)
	editor.EditorSeeSources, editor.EditorSelectSources = true, true
	// Viewer flags on, so an editor that read them would be caught.
	editor.ViewerDownloadSources, editor.ViewerSeeCitations = true, true

	cases := []struct {
		name   string
		list   func(*kb.Handler) http.HandlerFunc
		caller *auth.Claims
		rows   []kb.KBRow
		want   []kbaccess.Capabilities
	}{
		{"private_list_user", func(h *kb.Handler) http.HandlerFunc { return h.ListKnowledgeBases }, testUser(),
			[]kb.KBRow{owner, editor},
			[]kbaccess.Capabilities{capsAll, {SeeSources: true, SelectSources: true, ManageSources: true}}},
		{"global_list_implicit_viewer", func(h *kb.Handler) http.HandlerFunc { return h.ListGlobalKnowledgeBases }, testUser(),
			[]kb.KBRow{public},
			[]kbaccess.Capabilities{{SeeSources: true, SeeCitations: true}}},
		{"global_list_api_user_is_viewer", func(h *kb.Handler) http.HandlerFunc { return h.ListGlobalKnowledgeBases },
			&auth.Claims{ID: "svc", Role: auth.RoleAPIUser},
			[]kb.KBRow{public},
			[]kbaccess.Capabilities{{SeeSources: true, SeeCitations: true}}},
		{"global_list_system_admin", func(h *kb.Handler) http.HandlerFunc { return h.ListGlobalKnowledgeBases }, adminUser(),
			[]kb.KBRow{public},
			[]kbaccess.Capabilities{capsAll}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := kb.NewHandler(&mockStore{kbs: tc.rows})
			req := withUser(httptest.NewRequest(http.MethodGet, "/api/kb", nil), tc.caller)
			rr := httptest.NewRecorder()
			tc.list(h)(rr, req)
			if rr.Code != http.StatusOK {
				t.Fatalf("status %d", rr.Code)
			}
			var raws []json.RawMessage
			if err := json.Unmarshal(rr.Body.Bytes(), &raws); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if len(raws) != len(tc.want) {
				t.Fatalf("rows %d, want %d", len(raws), len(tc.want))
			}
			for i, raw := range raws {
				if got := decodeCaps(t, raw); got != tc.want[i] {
					t.Errorf("row %d: capabilities %+v, want %+v", i, got, tc.want[i])
				}
			}
		})
	}
}

// TestGetAndCreateKnowledgeBase_CarryCapabilities: the detail route resolves
// like the lists (an implicit viewer with every viewer flag off gets
// nothing), and a freshly created KB reports the creator's owner
// capabilities even though the RETURNING row has no myRole.
// Oracle: hand-written expectations from the spec.
func TestGetAndCreateKnowledgeBase_CarryCapabilities(t *testing.T) {
	public := makeKB("kb-pub", "Public")
	public.IsGlobal, public.IsPublished = true, true
	h := kb.NewHandler(&mockStore{kb: &public})

	req := withUser(httptest.NewRequest(http.MethodGet, "/api/kb/kb-pub", nil), testUser())
	req.SetPathValue("id", "kb-pub")
	rr := httptest.NewRecorder()
	h.GetKnowledgeBase(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("get: status %d", rr.Code)
	}
	if got := decodeCaps(t, rr.Body.Bytes()); got != capsNone {
		t.Errorf("implicit viewer, all flags off: %+v, want none", got)
	}

	created := makeKB("kb-new", "New")
	h = kb.NewHandler(&mockStore{kb: &created})
	req = withUser(newRequest(http.MethodPost, "/api/kb", map[string]string{"name": "New"}), testUser())
	rr = httptest.NewRecorder()
	h.CreateKnowledgeBase(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create: status %d", rr.Code)
	}
	if got := decodeCaps(t, rr.Body.Bytes()); got != capsAll {
		t.Errorf("creator: %+v, want every capability", got)
	}
}

// TestUpdateKB_SourcePermissionFields pins the PATCH surface: the eight flag
// fields reach the store exactly as sent (absent → nil, i.e. unchanged), and
// the response's capabilities are resolved from the RE-READ row, not from
// the request's KBAccessResult, whose flags this very PATCH may have changed.
//
// Oracle: the KBUpdate the mock store captured, compared to the request
// body by hand; and capabilities derived by hand from the re-read row (an
// editor whose editor_see_sources was just switched off loses seeSources,
// although the stale access result still had it on).
func TestUpdateKB_SourcePermissionFields(t *testing.T) {
	reread := makeKBRow("kb-1", "KB")
	reread.MyRole = strp(kbaccess.RoleEdit)
	reread.ViewerSeeSources = true
	reread.EditorSelectSources, reread.EditorDownloadSources, reread.EditorSeeCitations = true, true, true
	store := &mockUpdateStore{kb: makeKBRow("kb-1", "KB"), reread: reread}
	h := kb.NewUpdateHandler(store, nil)

	body := []byte(`{"viewerSeeSources":true,"editorSeeSources":false,"editorSeeCitations":true,"viewerSeeCitations":null}`)
	r := httptest.NewRequest(http.MethodPatch, "/api/kb/kb-1", bytes.NewReader(body))
	staleKB := &kbaccess.KnowledgeBase{ID: "kb-1", Sources: kbaccess.SourcePermissions{EditorSeeSources: true}}
	r = injectKBAccessAs(r, staleKB, kbaccess.RoleAdmin, auth.RoleUser)
	rr := httptest.NewRecorder()
	h.UpdateKB(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}

	u := store.gotUpdate
	if u.ViewerSeeSources == nil || !*u.ViewerSeeSources {
		t.Errorf("viewerSeeSources = %v, want true", u.ViewerSeeSources)
	}
	if u.EditorSeeSources == nil || *u.EditorSeeSources {
		t.Errorf("editorSeeSources = %v, want false", u.EditorSeeSources)
	}
	if u.EditorSeeCitations == nil || !*u.EditorSeeCitations {
		t.Errorf("editorSeeCitations = %v, want true", u.EditorSeeCitations)
	}
	for name, f := range map[string]*bool{
		"viewerSeeCitations": u.ViewerSeeCitations, "viewerSelectSources": u.ViewerSelectSources,
		"viewerDownloadSources": u.ViewerDownloadSources, "editorSelectSources": u.EditorSelectSources,
		"editorDownloadSources": u.EditorDownloadSources,
	} {
		if f != nil {
			t.Errorf("absent/null flag %s must stay nil, got %v", name, *f)
		}
	}

	want := kbaccess.Capabilities{SelectSources: true, DownloadSources: true, SeeCitations: true, ManageSources: true}
	if got := decodeCaps(t, rr.Body.Bytes()); got != want {
		t.Errorf("capabilities %+v, want %+v (resolved from the re-read row)", got, want)
	}
	var obj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &obj)
	if obj["editorSeeSources"] != false || obj["viewerSeeSources"] != true || obj["editorSelectSources"] != true {
		t.Errorf("flag fields in response: editorSeeSources=%v viewerSeeSources=%v editorSelectSources=%v",
			obj["editorSeeSources"], obj["viewerSeeSources"], obj["editorSelectSources"])
	}
	if _, ok := obj["editorManageSources"]; ok {
		t.Error("response still carries editorManageSources")
	}
}
