package kbaccess_test

import (
	"context"
	"errors"
	"testing"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/kbaccess"
)

type failingStore struct{}

func (failingStore) GetKBByID(context.Context, string) (*kbaccess.KnowledgeBase, error) {
	return nil, errors.New("db down")
}
func (failingStore) GetKBRole(context.Context, string, string) (string, error) { return "", nil }

// ResolveCapabilities is EffectiveRole + CapabilitiesFor over the store's
// rows. Oracle: the seeCitations value the flag table in API.md states for
// each role (view follows viewer_see_citations, admin always, no role
// nothing), not a call to the code under test.
func TestResolveCapabilities(t *testing.T) {
	flagOn := kbaccess.SourcePermissions{ViewerSeeCitations: true}
	cases := []struct {
		name    string
		store   kbaccess.KBStore
		sysRole string
		want    bool
	}{
		{"view member, flag off", &mockStore{kb: &kbaccess.KnowledgeBase{ID: "kb"}, role: kbaccess.RoleView}, auth.RoleUser, false},
		{"view member, flag on", &mockStore{kb: &kbaccess.KnowledgeBase{ID: "kb", Sources: flagOn}, role: kbaccess.RoleView}, auth.RoleUser, true},
		{"kb admin, flags off", &mockStore{kb: &kbaccess.KnowledgeBase{ID: "kb"}, role: kbaccess.RoleAdmin}, auth.RoleUser, true},
		{"superadmin, no row", &mockStore{kb: &kbaccess.KnowledgeBase{ID: "kb"}}, auth.RoleSuperAdmin, true},
		{"no role on a private kb", &mockStore{kb: &kbaccess.KnowledgeBase{ID: "kb", Sources: flagOn}}, auth.RoleUser, false},
		{"missing kb", &mockStore{}, auth.RoleUser, false},
	}
	for _, c := range cases {
		caps, err := kbaccess.ResolveCapabilities(context.Background(), c.store, "kb", "u1", c.sysRole)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if caps.SeeCitations != c.want {
			t.Errorf("%s: seeCitations = %v, want %v", c.name, caps.SeeCitations, c.want)
		}
	}
	if _, err := kbaccess.ResolveCapabilities(context.Background(), failingStore{}, "kb", "u1", auth.RoleUser); err == nil {
		t.Error("store error: want an error")
	}
}
