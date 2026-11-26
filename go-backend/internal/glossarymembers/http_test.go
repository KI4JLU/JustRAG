package glossarymembers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/glossaryaccess"
)

// Valid UUIDs: the handlers parse user ids from the path and the body.
const (
	uOwner    = "00000000-0000-4000-8000-000000000001"
	uAnna     = "00000000-0000-4000-8000-000000000002"
	uBen      = "00000000-0000-4000-8000-000000000003"
	uNobody   = "00000000-0000-4000-8000-000000000004"
	uStranger = "00000000-0000-4000-8000-000000000005"
)

// noGate is passed to call for a request that did not pass the access gate.
var noGate = &glossaryaccess.Access{}

// memStore is an in-memory Store: members by user id, accounts by username.
type memStore struct {
	members  map[string]string // userID -> role
	accounts map[string]string // username -> userID
	pending  map[string]string // username -> role
	links    map[string]LinkTarget
	redeemed int
}

func newMemStore() *memStore {
	return &memStore{
		members:  map[string]string{uOwner: glossaryaccess.RoleOwner},
		accounts: map[string]string{"anna": uAnna, "ben": uBen, "owner": uOwner},
		pending:  map[string]string{},
		links:    map[string]LinkTarget{},
	}
}

func (m *memStore) ListMembers(context.Context, string) ([]Member, error) { return nil, nil }
func (m *memStore) GetRole(_ context.Context, _, userID string) (string, error) {
	if r, ok := m.members[userID]; ok {
		return r, nil
	}
	return "", ErrNotFound
}
func (m *memStore) SetRole(_ context.Context, _, userID, role, _ string) error {
	if m.members[userID] == glossaryaccess.RoleOwner {
		return ErrOwnerImmutable
	}
	m.members[userID] = role
	return nil
}
func (m *memStore) AddMember(_ context.Context, _, userID, role, _ string) (bool, error) {
	if _, ok := m.members[userID]; ok {
		return false, nil
	}
	m.members[userID] = role
	return true, nil
}
func (m *memStore) RemoveMember(_ context.Context, _, userID string) error {
	switch m.members[userID] {
	case "":
		return ErrNotFound
	case glossaryaccess.RoleOwner:
		return ErrOwnerImmutable
	}
	delete(m.members, userID)
	return nil
}
func (m *memStore) Leave(ctx context.Context, g, userID string) error {
	return m.RemoveMember(ctx, g, userID)
}
func (m *memStore) TransferOwner(_ context.Context, _, actingUserID, newOwnerID string) error {
	if m.members[actingUserID] != glossaryaccess.RoleOwner {
		return ErrNotOwner
	}
	m.members[actingUserID] = glossaryaccess.RoleAdmin
	m.members[newOwnerID] = glossaryaccess.RoleOwner
	return nil
}
func (m *memStore) UserIDByUsername(_ context.Context, username string) (string, bool, error) {
	id, ok := m.accounts[strings.ToLower(username)]
	return id, ok, nil
}
func (m *memStore) UpsertPendingInvite(_ context.Context, _, username, role, _ string) error {
	m.pending[username] = role
	return nil
}
func (m *memStore) ListPendingInvites(context.Context, string) ([]PendingInvite, error) {
	return nil, nil
}
func (m *memStore) RemovePendingInvite(_ context.Context, _, username string) error {
	if _, ok := m.pending[username]; !ok {
		return ErrNotFound
	}
	delete(m.pending, username)
	return nil
}
func (m *memStore) CreateLink(context.Context, string, string, string, *string, string) (Link, error) {
	return Link{ID: "l1"}, nil
}
func (m *memStore) ListLinks(context.Context, string) ([]Link, error) { return nil, nil }
func (m *memStore) RevokeLink(context.Context, string, string) error  { return nil }
func (m *memStore) ResolveLink(_ context.Context, token, userID string) (LinkTarget, error) {
	t, ok := m.links[token]
	if !ok {
		return LinkTarget{}, ErrNotFound
	}
	t.MemberRole = m.members[userID]
	return t, nil
}
func (m *memStore) RedeemLink(_ context.Context, token, userID string) (RedeemResult, error) {
	t := m.links[token]
	m.members[userID] = t.LinkRole
	m.redeemed++
	return RedeemResult{LinkID: t.LinkID, GlossaryID: t.GlossaryID, Role: t.LinkRole}, nil
}

// gateOf is what RequireGlossaryRole stores for a request on glossary g1.
func gateOf(role string) *glossaryaccess.Access {
	return &glossaryaccess.Access{Glossary: &glossaryaccess.Glossary{ID: "g1"}, Role: role}
}

func call(t *testing.T, h http.HandlerFunc, method, body string, userID string, access *glossaryaccess.Access, path map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, "/x", strings.NewReader(body))
	ctx := req.Context()
	if userID != "" {
		ctx = auth.WithUser(ctx, &auth.Claims{ID: userID, Role: "user"})
	}
	switch access {
	case nil:
		ctx = glossaryaccess.WithAccess(ctx, gateOf(glossaryaccess.RoleAdmin))
	case noGate: // reached without the gate: nothing in the context
	default:
		ctx = glossaryaccess.WithAccess(ctx, access)
	}
	req = req.WithContext(ctx)
	for k, v := range path {
		req.SetPathValue(k, v)
	}
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

func TestBulkAdd(t *testing.T) {
	st := newMemStore()
	st.members[uBen] = glossaryaccess.RoleViewer // Ben is a member already
	h := NewHandler(st)

	rec := call(t, h.BulkAdd, http.MethodPost,
		`{"usernames":[" Anna ","ben","ANNA","carla",""],"role":"editor"}`, uOwner, nil, map[string]string{"id": "g1"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	var got BulkAddResult
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if strings.Join(got.Shared, ",") != "anna" || strings.Join(got.AlreadyHadAccess, ",") != "ben" || strings.Join(got.Pending, ",") != "carla" {
		t.Errorf("result = %+v", got)
	}
	if st.members[uAnna] != glossaryaccess.RoleEditor {
		t.Errorf("anna role = %q, want editor", st.members[uAnna])
	}
	if st.members[uBen] != glossaryaccess.RoleViewer {
		t.Errorf("an existing member must stay unchanged, got %q", st.members[uBen])
	}
	if st.pending["carla"] != glossaryaccess.RoleEditor {
		t.Errorf("carla must be parked as pending editor, got %q", st.pending["carla"])
	}
}

func TestBulkAddRejects(t *testing.T) {
	tooMany := make([]string, MaxBulkUsernames+1)
	for i := range tooMany {
		tooMany[i] = "user" + strings.Repeat("x", i%7) + string(rune('a'+i%26)) + strings.Repeat("y", i/26)
	}
	many, _ := json.Marshal(map[string]any{"usernames": tooMany, "role": "viewer"})
	tests := []struct{ name, body string }{
		{"owner role", `{"usernames":["anna"],"role":"owner"}`},
		{"unknown role", `{"usernames":["anna"],"role":"view"}`},
		{"no usernames", `{"usernames":[" ",""],"role":"viewer"}`},
		{"not json", `nope`},
		{"too many", string(many)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			st := newMemStore()
			rec := call(t, NewHandler(st).BulkAdd, http.MethodPost, tc.body, uOwner, nil, map[string]string{"id": "g1"})
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", rec.Code)
			}
			if len(st.pending) != 0 || len(st.members) != 1 {
				t.Errorf("a refused request must not write: pending=%v members=%v", st.pending, st.members)
			}
		})
	}
}

func TestSetMemberRole(t *testing.T) {
	tests := []struct {
		name   string
		target string
		body   string
		want   int
	}{
		{"change role", uBen, `{"role":"admin"}`, http.StatusNoContent},
		{"owner is not assignable", uBen, `{"role":"owner"}`, http.StatusBadRequest},
		{"unknown member", uNobody, `{"role":"admin"}`, http.StatusNotFound},
		{"owner row is immutable", uOwner, `{"role":"viewer"}`, http.StatusConflict},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			st := newMemStore()
			st.members[uBen] = glossaryaccess.RoleViewer
			rec := call(t, NewHandler(st).SetMemberRole, http.MethodPut, tc.body, uOwner, nil,
				map[string]string{"id": "g1", "userId": tc.target})
			if rec.Code != tc.want {
				t.Errorf("status = %d, want %d (%s)", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}

func TestRemoveAndLeave(t *testing.T) {
	st := newMemStore()
	st.members[uBen] = glossaryaccess.RoleEditor
	h := NewHandler(st)

	if rec := call(t, h.RemoveMember, http.MethodDelete, "", uOwner, nil, map[string]string{"id": "g1", "userId": uOwner}); rec.Code != http.StatusConflict {
		t.Errorf("removing the owner: status = %d, want 409", rec.Code)
	}
	if rec := call(t, h.Leave, http.MethodDelete, "", uOwner, nil, map[string]string{"id": "g1"}); rec.Code != http.StatusConflict {
		t.Errorf("the owner leaving: status = %d, want 409", rec.Code)
	}
	if rec := call(t, h.Leave, http.MethodDelete, "", uBen, nil, map[string]string{"id": "g1"}); rec.Code != http.StatusNoContent {
		t.Errorf("a member leaving: status = %d, want 204", rec.Code)
	}
	if rec := call(t, h.Leave, http.MethodDelete, "", uBen, nil, map[string]string{"id": "g1"}); rec.Code != http.StatusNotFound {
		t.Errorf("leaving twice: status = %d, want 404", rec.Code)
	}
	if rec := call(t, h.RevokePendingInvite, http.MethodDelete, "", uOwner, nil, map[string]string{"id": "g1", "username": "nobody"}); rec.Code != http.StatusNotFound {
		t.Errorf("revoking a missing invite: status = %d, want 404", rec.Code)
	}
}

func TestTransferOwner(t *testing.T) {
	owner := gateOf(glossaryaccess.RoleOwner)
	admin := gateOf(glossaryaccess.RoleAdmin)
	tests := []struct {
		name   string
		access *glossaryaccess.Access
		body   string
		want   int
	}{
		{"owner transfers to a member", owner, `{"userId":"` + uBen + `"}`, http.StatusNoContent},
		{"admin may not", admin, `{"userId":"` + uBen + `"}`, http.StatusForbidden},
		{"no access in context", noGate, `{"userId":"` + uBen + `"}`, http.StatusForbidden},
		{"target must be a member", owner, `{"userId":"` + uStranger + `"}`, http.StatusBadRequest},
		{"already the owner", owner, `{"userId":"` + uOwner + `"}`, http.StatusBadRequest},
		{"bad body", owner, `{}`, http.StatusBadRequest},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			st := newMemStore()
			st.members[uBen] = glossaryaccess.RoleEditor
			rec := call(t, NewHandler(st).TransferOwner, http.MethodPost, tc.body, uOwner, tc.access, map[string]string{"id": "g1"})
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d (%s)", rec.Code, tc.want, rec.Body.String())
			}
			if tc.want == http.StatusNoContent {
				if st.members[uBen] != glossaryaccess.RoleOwner || st.members[uOwner] != glossaryaccess.RoleAdmin {
					t.Errorf("members after transfer = %v", st.members)
				}
			}
		})
	}
}

func TestLinksPreviewAndRedeem(t *testing.T) {
	st := newMemStore()
	st.links["live"] = LinkTarget{LinkID: "l1", GlossaryID: "g1", GlossaryName: "Fachbegriffe", Visibility: glossaryaccess.VisibilityPrivate, LinkRole: glossaryaccess.RoleEditor}
	st.links["dead"] = LinkTarget{LinkID: "l2", GlossaryID: "g1", GlossaryName: "Fachbegriffe", Visibility: glossaryaccess.VisibilityPrivate, LinkRole: glossaryaccess.RoleEditor, Revoked: true}
	st.links["globalviewer"] = LinkTarget{LinkID: "l3", GlossaryID: "g2", GlossaryName: "Offen", Visibility: glossaryaccess.VisibilityGlobal, LinkRole: glossaryaccess.RoleViewer}
	h := NewHandler(st)

	status := func(token, user string) (int, previewResponse) {
		rec := call(t, h.Preview, http.MethodGet, "", user, nil, map[string]string{"token": token})
		var p previewResponse
		_ = json.Unmarshal(rec.Body.Bytes(), &p)
		return rec.Code, p
	}
	if code, p := status("live", uAnna); code != 200 || p.Status != StatusInvite || p.LinkRole != "editor" {
		t.Errorf("live link for a stranger: %d %+v", code, p)
	}
	if code, p := status("dead", uAnna); code != 200 || p.Status != StatusRevoked || p.GlossaryID != "" || p.LinkRole != "" {
		t.Errorf("revoked link must expose the name only: %d %+v", code, p)
	}
	if _, p := status("globalviewer", uAnna); p.Status != StatusMember || p.Role != glossaryaccess.RoleViewer {
		t.Errorf("a viewer link on a global glossary changes nothing: %+v", p)
	}
	if code, _ := status("unknown", uAnna); code != http.StatusNotFound {
		t.Errorf("unknown token: %d, want 404", code)
	}

	redeem := func(token, user string) *httptest.ResponseRecorder {
		return call(t, h.Redeem, http.MethodPost, "", user, nil, map[string]string{"token": token})
	}
	if rec := redeem("dead", uAnna); rec.Code != http.StatusGone {
		t.Errorf("revoked link: %d, want 410", rec.Code)
	}
	if rec := redeem("live", uAnna); rec.Code != http.StatusOK || st.members[uAnna] != glossaryaccess.RoleEditor {
		t.Errorf("redeeming a live link: %d, members %v", rec.Code, st.members)
	}
	before := st.redeemed
	rec := redeem("live", uAnna)
	var res RedeemResult
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if rec.Code != http.StatusOK || !res.AlreadyMember || st.redeemed != before {
		t.Errorf("a member redeeming again must write nothing: %d %+v", rec.Code, res)
	}
	if rec := call(t, h.Redeem, http.MethodPost, "", "", nil, map[string]string{"token": "live"}); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous redeem: %d, want 401", rec.Code)
	}
}

func TestCreateLinkValidation(t *testing.T) {
	h := NewHandler(newMemStore())
	long := strings.Repeat("ä", MaxLabelLen+1)
	tests := []struct {
		name, body string
		want       int
	}{
		{"ok", `{"role":"viewer","label":"Kurs"}`, http.StatusCreated},
		{"ok with multibyte label at the limit", `{"role":"viewer","label":"` + strings.Repeat("ä", MaxLabelLen) + `"}`, http.StatusCreated},
		{"owner role", `{"role":"owner"}`, http.StatusBadRequest},
		{"label too long counts runes", `{"role":"viewer","label":"` + long + `"}`, http.StatusBadRequest},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := call(t, h.CreateLink, http.MethodPost, tc.body, uOwner, nil, map[string]string{"id": "g1"})
			if rec.Code != tc.want {
				t.Errorf("status = %d, want %d", rec.Code, tc.want)
			}
		})
	}
}

func TestNormalizeUsernames(t *testing.T) {
	got := normalizeUsernames([]string{" A ", "a", "B", "", "  ", "b ", "c"})
	if strings.Join(got, ",") != "a,b,c" {
		t.Errorf("normalizeUsernames = %v", got)
	}
}

// A request that did not pass the gate fails closed, and ids that are not
// UUIDs never reach the store.
func TestIdsAreParsedAndTheGateIsRequired(t *testing.T) {
	st := newMemStore()
	h := NewHandler(st)
	if rec := call(t, h.ListMembers, http.MethodGet, "", uOwner, noGate, map[string]string{"id": "g1"}); rec.Code != http.StatusInternalServerError {
		t.Errorf("without the gate: %d, want 500", rec.Code)
	}
	if rec := call(t, h.RemoveMember, http.MethodDelete, "", uOwner, nil, map[string]string{"id": "g1", "userId": "urn:not-a-uuid"}); rec.Code != http.StatusNotFound {
		t.Errorf("a malformed member id: %d, want 404", rec.Code)
	}
	if rec := call(t, h.SetMemberRole, http.MethodPut, `{"role":"viewer"}`, uOwner, nil, map[string]string{"id": "g1", "userId": "x"}); rec.Code != http.StatusNotFound {
		t.Errorf("a malformed member id on role change: %d, want 404", rec.Code)
	}
	if rec := call(t, h.RevokeLink, http.MethodDelete, "", uOwner, nil, map[string]string{"id": "g1", "linkId": "x"}); rec.Code != http.StatusNotFound {
		t.Errorf("a malformed link id: %d, want 404", rec.Code)
	}
	if rec := call(t, h.TransferOwner, http.MethodPost, `{"userId":"not-a-uuid"}`, uOwner, gateOf(glossaryaccess.RoleOwner), map[string]string{"id": "g1"}); rec.Code != http.StatusBadRequest {
		t.Errorf("a malformed transfer target: %d, want 400", rec.Code)
	}
}

// A transfer whose acting user lost the owner row to a concurrent transfer is a
// 409, and it changes nothing.
func TestTransferOwnerLosingTheRaceIsAConflict(t *testing.T) {
	st := newMemStore()
	st.members[uBen] = glossaryaccess.RoleEditor
	st.members[uAnna] = glossaryaccess.RoleEditor
	h := NewHandler(st)
	owner := gateOf(glossaryaccess.RoleOwner)
	path := map[string]string{"id": "g1"}

	if rec := call(t, h.TransferOwner, http.MethodPost, `{"userId":"`+uBen+`"}`, uOwner, owner, path); rec.Code != http.StatusNoContent {
		t.Fatalf("first transfer: %d", rec.Code)
	}
	// The second request passed the HTTP role check before the first one
	// committed (same gate result), but the store no longer finds the owner row.
	rec := call(t, h.TransferOwner, http.MethodPost, `{"userId":"`+uAnna+`"}`, uOwner, owner, path)
	if rec.Code != http.StatusConflict {
		t.Fatalf("second transfer: %d, want 409 (%s)", rec.Code, rec.Body.String())
	}
	if st.members[uBen] != glossaryaccess.RoleOwner || st.members[uAnna] != glossaryaccess.RoleEditor || st.members[uOwner] != glossaryaccess.RoleAdmin {
		t.Errorf("the new owner was demoted or the loser promoted: %v", st.members)
	}
}

func TestTransferOwnerNeedsAUser(t *testing.T) {
	rec := call(t, NewHandler(newMemStore()).TransferOwner, http.MethodPost, `{"userId":"`+uBen+`"}`, "", gateOf(glossaryaccess.RoleOwner), map[string]string{"id": "g1"})
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("without a user: %d, want 401", rec.Code)
	}
}

// Every JSON handler bounds its own read: a body over 1 MiB is a 413, not a
// 400 and not an unbounded read.
func TestJSONBodiesAreCapped(t *testing.T) {
	st := newMemStore()
	st.members[uBen] = glossaryaccess.RoleEditor
	h := NewHandler(st)
	big := `{"role":"viewer","label":"` + strings.Repeat("x", MaxJSONBodyBytes) + `"}`
	owner := gateOf(glossaryaccess.RoleOwner)
	tests := []struct {
		name string
		h    http.HandlerFunc
		path map[string]string
	}{
		{"set role", h.SetMemberRole, map[string]string{"id": "g1", "userId": uBen}},
		{"bulk add", h.BulkAdd, map[string]string{"id": "g1"}},
		{"transfer", h.TransferOwner, map[string]string{"id": "g1"}},
		{"create link", h.CreateLink, map[string]string{"id": "g1"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := call(t, tc.h, http.MethodPost, big, uOwner, owner, tc.path)
			if rec.Code != http.StatusRequestEntityTooLarge {
				t.Errorf("status = %d, want 413 (%s)", rec.Code, rec.Body.String())
			}
		})
	}
	// A body just under the cap still decodes.
	ok := `{"role":"viewer","label":"` + strings.Repeat("y", 200) + `"}`
	if rec := call(t, h.CreateLink, http.MethodPost, ok, uOwner, owner, map[string]string{"id": "g1"}); rec.Code != http.StatusBadRequest {
		t.Errorf("an over-long label is still the label's own 400: %d", rec.Code)
	}
}
