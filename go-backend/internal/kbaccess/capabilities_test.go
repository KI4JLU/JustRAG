package kbaccess_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/kbaccess"
)

// flagSets enumerates all 128 combinations of the seven source flags, so the
// matrix below never depends on a hand-picked subset.
func flagSets() []kbaccess.SourcePermissions {
	out := make([]kbaccess.SourcePermissions, 0, 128)
	for m := 0; m < 128; m++ {
		out = append(out, kbaccess.SourcePermissions{
			ViewerSeeSources:      m&1 != 0,
			ViewerDownloadSources: m&2 != 0,
			ViewerSeeCitations:    m&4 != 0,
			EditorSeeSources:      m&8 != 0,
			EditorAddSources:      m&16 != 0,
			EditorDownloadSources: m&32 != 0,
			EditorSeeCitations:    m&64 != 0,
		})
	}
	return out
}

// allFlags turns every source flag on.
var allFlags = kbaccess.SourcePermissions{
	ViewerSeeSources: true, ViewerDownloadSources: true, ViewerSeeCitations: true,
	EditorSeeSources: true, EditorAddSources: true, EditorDownloadSources: true,
	EditorSeeCitations: true,
}

// grant is one cell of the spec table: a capability is always granted,
// never granted, or follows the named flags.
type grant func(kbaccess.SourcePermissions) bool

func always(kbaccess.SourcePermissions) bool { return true }
func never(kbaccess.SourcePermissions) bool  { return false }

// specTable is the card's rule table, written out per role class and
// capability. It is the oracle for the flag part: it is a lookup table keyed
// by role class, deliberately not shaped like CapabilitiesFor's switch, and
// every cell is one sentence of the spec (Sten, 2026-10-16) —
//
//   - KB admin, owner, superadmin, system admin on a public KB: everything.
//   - Pyramid: seeSources and seeCitations are independent; download, add
//     and manage all require seeSources.
//   - edit: see/citations follow their editor_* flag; download and add
//     follow theirs AND editor_see_sources; manage ("edit sources", fixed
//     by role) is editor_see_sources.
//   - view: see/citations/download as for edit with the viewer_* flags;
//     never add and never manage, whatever the flags say ("viewers can
//     never add or delete sources — that would be a promotion to
//     editor").
//   - no access: nothing.
var specTable = map[string]map[kbaccess.Capability]grant{
	"full": {
		kbaccess.CapSeeSources: always, kbaccess.CapAddSources: always,
		kbaccess.CapDownloadSources: always, kbaccess.CapSeeCitations: always,
		kbaccess.CapManageSources: always,
	},
	"edit": {
		kbaccess.CapSeeSources:      func(p kbaccess.SourcePermissions) bool { return p.EditorSeeSources },
		kbaccess.CapAddSources:      func(p kbaccess.SourcePermissions) bool { return p.EditorSeeSources && p.EditorAddSources },
		kbaccess.CapDownloadSources: func(p kbaccess.SourcePermissions) bool { return p.EditorSeeSources && p.EditorDownloadSources },
		kbaccess.CapSeeCitations:    func(p kbaccess.SourcePermissions) bool { return p.EditorSeeCitations },
		kbaccess.CapManageSources:   func(p kbaccess.SourcePermissions) bool { return p.EditorSeeSources },
	},
	"view": {
		kbaccess.CapSeeSources:      func(p kbaccess.SourcePermissions) bool { return p.ViewerSeeSources },
		kbaccess.CapAddSources:      never,
		kbaccess.CapDownloadSources: func(p kbaccess.SourcePermissions) bool { return p.ViewerSeeSources && p.ViewerDownloadSources },
		kbaccess.CapSeeCitations:    func(p kbaccess.SourcePermissions) bool { return p.ViewerSeeCitations },
		kbaccess.CapManageSources:   never,
	},
	"none": {
		kbaccess.CapSeeSources: never, kbaccess.CapAddSources: never,
		kbaccess.CapDownloadSources: never, kbaccess.CapSeeCitations: never,
		kbaccess.CapManageSources: never,
	},
}

// roleClass maps a role resolved by the real EffectiveRole onto a specTable
// row. Written from the spec ("admin" means KB admin or better), not from
// CapabilitiesFor.
func roleClass(role string) string {
	switch role {
	case kbaccess.RoleOwner, kbaccess.RoleAdmin:
		return "full"
	case kbaccess.RoleEdit:
		return "edit"
	case kbaccess.RoleView:
		return "view"
	}
	return "none"
}

var allCaps = []kbaccess.Capability{
	kbaccess.CapSeeSources, kbaccess.CapAddSources, kbaccess.CapDownloadSources,
	kbaccess.CapSeeCitations, kbaccess.CapManageSources,
}

// TestCapabilitiesMatrix crosses every caller shape the ladder knows with all
// 128 combinations of the seven flags (17 callers x 128 = 2176 cases).
//
// Oracles: the role part is the real EffectiveRole — the test never states a
// caller's role itself, it asks the one ladder, so CapabilitiesFor is checked
// against the role the route gates actually see. The flag part is specTable,
// the spec's rule table. wantClass additionally pins, by hand, which class
// each caller must land in, so a ladder change that moved e.g. the api-user
// to admin turns this test red instead of silently changing the oracle.
func TestCapabilitiesMatrix(t *testing.T) {
	owner := "owner-1"
	callers := []struct {
		name        string
		sysRole     string
		memberRole  string
		isGlobal    bool
		isPublished bool
		wantClass   string
	}{
		{"owner_row", auth.RoleUser, kbaccess.RoleOwner, false, false, "full"},
		{"kb_admin_row", auth.RoleUser, kbaccess.RoleAdmin, false, false, "full"},
		{"kb_admin_row_on_public", auth.RoleUser, kbaccess.RoleAdmin, true, true, "full"},
		{"superadmin_no_row", auth.RoleSuperAdmin, "", false, false, "full"},
		{"sysadmin_on_public", auth.RoleAdmin, "", true, true, "full"},
		{"sysadmin_on_staged_public", auth.RoleAdmin, "", true, false, "full"},
		{"edit_row", auth.RoleUser, kbaccess.RoleEdit, false, false, "edit"},
		{"edit_row_on_public", auth.RoleUser, kbaccess.RoleEdit, true, true, "edit"},
		{"view_row", auth.RoleUser, kbaccess.RoleView, false, false, "view"},
		{"implicit_viewer_published_public", auth.RoleUser, "", true, true, "view"},
		// The api-user system role governs only use of the outgoing API and
		// has no rung of its own: on a published public KB it is an implicit
		// viewer whose capabilities follow the viewer flags, on a private KB
		// without a row it has nothing, and an explicit kb_members admin row
		// makes it a KB admin like anyone else.
		{"apiuser_on_published_public", auth.RoleAPIUser, "", true, true, "view"},
		{"apiuser_on_private_no_row", auth.RoleAPIUser, "", false, false, "none"},
		{"apiuser_on_staged_public", auth.RoleAPIUser, "", true, false, "none"},
		{"apiuser_with_kb_admin_row", auth.RoleAPIUser, kbaccess.RoleAdmin, false, false, "full"},
		// A system admin on a PRIVATE KB has no rung either.
		{"sysadmin_on_private_no_row", auth.RoleAdmin, "", false, false, "none"},
		{"stranger_private", auth.RoleUser, "", false, false, "none"},
		{"user_on_staged_public", auth.RoleUser, "", true, false, "none"},
	}
	for _, c := range callers {
		for _, flags := range flagSets() {
			kb := &kbaccess.KnowledgeBase{
				ID: kbID, UserID: &owner, IsGlobal: c.isGlobal, IsPublished: c.isPublished, Sources: flags,
			}
			role := kbaccess.EffectiveRole(kb, c.sysRole, c.memberRole) // oracle for the role
			class := roleClass(role)
			if class != c.wantClass {
				t.Fatalf("%s: EffectiveRole=%q is class %q, want %q", c.name, role, class, c.wantClass)
			}
			got := kbaccess.CapabilitiesFor(kb, role)
			for _, capability := range allCaps {
				want := specTable[class][capability](flags)
				if got.Has(capability) != want {
					t.Errorf("%s flags=%+v: %s = %v, want %v", c.name, flags, capability, got.Has(capability), want)
				}
			}
			// The KBAccessResult accessor is the same decision.
			if res := (&kbaccess.KBAccessResult{KB: kb, Role: role}).Capabilities(); res != got {
				t.Errorf("%s flags=%+v: KBAccessResult.Capabilities()=%+v, CapabilitiesFor=%+v", c.name, flags, res, got)
			}
		}
	}
}

// TestCapabilitiesFailClosed pins the nil and unknown cases: a nil KB, a nil
// access result, an unknown role and an unknown capability grant nothing.
// Oracle: the spec's "no access → nothing", written out.
func TestCapabilitiesFailClosed(t *testing.T) {
	all := allFlags
	if got := kbaccess.CapabilitiesFor(nil, kbaccess.RoleOwner); got != (kbaccess.Capabilities{}) {
		t.Errorf("nil KB: %+v", got)
	}
	if got := kbaccess.CapabilitiesFor(&kbaccess.KnowledgeBase{Sources: all}, "superuser"); got != (kbaccess.Capabilities{}) {
		t.Errorf("unknown role: %+v", got)
	}
	var nilAccess *kbaccess.KBAccessResult
	if got := nilAccess.Capabilities(); got != (kbaccess.Capabilities{}) {
		t.Errorf("nil access: %+v", got)
	}
	full := kbaccess.CapabilitiesFor(&kbaccess.KnowledgeBase{}, kbaccess.RoleOwner)
	if full.Has(kbaccess.Capability("deleteEverything")) {
		t.Error("unknown capability granted")
	}
	// The zero-value flags are the most restrictive setting, editors
	// included: a KnowledgeBase built without loading the flags fails closed
	// on every capability, manageSources too, since it requires seeSources.
	if got, want := kbaccess.CapabilitiesFor(&kbaccess.KnowledgeBase{}, kbaccess.RoleEdit),
		(kbaccess.Capabilities{}); got != want {
		t.Errorf("zero-value flags for an editor: %+v, want %+v", got, want)
	}
}

// TestRequireKBCapability drives the composed middleware (RequireKBRole then
// RequireCapability) for a viewer and an editor with the governing flag on
// and off, plus the role gate's own answers, which must survive unchanged.
//
// Oracle: status codes written by hand from the spec — viewers follow the
// viewer flags and editors the editor flags (the other role's flags never
// help); download, add and manage additionally need the role's seeSources
// flag (the pyramid); only edit and above pass the manage gate; a missing KB
// is 404 and a stranger 403, exactly as RequireKBRole answers them alone.
func TestRequireKBCapability(t *testing.T) {
	allViewer := kbaccess.SourcePermissions{ViewerSeeSources: true, ViewerDownloadSources: true, ViewerSeeCitations: true}
	allEditor := kbaccess.SourcePermissions{EditorSeeSources: true, EditorAddSources: true, EditorDownloadSources: true, EditorSeeCitations: true}
	cases := []struct {
		name       string
		required   string
		capability kbaccess.Capability
		memberRole string
		flags      kbaccess.SourcePermissions
		kbMissing  bool
		want       int
	}{
		{"viewer_see_off", kbaccess.RoleView, kbaccess.CapSeeSources, kbaccess.RoleView, kbaccess.SourcePermissions{}, false, 403},
		{"viewer_see_on", kbaccess.RoleView, kbaccess.CapSeeSources, kbaccess.RoleView, kbaccess.SourcePermissions{ViewerSeeSources: true}, false, 200},
		{"viewer_see_only_editor_flag", kbaccess.RoleView, kbaccess.CapSeeSources, kbaccess.RoleView, allEditor, false, 403},
		{"editor_see_off_viewer_flags_on", kbaccess.RoleView, kbaccess.CapSeeSources, kbaccess.RoleEdit, allViewer, false, 403},
		{"editor_see_on", kbaccess.RoleView, kbaccess.CapSeeSources, kbaccess.RoleEdit, kbaccess.SourcePermissions{EditorSeeSources: true}, false, 200},
		{"viewer_download_off", kbaccess.RoleView, kbaccess.CapDownloadSources, kbaccess.RoleView, kbaccess.SourcePermissions{ViewerSeeSources: true}, false, 403},
		{"viewer_download_on", kbaccess.RoleView, kbaccess.CapDownloadSources, kbaccess.RoleView, kbaccess.SourcePermissions{ViewerSeeSources: true, ViewerDownloadSources: true}, false, 200},
		{"viewer_download_on_see_off", kbaccess.RoleView, kbaccess.CapDownloadSources, kbaccess.RoleView, kbaccess.SourcePermissions{ViewerDownloadSources: true}, false, 403},
		{"editor_download_off", kbaccess.RoleView, kbaccess.CapDownloadSources, kbaccess.RoleEdit, allViewer, false, 403},
		{"editor_download_on", kbaccess.RoleView, kbaccess.CapDownloadSources, kbaccess.RoleEdit, kbaccess.SourcePermissions{EditorSeeSources: true, EditorDownloadSources: true}, false, 200},
		{"editor_download_on_see_off", kbaccess.RoleView, kbaccess.CapDownloadSources, kbaccess.RoleEdit, kbaccess.SourcePermissions{EditorDownloadSources: true}, false, 403},
		{"viewer_manage_all_flags_on", kbaccess.RoleEdit, kbaccess.CapManageSources, kbaccess.RoleView, allFlags, false, 403},
		// Adding: an editor follows editor_add_sources (plus see); a viewer
		// never adds, even with every flag on, and the editor flags never
		// help a viewer.
		{"viewer_add_all_flags_on", kbaccess.RoleEdit, kbaccess.CapAddSources, kbaccess.RoleView, allFlags, false, 403},
		{"editor_add_off", kbaccess.RoleEdit, kbaccess.CapAddSources, kbaccess.RoleEdit, allViewer, false, 403},
		{"editor_add_on", kbaccess.RoleEdit, kbaccess.CapAddSources, kbaccess.RoleEdit, kbaccess.SourcePermissions{EditorSeeSources: true, EditorAddSources: true}, false, 200},
		{"editor_add_on_see_off", kbaccess.RoleEdit, kbaccess.CapAddSources, kbaccess.RoleEdit, kbaccess.SourcePermissions{EditorAddSources: true}, false, 403},
		{"kb_admin_add_no_flags", kbaccess.RoleEdit, kbaccess.CapAddSources, kbaccess.RoleAdmin, kbaccess.SourcePermissions{}, false, 200},
		{"stranger_add_on", kbaccess.RoleEdit, kbaccess.CapAddSources, "", allFlags, false, 403},
		{"editor_manage_see_on", kbaccess.RoleEdit, kbaccess.CapManageSources, kbaccess.RoleEdit, kbaccess.SourcePermissions{EditorSeeSources: true}, false, 200},
		{"editor_manage_see_off_add_on", kbaccess.RoleEdit, kbaccess.CapManageSources, kbaccess.RoleEdit, kbaccess.SourcePermissions{EditorAddSources: true, EditorDownloadSources: true}, false, 403},
		{"kb_admin_see_no_flags", kbaccess.RoleView, kbaccess.CapSeeSources, kbaccess.RoleAdmin, kbaccess.SourcePermissions{}, false, 200},
		{"kb_admin_manage_no_flags", kbaccess.RoleEdit, kbaccess.CapManageSources, kbaccess.RoleAdmin, kbaccess.SourcePermissions{}, false, 200},
		{"stranger_see_on", kbaccess.RoleView, kbaccess.CapSeeSources, "", allViewer, false, 403},
		{"kb_missing", kbaccess.RoleView, kbaccess.CapSeeSources, kbaccess.RoleView, allViewer, true, 404},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &mockStore{role: tc.memberRole}
			if !tc.kbMissing {
				store.kb = &kbaccess.KnowledgeBase{ID: kbID, Sources: tc.flags}
			}
			mw := kbaccess.NewMiddleware(store)
			called := false
			h := mw.RequireKBCapability(tc.required, tc.capability)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				called = true
				w.WriteHeader(http.StatusOK)
			}))
			req := httptest.NewRequest(http.MethodGet, "/api/kb/"+kbID+"/files", nil)
			req.SetPathValue("id", kbID)
			req = req.WithContext(claimsCtx(req.Context(), auth.Claims{ID: userID, Role: auth.RoleUser}))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status %d, want %d", rec.Code, tc.want)
			}
			if called != (tc.want == http.StatusOK) {
				t.Fatalf("handler called = %v with status %d", called, rec.Code)
			}
		})
	}
}

// TestRequireCapabilityWithoutAccessIs500 pins the wiring-bug answer: the
// capability gate mounted without RequireKBRole in front must not let the
// request through. Oracle: the handler-called flag.
func TestRequireCapabilityWithoutAccessIs500(t *testing.T) {
	called := false
	h := kbaccess.RequireCapability(kbaccess.CapSeeSources)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusInternalServerError || called {
		t.Fatalf("status %d, handler called %v; want 500 and not called", rec.Code, called)
	}
}

// TestCapabilityPyramid pins the dependency cases of the pyramid by name,
// as whole Capabilities values, so a regression reads as a sentence of the
// spec rather than as one cell of the 2176-case matrix.
//
// Oracle: the expected values are written by hand from the spec — level 2
// (download, add, manage) needs seeSources; seeCitations is independent of
// it; a viewer never adds and never manages.
func TestCapabilityPyramid(t *testing.T) {
	cases := []struct {
		name  string
		role  string
		flags kbaccess.SourcePermissions
		want  kbaccess.Capabilities
	}{
		{"editor_add_on_see_off", kbaccess.RoleEdit,
			kbaccess.SourcePermissions{EditorAddSources: true, EditorDownloadSources: true},
			kbaccess.Capabilities{}},
		{"editor_see_on_only", kbaccess.RoleEdit,
			kbaccess.SourcePermissions{EditorSeeSources: true},
			kbaccess.Capabilities{SeeSources: true, ManageSources: true}},
		{"editor_citations_without_see", kbaccess.RoleEdit,
			kbaccess.SourcePermissions{EditorSeeCitations: true, EditorAddSources: true},
			kbaccess.Capabilities{SeeCitations: true}},
		{"viewer_download_on_see_off", kbaccess.RoleView,
			kbaccess.SourcePermissions{ViewerDownloadSources: true, EditorSeeSources: true, EditorAddSources: true},
			kbaccess.Capabilities{}},
		{"viewer_every_flag_on_never_adds", kbaccess.RoleView,
			allFlags,
			kbaccess.Capabilities{SeeSources: true, DownloadSources: true, SeeCitations: true}},
		{"viewer_citations_without_see", kbaccess.RoleView,
			kbaccess.SourcePermissions{ViewerSeeCitations: true},
			kbaccess.Capabilities{SeeCitations: true}},
		{"kb_admin_no_flags", kbaccess.RoleAdmin,
			kbaccess.SourcePermissions{},
			kbaccess.Capabilities{SeeSources: true, AddSources: true, DownloadSources: true, SeeCitations: true, ManageSources: true}},
	}
	for _, tc := range cases {
		if got := kbaccess.CapabilitiesFor(&kbaccess.KnowledgeBase{ID: kbID, Sources: tc.flags}, tc.role); got != tc.want {
			t.Errorf("%s: %+v, want %+v", tc.name, got, tc.want)
		}
	}
}
