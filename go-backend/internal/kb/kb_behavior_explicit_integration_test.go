//go:build integration

// Integration test for migration 0100 (every KB gets an explicit behavior, no
// empty legacy role). The cases run in a transaction that is rolled back, so
// the shared knowledge_bases table is left as it was. Skipped when DB_* env is
// unset.

package kb_test

import (
	"context"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/kbbehavior"
	mainmigrations "github.com/justrag/go-backend/migrations/main"
)

func up0100(t *testing.T) string {
	t.Helper()
	raw, err := mainmigrations.FS.ReadFile("0100_kb_behavior_explicit.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	end := strings.Index(sql, "-- +goose Down")
	if end < 0 {
		t.Fatal("0100 has no -- +goose Down marker")
	}
	return sql[:end]
}

// Oracle: kbbehavior.SystemPrompt read before and after — a KB with a
// pre-roles prompt answers byte for byte as before, now as its own role
// „Eigene Rolle"; a KB without one answers in the default role before and
// after; an empty legacy role goes and the default role takes over, while a
// legacy role its author named, gave rules or put on the start page stays.
// A second run changes nothing.
func TestKBBehaviorExplicit_Migration(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	insert := func(name string, systemPrompt *string, behavior, startPage string) string {
		t.Helper()
		var id string
		if err := tx.QueryRow(ctx, `INSERT INTO knowledge_bases (name, system_prompt, behavior, start_page)
			VALUES ($1, $2, NULLIF($3, '')::jsonb, NULLIF($4, '')::jsonb) RETURNING id::text`,
			name, systemPrompt, behavior, startPage).Scan(&id); err != nil {
			t.Fatalf("insert %s: %v", name, err)
		}
		return id
	}
	legacyPrompt := "Du bist X.\n\n  Antworte kurz.  \n"
	emptyLegacy := `{"version":1,"activeRoleId":"legacy","customRoles":[{"id":"legacy"},{"id":"c-1","name":"Eigene","prompt":"P"}],"roleRules":{}}`
	kbs := map[string]string{
		"null with prompt":   insert("m-null-prompt", &legacyPrompt, "", ""),
		"null without":       insert("m-null-none", nil, "", ""),
		"empty legacy":       insert("m-empty-legacy", nil, emptyLegacy, ""),
		"named legacy":       insert("m-named-legacy", nil, `{"version":1,"activeRoleId":"legacy","customRoles":[{"id":"legacy","name":"Kanzlei"}],"roleRules":{}}`, ""),
		"legacy with rules":  insert("m-rules-legacy", nil, `{"version":1,"activeRoleId":"legacy","customRoles":[{"id":"legacy"}],"roleRules":{"legacy":{"rules":{"pages":true},"customRules":[]}}}`, ""),
		"legacy on the page": insert("m-page-legacy", nil, emptyLegacy, `{"version":1,"roleEntries":[{"id":"re-1","roleId":"legacy"}]}`),
		"legacy with prompt": insert("m-prompt-legacy", &legacyPrompt, `{"version":1,"activeRoleId":"legacy","customRoles":[{"id":"legacy"}],"roleRules":{}}`, ""),
	}
	read := func() map[string]string {
		out := map[string]string{}
		for name, id := range kbs {
			p, err := kbbehavior.SystemPrompt(ctx, tx, id, "")
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			out[name] = ""
			if p != nil {
				out[name] = *p
			}
		}
		return out
	}
	before := read()

	if _, err := tx.Exec(ctx, up0100(t)); err != nil {
		t.Fatalf("0100: %v", err)
	}
	after := read()
	var nulls int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM knowledge_bases WHERE behavior IS NULL`).Scan(&nulls); err != nil || nulls != 0 {
		t.Fatalf("KBs still without a behavior: %d (%v)", nulls, err)
	}

	defaultPrompt, _ := kbbehavior.Compile(kbbehavior.Default(), "", "de")
	defaultPrompt = kbbehavior.DefaultNames().Resolve(defaultPrompt)
	for name, want := range map[string]string{
		"null with prompt":   legacyPrompt,
		"null without":       defaultPrompt,
		"empty legacy":       defaultPrompt,
		"legacy with prompt": legacyPrompt,
	} {
		if after[name] != want {
			t.Errorf("%s: answers %.60q, want %.60q", name, after[name], want)
		}
	}
	for _, name := range []string{"null with prompt", "null without", "named legacy", "legacy with rules", "legacy on the page", "legacy with prompt"} {
		if after[name] != before[name] {
			t.Errorf("%s: the answer prompt changed:\n%.80q\n%.80q", name, before[name], after[name])
		}
	}
	if before["empty legacy"] == defaultPrompt {
		t.Error("oracle: before the migration the empty legacy role must not answer in the default role")
	}

	st := kbbehavior.NewStore(tx)
	s, err := st.Load(ctx, kbs["null with prompt"])
	if err != nil {
		t.Fatal(err)
	}
	if !s.Customized || s.Behavior.ActiveRoleID != kbbehavior.LegacyRoleID ||
		s.Behavior.CustomRoles[0].Name != "Eigene Rolle" || s.Behavior.CustomRoles[0].Prompt != legacyPrompt {
		t.Errorf("null with prompt = %+v", s)
	}
	s, err = st.Load(ctx, kbs["empty legacy"])
	if err != nil {
		t.Fatal(err)
	}
	if s.Behavior.ActiveRoleID != kbbehavior.DefaultRoleID() || len(s.Behavior.CustomRoles) != 1 || s.Behavior.CustomRoles[0].ID != "c-1" {
		t.Errorf("empty legacy = %+v, want the default role active and only c-1", s.Behavior)
	}
	for _, name := range []string{"named legacy", "legacy with rules", "legacy on the page"} {
		s, err := st.Load(ctx, kbs[name])
		if err != nil {
			t.Fatal(err)
		}
		if !s.Behavior.HasRole(kbbehavior.LegacyRoleID) {
			t.Errorf("%s: the legacy role must stay: %+v", name, s.Behavior)
		}
	}

	var snapshot string
	if err := tx.QueryRow(ctx, `SELECT string_agg(id::text || behavior::text, ',' ORDER BY id) FROM knowledge_bases`).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, up0100(t)); err != nil {
		t.Fatalf("0100 again: %v", err)
	}
	var again string
	if err := tx.QueryRow(ctx, `SELECT string_agg(id::text || behavior::text, ',' ORDER BY id) FROM knowledge_bases`).Scan(&again); err != nil {
		t.Fatal(err)
	}
	if again != snapshot {
		t.Error("a second run changed behaviors")
	}
}
