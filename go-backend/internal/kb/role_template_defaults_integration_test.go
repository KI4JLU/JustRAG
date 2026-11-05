//go:build integration

// Integration tests for migration 0100 (the default role templates, and only
// these): what a fresh install gets, and what an install the old Go seed
// filled ends up with — its other templates deleted, whatever used them
// falling back to chat.
// The upgrade cases run in a transaction that is rolled back, so the shared
// role_templates table is left as it was. Skipped when DB_* env is unset.

package kb_test

import (
	"context"
	"maps"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/justrag/go-backend/internal/kbbehavior"
	"github.com/justrag/go-backend/internal/kbstartpage"
	mainmigrations "github.com/justrag/go-backend/migrations/main"
)

// Oracle: kbbehavior.BuiltinTemplates — the rows migration 0100 writes on a
// freshly migrated database are the code's built-in templates, field for
// field and in that order, chat the default.
func TestRoleTemplateDefaults_FreshInstallIsTheBuiltinSet(t *testing.T) {
	pool := testPool(t)
	all, err := kbbehavior.NewTemplateStore(pool).List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := kbbehavior.BuiltinTemplates()
	ids := make([]string, 0, len(want))
	for _, w := range want {
		ids = append(ids, w.ID)
	}
	var got []kbbehavior.AdminTemplate
	for _, r := range all {
		if slices.Contains(ids, r.ID) {
			r.UsedBy = 0
			got = append(got, r)
		}
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("migrated templates differ from builtinRoles:\n got %+v\nwant %+v", got, want)
	}
	if !want[0].IsDefault || want[0].ID != "chat" {
		t.Fatalf("chat must be the first template and the default: %+v", want[0])
	}
}

// up0100 is migration 0100's Up section.
func up0100(t *testing.T) string {
	t.Helper()
	raw, err := mainmigrations.FS.ReadFile("0100_role_template_defaults.sql")
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

type templateRow struct {
	position         int
	isDefault, off   bool
	nameDE, promptDE string
	promptEN         string
	startKind        *string
}

func templateRows(t *testing.T, tx pgx.Tx) map[string]templateRow {
	t.Helper()
	rows, err := tx.Query(context.Background(),
		`SELECT id, position, is_default, disabled, name_de, prompt_de, prompt_en, start->>'kind' FROM role_templates`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]templateRow{}
	for rows.Next() {
		var (
			id string
			r  templateRow
		)
		if err := rows.Scan(&id, &r.position, &r.isDefault, &r.off, &r.nameDE, &r.promptDE, &r.promptEN, &r.startKind); err != nil {
			t.Fatal(err)
		}
		out[id] = r
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// seedOld0095 puts role_templates back to what the old Go seed wrote, inside tx.
func seedOld0095(t *testing.T, tx pgx.Tx) {
	t.Helper()
	seed, err := os.ReadFile("testdata/role_templates_0095_seed.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{`DELETE FROM role_templates`, string(seed)} {
		if _, err := tx.Exec(context.Background(), stmt); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
}

// upgrade puts role_templates back to what the old Go seed wrote, applies
// edit (an admin's change), runs 0100 twice and returns the rows after the
// first and the second run. Everything is rolled back.
func upgrade(t *testing.T, edit string) (first, second map[string]templateRow) {
	t.Helper()
	pool := testPool(t)
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	seedOld0095(t, tx)
	if edit != "" {
		if _, err := tx.Exec(ctx, edit); err != nil {
			t.Fatalf("edit: %v", err)
		}
	}
	if _, err := tx.Exec(ctx, up0100(t)); err != nil {
		t.Fatalf("0100: %v", err)
	}
	first = templateRows(t, tx)
	if _, err := tx.Exec(ctx, up0100(t)); err != nil {
		t.Fatalf("0100 again: %v", err)
	}
	return first, templateRows(t, tx)
}

func builtin(t *testing.T, id string) kbbehavior.AdminTemplate {
	t.Helper()
	for _, b := range kbbehavior.BuiltinTemplates() {
		if b.ID == id {
			return b
		}
	}
	t.Fatalf("no built-in template %q", id)
	return kbbehavior.AdminTemplate{}
}

var retiredTemplates = []string{"research", "tutor", "admin", "editor"}

func wantOrder(t *testing.T, got map[string]templateRow, order ...string) {
	t.Helper()
	if len(got) != len(order) {
		t.Errorf("templates %v, want exactly %v", slices.Sorted(maps.Keys(got)), order)
	}
	for i, id := range order {
		if r, ok := got[id]; !ok || r.position != i {
			t.Errorf("%s at position %d (present %v), want %d", id, r.position, ok, i)
		}
	}
}

// Oracle: developer ruling 04.11.2026 — a deployment offers the four
// standard templates and an admin's own, nothing else. Unedited shipped
// templates take the new texts, an edited one keeps its texts but gets the
// new start while it has none, the other templates 0095 seeded are deleted
// (edited or not), chat takes the default from research and comes first, and
// a second run changes nothing.
func TestRoleTemplateDefaults_UpgradeKeepsAdminEdits(t *testing.T) {
	got, again := upgrade(t, `UPDATE role_templates SET name_de = 'Support' WHERE id = 'it';
		UPDATE role_templates SET prompt_de = 'Eigener Text' WHERE id = 'tutor';
		INSERT INTO role_templates (id, position, icon, is_default, disabled, name_de, name_en, description_de, description_en, prompt_de, prompt_en, cover_from, cover_to)
		VALUES ('t-0123abcd', 9, 'sparkles', false, false, 'Eigene', 'Own', 'd', 'd', 'P', 'P', '#000000', '#000000')`)
	if !reflect.DeepEqual(got, again) {
		t.Fatalf("a second run changed the rows:\n%+v\n%+v", got, again)
	}

	chat := got["chat"]
	if !chat.isDefault || chat.off || chat.promptDE != builtin(t, "chat").Prompt.DE {
		t.Errorf("chat = %+v", chat)
	}
	for _, id := range []string{"summary", "filecheck"} {
		b := builtin(t, id)
		if r := got[id]; r.nameDE != b.Name.DE || r.promptDE != b.Prompt.DE || r.promptEN != b.Prompt.EN || r.off {
			t.Errorf("%s not updated: %+v", id, r)
		}
	}
	if k := got["filecheck"].startKind; k == nil || *k != "file" {
		t.Errorf("filecheck start = %v, want a file start", k)
	}
	if k := got["summary"].startKind; k == nil || *k != "task" {
		t.Errorf("summary start = %v, want the task start", k)
	}
	it := got["it"]
	if it.nameDE != "Support" || !strings.HasPrefix(it.promptDE, "Du bist der IT-Support des Hochschulrechenzentrums.") || it.off {
		t.Errorf("an edited template must keep its texts: %+v", it)
	}
	if it.startKind == nil || *it.startKind != "task" {
		t.Errorf("it start = %v, want the task start", it.startKind)
	}
	for _, id := range retiredTemplates {
		if _, ok := got[id]; ok {
			t.Errorf("%s must be deleted", id)
		}
	}
	wantOrder(t, got, "chat", "summary", "filecheck", "it", "t-0123abcd")
}

// Oracle: a default an admin chose among the kept templates stays the
// default and comes first; a default that was deleted passes to chat.
func TestRoleTemplateDefaults_UpgradeKeepsAChosenDefault(t *testing.T) {
	got, _ := upgrade(t, `UPDATE role_templates SET is_default = false WHERE id = 'research';
		UPDATE role_templates SET is_default = true WHERE id = 'summary'`)
	if got["chat"].isDefault || !got["summary"].isDefault {
		t.Fatalf("chat %+v, summary %+v", got["chat"], got["summary"])
	}
	wantOrder(t, got, "summary", "chat", "filecheck", "it")

	got, _ = upgrade(t, `UPDATE role_templates SET is_default = false WHERE id = 'research';
		UPDATE role_templates SET is_default = true WHERE id = 'tutor'`)
	if !got["chat"].isDefault {
		t.Fatalf("the deleted default must pass to chat: %+v", got)
	}
	wantOrder(t, got, "chat", "summary", "filecheck", "it")
}

// Oracle: developer ruling 04.11.2026 — a topic answering in a deleted
// template answers in chat, a chat started in one too; a start page card of
// one is gone on read (kbstartpage.Effective), leaving the active role's own
// start, and the topic still compiles.
func TestRoleTemplateDefaults_DeletedTemplatesFallBackToChat(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	seedOld0095(t, tx)

	kb := func(name, behavior, startPage string) string {
		t.Helper()
		var id string
		if err := tx.QueryRow(ctx, `INSERT INTO knowledge_bases (name, behavior, start_page)
			VALUES ($1, $2::jsonb, NULLIF($3, '')::jsonb) RETURNING id::text`, name, behavior, startPage).Scan(&id); err != nil {
			t.Fatalf("insert %s: %v", name, err)
		}
		return id
	}
	research := kb("fb-research", `{"version":1,"activeRoleId":"research","customRoles":[],"roleRules":{}}`, "")
	summary := kb("fb-summary", `{"version":1,"activeRoleId":"summary","customRoles":[],"roleRules":{}}`,
		`{"version":1,"startMode":"roles","roleEntries":[{"id":"re-1","roleId":"tutor"}],"roleStarts":{"tutor":{"kind":"task","text":"Hi","send":true}}}`)
	var userID, chatID string
	if err := tx.QueryRow(ctx, `INSERT INTO users (username, password_hash, role) VALUES ('fb-user', 'x', 'user') RETURNING id::text`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `INSERT INTO chats (user_id, kb_id, role_id) VALUES ($1::uuid, $2::uuid, 'admin') RETURNING id::text`, userID, summary).Scan(&chatID); err != nil {
		t.Fatal(err)
	}

	if _, err := tx.Exec(ctx, up0100(t)); err != nil {
		t.Fatalf("0100: %v", err)
	}
	// The catalog that compiles a prompt holds the four standard templates
	// (builtinRoles, or the same rows of the test database): no deleted one.

	var active, roleID string
	if err := tx.QueryRow(ctx, `SELECT behavior->>'activeRoleId' FROM knowledge_bases WHERE id = $1::uuid`, research).Scan(&active); err != nil || active != "chat" {
		t.Errorf("topic in research answers in %q (%v), want chat", active, err)
	}
	if err := tx.QueryRow(ctx, `SELECT behavior->>'activeRoleId' FROM knowledge_bases WHERE id = $1::uuid`, summary).Scan(&active); err != nil || active != "summary" {
		t.Errorf("topic in summary answers in %q (%v), want it kept", active, err)
	}
	if err := tx.QueryRow(ctx, `SELECT role_id FROM chats WHERE id = $1::uuid`, chatID).Scan(&roleID); err != nil || roleID != "chat" {
		t.Errorf("chat started in admin is in %q (%v), want chat", roleID, err)
	}
	p, err := kbbehavior.SystemPrompt(ctx, tx, research, "")
	if err != nil || p == nil || !strings.HasPrefix(*p, "Du bist JLU RAG, ein Assistent") {
		t.Errorf("fallen-back topic compiles to %v (%v)", p, err)
	}

	settings, err := kbbehavior.NewStore(tx).Load(ctx, summary)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := kbstartpage.NewStore(tx).Load(ctx, summary)
	if err != nil {
		t.Fatal(err)
	}
	page := kbstartpage.Effective(stored, settings.Behavior.ActiveRoleID, settings.Behavior.HasRole)
	// Without further cards the page starts as the active role does
	// (developer ruling 05.11.2026): Zusammenfassen, with its start prompt.
	if len(page.RoleEntries) != 0 || len(page.RoleStarts) != 0 || page.StartMode != kbstartpage.StartTask {
		t.Errorf("start page keeps a deleted role: %+v", page)
	}
}
