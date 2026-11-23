package kbinvites_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/kbinvites"
)

type mockStore struct {
	links        []kbinvites.Link
	created      *kbinvites.Link
	createRole   string
	createLabel  *string
	revokeErr    error
	revokeCall   bool
	revokeKBID   string
	revokeLinkID string
	target       kbinvites.LinkTarget
	resolveErr   error
	redeem       kbinvites.RedeemResult
	redeemErr    error
	redeemCall   bool
	detailsCall  bool
}

func (m *mockStore) List(context.Context, string) ([]kbinvites.Link, error) {
	return m.links, nil
}

func (m *mockStore) Create(_ context.Context, kbID, token, role string, label *string, _ string) (kbinvites.Link, error) {
	m.createRole, m.createLabel = role, label
	l := kbinvites.Link{ID: "link-1", KBID: kbID, Token: token, Role: role, Label: label}
	m.created = &l
	return l, nil
}

func (m *mockStore) Revoke(_ context.Context, kbID, linkID string) error {
	m.revokeCall = true
	m.revokeKBID, m.revokeLinkID = kbID, linkID
	return m.revokeErr
}

func (m *mockStore) Resolve(context.Context, string, string) (kbinvites.LinkTarget, error) {
	return m.target, m.resolveErr
}

func (m *mockStore) Details(context.Context, string) (kbinvites.TopicDetails, error) {
	m.detailsCall = true
	return kbinvites.TopicDetails{FileCount: 36, RoleName: "Assistent"}, nil
}

func (m *mockStore) Redeem(context.Context, string, string) (kbinvites.RedeemResult, error) {
	m.redeemCall = true
	return m.redeem, m.redeemErr
}

var _ kbinvites.Store = (*mockStore)(nil)

type nopAudit struct{}

func (nopAudit) LogAuditAction(context.Context, string, string, string, string, any) error {
	return nil
}

// withUser puts an authenticated user into the request context the way the
// auth middleware does. auth.WithUser takes *auth.Claims (see
// internal/kbmembers/http_test.go:128 for the same call).
func withUser(r *http.Request, id string) *http.Request {
	return withSysRole(r, id, "user")
}

func withSysRole(r *http.Request, id, sysRole string) *http.Request {
	return r.WithContext(auth.WithUser(r.Context(), &auth.Claims{ID: id, Role: sysRole}))
}

func TestCreateLinkRejectsOwnerRole(t *testing.T) {
	store := &mockStore{}
	h := kbinvites.NewHandler(store, nopAudit{})

	req := httptest.NewRequest(http.MethodPost, "/api/kb/kb-1/invite-links",
		bytes.NewBufferString(`{"role":"owner"}`))
	req.SetPathValue("id", "kb-1")
	rec := httptest.NewRecorder()
	h.CreateLink(rec, withUser(req, "u-1"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if store.created != nil {
		t.Fatal("a link was created for role=owner")
	}
}

func TestCreateLinkRejectsOverlongLabel(t *testing.T) {
	store := &mockStore{}
	h := kbinvites.NewHandler(store, nopAudit{})

	body, _ := json.Marshal(map[string]string{
		"role":  "view",
		"label": strings.Repeat("x", kbinvites.MaxLabelLen+1),
	})
	req := httptest.NewRequest(http.MethodPost, "/api/kb/kb-1/invite-links", bytes.NewBuffer(body))
	req.SetPathValue("id", "kb-1")
	rec := httptest.NewRecorder()
	h.CreateLink(rec, withUser(req, "u-1"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if store.created != nil {
		t.Fatal("a link was created with an overlong label")
	}
}

func TestCreateLinkMintsToken(t *testing.T) {
	store := &mockStore{}
	h := kbinvites.NewHandler(store, nopAudit{})

	req := httptest.NewRequest(http.MethodPost, "/api/kb/kb-1/invite-links",
		bytes.NewBufferString(`{"role":"edit","label":"WS26"}`))
	req.SetPathValue("id", "kb-1")
	rec := httptest.NewRecorder()
	h.CreateLink(rec, withUser(req, "u-1"))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rec.Code)
	}
	var got kbinvites.Link
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Token) != 43 {
		t.Fatalf("token %q has length %d, want 43", got.Token, len(got.Token))
	}
	if store.createRole != "edit" {
		t.Fatalf("store got role %q, want edit", store.createRole)
	}
}

func TestDeleteLinkNotFound(t *testing.T) {
	store := &mockStore{revokeErr: kbinvites.ErrNotFound}
	h := kbinvites.NewHandler(store, nopAudit{})

	req := httptest.NewRequest(http.MethodDelete, "/api/kb/kb-1/invite-links/link-9", nil)
	req.SetPathValue("id", "kb-1")
	req.SetPathValue("linkId", "link-9")
	rec := httptest.NewRecorder()
	h.DeleteLink(rec, withUser(req, "u-1"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestRedeemUnknownTokenIs404(t *testing.T) {
	store := &mockStore{resolveErr: kbinvites.ErrNotFound}
	h := kbinvites.NewHandler(store, nopAudit{})

	rec := httptest.NewRecorder()
	h.Redeem(rec, redeemRequest("u-1", "user"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if store.redeemCall {
		t.Fatal("store.Redeem was called for an unknown token")
	}
}

func redeemRequest(userID, sysRole string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/invites/tok/redeem", nil)
	req.SetPathValue("token", "tok")
	return withSysRole(req, userID, sysRole)
}

func previewRequest(userID, sysRole string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/api/invites/tok", nil)
	req.SetPathValue("token", "tok")
	return withSysRole(req, userID, sysRole)
}

// privateKB is a link target on a private KB the caller has no row on.
func privateKB(linkRole string) kbinvites.LinkTarget {
	desc := "Worum es geht"
	return kbinvites.LinkTarget{
		LinkID: "link-1", LinkRole: linkRole, KBID: "kb-1", KBName: "Kurs", Description: &desc,
	}
}

// Oracle: the outcome table the product decision fixes (members never change
// through a link; a revoked link resolves but never joins), with the access
// arm checked against kbaccess.EffectiveRole's documented rules.
func TestPreviewStatus(t *testing.T) {
	publicPublished := func(linkRole string) kbinvites.LinkTarget {
		tg := privateKB(linkRole)
		tg.IsGlobal, tg.IsPublished = true, true
		return tg
	}
	tests := []struct {
		name       string
		target     func() kbinvites.LinkTarget
		sysRole    string
		wantStatus string
		wantRole   string
		wantDesc   bool
	}{
		{"new invitee", func() kbinvites.LinkTarget { return privateKB("edit") }, "user", "invite", "", true},
		{"member with a lower role than the link stays a member", func() kbinvites.LinkTarget {
			tg := privateKB("admin")
			tg.MemberRole = "view"
			return tg
		}, "user", "member", "view", true},
		{"member with a higher role", func() kbinvites.LinkTarget {
			tg := privateKB("view")
			tg.MemberRole = "edit"
			return tg
		}, "user", "member", "edit", true},
		{"revoked link, member", func() kbinvites.LinkTarget {
			tg := privateKB("view")
			tg.MemberRole, tg.Revoked = "view", true
			return tg
		}, "user", "member", "view", true},
		{"revoked link, outsider sees only the name", func() kbinvites.LinkTarget {
			tg := privateKB("view")
			tg.Revoked = true
			return tg
		}, "user", "revoked", "", false},
		{"published public KB, view link: implicit access suffices", func() kbinvites.LinkTarget {
			return publicPublished("view")
		}, "user", "member", "view", true},
		{"published public KB, edit link: still an invitation", func() kbinvites.LinkTarget {
			return publicPublished("edit")
		}, "user", "invite", "view", true},
		{"published public KB, revoked edit link: can still open", func() kbinvites.LinkTarget {
			tg := publicPublished("edit")
			tg.Revoked = true
			return tg
		}, "user", "revoked", "view", true},
		{"system admin on a public KB never gets a shadowing row", func() kbinvites.LinkTarget {
			tg := privateKB("admin")
			tg.IsGlobal = true
			return tg
		}, "admin", "member", "admin", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := kbinvites.NewHandler(&mockStore{target: tt.target()}, nopAudit{})
			rec := httptest.NewRecorder()
			h.Preview(rec, previewRequest("u-1", tt.sysRole))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			var got struct {
				Status      string  `json:"status"`
				Role        string  `json:"role"`
				Description *string `json:"description"`
				RoleName    *string `json:"roleName"`
			}
			if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if got.Status != tt.wantStatus || got.Role != tt.wantRole {
				t.Fatalf("got status %q role %q, want %q %q", got.Status, got.Role, tt.wantStatus, tt.wantRole)
			}
			if (got.Description != nil) != tt.wantDesc {
				t.Fatalf("description present = %v, want %v", got.Description != nil, tt.wantDesc)
			}
			// The topic details travel with the description, never without it.
			if (got.RoleName != nil) != tt.wantDesc {
				t.Fatalf("details present = %v, want %v", got.RoleName != nil, tt.wantDesc)
			}
		})
	}
}

// A revoked link tells an outsider which invitation ended and nothing else.
// Oracle: the product rule — the KB's name only; its id, the granted role,
// the favorite and overview state and every title-card detail stay out.
func TestPreviewRevokedOutsiderShape(t *testing.T) {
	tg := privateKB("admin")
	tg.Revoked, tg.IsFavorite, tg.InOverview = true, true, true
	h := kbinvites.NewHandler(&mockStore{target: tg}, nopAudit{})
	rec := httptest.NewRecorder()
	h.Preview(rec, previewRequest("u-1", "user"))

	var got map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := map[string]any{"status": "revoked", "kbName": "Kurs", "role": "", "isFavorite": false, "inOverview": false, "canSubscribe": false}
	if len(got) != len(want) {
		t.Fatalf("body = %v, want exactly %v", got, want)
	}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("body[%q] = %v, want %v (body %v)", k, got[k], v, got)
		}
	}
}

func TestPreviewUnknownTokenIs404(t *testing.T) {
	h := kbinvites.NewHandler(&mockStore{resolveErr: kbinvites.ErrNotFound}, nopAudit{})
	rec := httptest.NewRecorder()
	h.Preview(rec, previewRequest("u-1", "user"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestRedeemJoinsNewInvitee(t *testing.T) {
	store := &mockStore{
		target: privateKB("edit"),
		redeem: kbinvites.RedeemResult{LinkID: "link-1", KBID: "kb-1", KBName: "Kurs", Role: "edit"},
	}
	h := kbinvites.NewHandler(store, nopAudit{})

	rec := httptest.NewRecorder()
	h.Redeem(rec, redeemRequest("u-1", "user"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !store.redeemCall {
		t.Fatal("store.Redeem was not called for a new invitee")
	}
	var got kbinvites.RedeemResult
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.KBID != "kb-1" || got.Role != "edit" || got.AlreadyMember {
		t.Fatalf("body = %+v, want kb-1/edit/new member", got)
	}
}

// A member redeeming any link, even one with a higher role, writes nothing.
func TestRedeemMemberWritesNothing(t *testing.T) {
	tg := privateKB("admin")
	tg.MemberRole = "view"
	store := &mockStore{target: tg}
	h := kbinvites.NewHandler(store, nopAudit{})

	rec := httptest.NewRecorder()
	h.Redeem(rec, redeemRequest("u-1", "user"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if store.redeemCall {
		t.Fatal("store.Redeem was called for an existing member")
	}
	var got kbinvites.RedeemResult
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !got.AlreadyMember || got.Role != "view" {
		t.Fatalf("body = %+v, want alreadyMember with the unchanged role view", got)
	}
}

func TestRedeemRevokedIs410(t *testing.T) {
	revoked := privateKB("view")
	revoked.Revoked = true
	tests := []struct {
		name  string
		store *mockStore
	}{
		{"revoked before the request", &mockStore{target: revoked}},
		{"revoked while joining", &mockStore{target: privateKB("view"), redeemErr: kbinvites.ErrRevoked}},
		{"revoked, caller already a member", &mockStore{target: func() kbinvites.LinkTarget {
			tg := revoked
			tg.MemberRole = "view"
			return tg
		}()}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := kbinvites.NewHandler(tt.store, nopAudit{})
			rec := httptest.NewRecorder()
			h.Redeem(rec, redeemRequest("u-1", "user"))

			if rec.Code != http.StatusGone {
				t.Fatalf("status = %d, want 410", rec.Code)
			}
			if !strings.Contains(rec.Body.String(), `"invite_revoked"`) {
				t.Fatalf("body = %s, want code invite_revoked", rec.Body.String())
			}
		})
	}
}

func TestListLinksReturnsEmptyArrayNotNull(t *testing.T) {
	store := &mockStore{} // links is nil
	h := kbinvites.NewHandler(store, nopAudit{})

	req := httptest.NewRequest(http.MethodGet, "/api/kb/kb-1/invite-links", nil)
	req.SetPathValue("id", "kb-1")
	rec := httptest.NewRecorder()
	h.ListLinks(rec, withUser(req, "u-1"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	// Assert on the raw bytes: json.Marshal(nil slice) produces "null", and
	// decoding into a Go slice would hide that (both null and [] decode to a
	// nil/empty slice), so this must inspect the wire body, not a decoded
	// struct.
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	linksRaw, ok := raw["links"]
	if !ok {
		t.Fatal(`response has no "links" field`)
	}
	if string(linksRaw) != "[]" {
		t.Fatalf(`raw "links" value = %s, want []`, linksRaw)
	}
}

func TestListLinksReturnsExistingLinks(t *testing.T) {
	label := "WS26"
	store := &mockStore{links: []kbinvites.Link{
		{ID: "link-1", KBID: "kb-1", Token: "tok-1", Role: "edit", Label: &label},
		{ID: "link-2", KBID: "kb-1", Token: "tok-2", Role: "view"},
	}}
	h := kbinvites.NewHandler(store, nopAudit{})

	req := httptest.NewRequest(http.MethodGet, "/api/kb/kb-1/invite-links", nil)
	req.SetPathValue("id", "kb-1")
	rec := httptest.NewRecorder()
	h.ListLinks(rec, withUser(req, "u-1"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got struct {
		Links []kbinvites.Link `json:"links"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Links) != 2 {
		t.Fatalf("got %d links, want 2", len(got.Links))
	}
	if got.Links[0].ID != "link-1" || got.Links[0].Role != "edit" || got.Links[0].Label == nil || *got.Links[0].Label != "WS26" {
		t.Fatalf("links[0] = %+v, want link-1/edit/WS26", got.Links[0])
	}
	if got.Links[1].ID != "link-2" || got.Links[1].Role != "view" {
		t.Fatalf("links[1] = %+v, want link-2/view", got.Links[1])
	}
}

func TestDeleteLinkSucceeds(t *testing.T) {
	store := &mockStore{}
	h := kbinvites.NewHandler(store, nopAudit{})

	req := httptest.NewRequest(http.MethodDelete, "/api/kb/kb-1/invite-links/link-9", nil)
	req.SetPathValue("id", "kb-1")
	req.SetPathValue("linkId", "link-9")
	rec := httptest.NewRecorder()
	h.DeleteLink(rec, withUser(req, "u-1"))

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("body = %q, want empty", rec.Body.String())
	}
	if !store.revokeCall {
		t.Fatal("store.Revoke was never called")
	}
	if store.revokeKBID != "kb-1" || store.revokeLinkID != "link-9" {
		t.Fatalf("store.Revoke called with (%q, %q), want (kb-1, link-9)", store.revokeKBID, store.revokeLinkID)
	}
}

func TestCreateLinkAcceptsLabelAtMaxLen(t *testing.T) {
	store := &mockStore{}
	h := kbinvites.NewHandler(store, nopAudit{})

	// Multi-byte runes: 100 "ä" is 100 runes but 200 bytes, so this also
	// pins the rune-vs-byte counting behaviour — byte counting would reject
	// this label even though it's exactly at the rune cap.
	label := strings.Repeat("ä", kbinvites.MaxLabelLen)
	body, _ := json.Marshal(map[string]string{
		"role":  "view",
		"label": label,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/kb/kb-1/invite-links", bytes.NewBuffer(body))
	req.SetPathValue("id", "kb-1")
	rec := httptest.NewRecorder()
	h.CreateLink(rec, withUser(req, "u-1"))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rec.Code)
	}
	if store.created == nil {
		t.Fatal("no link was created for a label at exactly MaxLabelLen runes")
	}
	if store.createLabel == nil || *store.createLabel != label {
		t.Fatalf("store got label %v, want the full %d-rune label", store.createLabel, kbinvites.MaxLabelLen)
	}
}
