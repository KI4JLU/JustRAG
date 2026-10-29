//go:build integration

// Integration tests for the role templates („Vorlagen" › Rollen, migration
// 0095, internal/kbbehavior) against a live schema: seeding, the admin
// writes and their guards, and that a write reaches this process's catalog.
// The table is shared with the running app, so the tests only add their own
// templates and put the default back. Skipped when DB_* env is unset.

package kb_test

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/kbbehavior"
)

func TestRoleTemplates_AdminWrites(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	st := kbbehavior.NewTemplateStore(pool)
	if err := st.Seed(ctx); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := st.Seed(ctx); err != nil {
		t.Fatalf("second seed must be a no-op: %v", err)
	}
	before, err := st.List(ctx)
	if err != nil || len(before) == 0 {
		t.Fatalf("list after seed = %d, %v", len(before), err)
	}
	var oldDefault kbbehavior.AdminTemplate
	for _, r := range before {
		if r.IsDefault {
			oldDefault = r
		}
	}
	if oldDefault.ID == "" {
		t.Fatal("no default template after seeding")
	}

	in := kbbehavior.TemplateInput{
		Icon: "sparkles", Enabled: true,
		Name: kbbehavior.Texts{DE: "IT-Testrolle"}, Prompt: kbbehavior.Texts{DE: "Du testest."},
		Cover: kbbehavior.Cover{From: "#112233", To: "#445566"},
	}
	id, err := st.Create(ctx, in)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() {
		if oldDefault.ID != "" {
			_ = st.Update(context.Background(), oldDefault.ID, oldDefault.TemplateInput)
		}
		pool.Exec(context.Background(), `DELETE FROM role_templates WHERE id = $1`, id) //nolint:errcheck
		_ = st.Refresh(context.Background())
	})

	// The write reaches this process's catalog at once; English falls back to German.
	cat := kbbehavior.CatalogFor("en")
	i := slices.IndexFunc(cat.Roles, func(r kbbehavior.CatalogRole) bool { return r.ID == id })
	if i < 0 || cat.Roles[i].Name != "IT-Testrolle" || cat.Roles[i].Cover.From != "#112233" || !cat.Roles[i].Enabled {
		t.Fatalf("catalog after create = %+v", cat.Roles)
	}

	// Making it the default takes that from the previous one; the default
	// cannot be disabled, deleted or give the default up on its own.
	in.IsDefault = true
	if err := st.Update(ctx, id, in); err != nil {
		t.Fatalf("make default: %v", err)
	}
	if kbbehavior.DefaultRoleID() != id {
		t.Errorf("DefaultRoleID = %q, want %q", kbbehavior.DefaultRoleID(), id)
	}
	in.IsDefault = false
	if err := st.Update(ctx, id, in); !errors.Is(err, kbbehavior.ErrInvalid) {
		t.Errorf("dropping the default must be refused, got %v", err)
	}
	if err := st.Delete(ctx, id); !errors.Is(err, kbbehavior.ErrInvalid) {
		t.Errorf("deleting the default must be refused, got %v", err)
	}
	if err := st.Update(ctx, oldDefault.ID, oldDefault.TemplateInput); err != nil {
		t.Fatalf("restore default: %v", err)
	}

	// A template a KB uses cannot be deleted, only disabled; disabled it still
	// resolves for that KB.
	var kbID string
	if err := pool.QueryRow(ctx, `INSERT INTO knowledge_bases (name, behavior)
		VALUES ('kb-templates-it', jsonb_build_object('version', 1, 'activeRoleId', $1::text,
			'customRoles', '[]'::jsonb, 'rules', '{}'::jsonb, 'customRules', '[]'::jsonb)) RETURNING id::text`, id).Scan(&kbID); err != nil {
		t.Fatalf("seed kb: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM knowledge_bases WHERE id = $1::uuid`, kbID) //nolint:errcheck
	})
	if err := st.Delete(ctx, id); !errors.Is(err, kbbehavior.ErrTemplateInUse) {
		t.Errorf("deleting a used template must be refused, got %v", err)
	}
	in.Enabled = false
	if err := st.Update(ctx, id, in); err != nil {
		t.Fatalf("disable: %v", err)
	}
	list, _ := st.List(ctx)
	j := slices.IndexFunc(list, func(r kbbehavior.AdminTemplate) bool { return r.ID == id })
	if j < 0 || list[j].Enabled || list[j].UsedBy != 1 {
		t.Errorf("listed after disabling = %+v", list[j])
	}
	if p, _ := kbbehavior.Compile(kbbehavior.Behavior{ActiveRoleID: id}, "", "de"); !strings.HasPrefix(p, "Du testest.\n\nRegeln:") {
		t.Errorf("a disabled template must still compile for its KB, got %q", p)
	}

	// The order must name every template once.
	if err := st.Reorder(ctx, []string{id}); !errors.Is(err, kbbehavior.ErrInvalid) {
		t.Errorf("a partial order must be refused, got %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM knowledge_bases WHERE id = $1::uuid`, kbID); err != nil {
		t.Fatal(err)
	}
	if err := st.Delete(ctx, id); err != nil {
		t.Errorf("deleting an unused template: %v", err)
	}
}
