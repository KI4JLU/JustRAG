//go:build integration

// Integration tests for the behavior settings (migration 0092,
// internal/kbbehavior) against a live schema: the one prompt reader every
// answer surface goes through (kbbehavior.SystemPrompt via
// kb.PGStore.GetKBSystemPrompt), the settings store, and the defaults of a
// new KB. Skipped when DB_* env is unset; testPool/insertUser are shared with
// store_pg_integration_test.go (same package).

package kb_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/kb"
	"github.com/justrag/go-backend/internal/kbbehavior"
)

func insertBehaviorKB(t *testing.T, pool *pgxpool.Pool, systemPrompt *string) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx,
		`INSERT INTO knowledge_bases (name, system_prompt) VALUES ('kb-behavior-it', $1) RETURNING id::text`,
		systemPrompt).Scan(&id); err != nil {
		t.Fatalf("seed kb: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM knowledge_bases WHERE id = $1::uuid`, id) //nolint:errcheck
	})
	return id
}

func insertRoleChat(t *testing.T, pool *pgxpool.Pool, kbID, userID string, roleID *string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO chats (kb_id, user_id, title, role_id) VALUES ($1::uuid, $2::uuid, 't', $3) RETURNING id::text`,
		kbID, userID, roleID).Scan(&id); err != nil {
		t.Fatalf("seed chat: %v", err)
	}
	return id
}

// Oracle: the pre-roles contract — a KB whose behavior is NULL answers with
// its system_prompt byte for byte (and nil when it has none).
func TestBehavior_UncustomizedKBKeepsItsPromptByteForByte(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	st := kb.NewStore(pool)

	legacy := "Du bist X.\n\n  Antworte kurz.  \n"
	withPrompt := insertBehaviorKB(t, pool, &legacy)
	got, err := st.GetKBSystemPrompt(ctx, withPrompt)
	if err != nil || got == nil || *got != legacy {
		t.Fatalf("got %v (%v), want the legacy prompt unchanged", got, err)
	}

	without := insertBehaviorKB(t, pool, nil)
	if got, err := st.GetKBSystemPrompt(ctx, without); err != nil || got != nil {
		t.Fatalf("no prompt: got %v (%v), want nil", got, err)
	}
	if got, err := st.GetKBSystemPrompt(ctx, "00000000-0000-0000-0000-000000000000"); err != nil || got != nil {
		t.Fatalf("missing KB: got %v (%v), want nil", got, err)
	}
}

// Oracle: what Save writes is what Load and the prompt reader read back;
// the legacy role's prompt lives in system_prompt; Reset clears both.
func TestBehavior_SaveLoadPromptAndReset(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	legacy := "alt"
	kbID := insertBehaviorKB(t, pool, &legacy)
	bs := kbbehavior.NewStore(pool)

	s, err := bs.Load(ctx, kbID)
	if err != nil || s.Customized || s.Behavior.ActiveRoleID != kbbehavior.LegacyRoleID {
		t.Fatalf("before save: %+v (%v)", s, err)
	}

	b := kbbehavior.Behavior{
		Version:      1,
		ActiveRoleID: "c-1",
		CustomRoles: []kbbehavior.Role{
			{ID: kbbehavior.LegacyRoleID, Prompt: "alt, bearbeitet"},
			{ID: "c-1", Name: "Eigene", Prompt: "EIGENE ROLLE", Icon: "sparkles"},
		},
		RoleRules: map[string]kbbehavior.RuleSet{"c-1": {
			Rules:       map[string]bool{"pages": true},
			CustomRules: []kbbehavior.CustomRule{{ID: "r1", Text: "Eigene Regel.", On: true}},
		}},
	}
	if err := kbbehavior.Validate(b); err != nil {
		t.Fatal(err)
	}
	if err := bs.Save(ctx, kbID, b); err != nil {
		t.Fatalf("save: %v", err)
	}
	var sp *string
	if err := pool.QueryRow(ctx, `SELECT system_prompt FROM knowledge_bases WHERE id = $1::uuid`, kbID).Scan(&sp); err != nil {
		t.Fatal(err)
	}
	if sp == nil || *sp != "alt, bearbeitet" {
		t.Errorf("system_prompt = %v, want the legacy role's prompt", sp)
	}

	s, err = bs.Load(ctx, kbID)
	if err != nil || !s.Customized || s.Behavior.ActiveRoleID != "c-1" || s.Behavior.CustomRoles[0].Prompt != "alt, bearbeitet" {
		t.Fatalf("after save: %+v (%v)", s, err)
	}

	got, err := kb.NewStore(pool).GetKBSystemPrompt(ctx, kbID)
	want := "EIGENE ROLLE\n\nRegeln:\n- Nenne zu jeder zitierten Quelle Seite oder Abschnitt.\n- Eigene Regel."
	if err != nil || got == nil || *got != want {
		t.Fatalf("compiled = %v (%v), want %q", got, err, want)
	}

	if err := bs.Reset(ctx, kbID); err != nil {
		t.Fatal(err)
	}
	if got, _ := kb.NewStore(pool).GetKBSystemPrompt(ctx, kbID); got != nil {
		t.Errorf("after reset: %q, want nil", *got)
	}
}

// Oracle: a chat's role decides its prompt; a chat of another KB, a chat
// without a role and a deleted role all read the active role.
func TestBehavior_ChatRolePrompt(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	userID := insertUser(t, pool, "behavior-chat-role")
	kbID := insertBehaviorKB(t, pool, nil)
	otherKB := insertBehaviorKB(t, pool, nil)
	bs := kbbehavior.NewStore(pool)
	if err := bs.Save(ctx, kbID, kbbehavior.Behavior{
		Version: 1, ActiveRoleID: "c-1",
		CustomRoles: []kbbehavior.Role{{ID: "c-1", Name: "Eigene", Prompt: "AKTIV"}},
		// No rules: the prompts compared below are the roles' own.
		RoleRules: map[string]kbbehavior.RuleSet{"c-1": {Rules: map[string]bool{}}},
	}); err != nil {
		t.Fatal(err)
	}

	tutor := "tutor"
	gone := "c-gone"
	tutorChat := insertRoleChat(t, pool, kbID, userID, &tutor)
	plainChat := insertRoleChat(t, pool, kbID, userID, nil)
	goneChat := insertRoleChat(t, pool, kbID, userID, &gone)
	foreignChat := insertRoleChat(t, pool, otherKB, userID, &tutor)

	read := func(chatID string) string {
		t.Helper()
		p, err := kbbehavior.SystemPrompt(ctx, pool, kbID, chatID)
		if err != nil || p == nil {
			t.Fatalf("chat %s: %v (%v)", chatID, p, err)
		}
		return *p
	}
	if got := read(tutorChat); !strings.HasPrefix(got, "Du bist ein geduldiger Tutor") {
		t.Errorf("tutor chat: %q", got)
	}
	for name, id := range map[string]string{"no role": plainChat, "deleted role": goneChat, "other KB's chat": foreignChat, "no chat": ""} {
		if got := read(id); got != "AKTIV" {
			t.Errorf("%s: %q, want the active role", name, got)
		}
	}

	for role, want := range map[string]bool{"tutor": true, "c-1": true, "c-gone": false} {
		if has, err := kbbehavior.HasRole(ctx, pool, kbID, role); err != nil || has != want {
			t.Errorf("HasRole(%s) = %v (%v), want %v", role, has, err, want)
		}
	}
	if has, _ := kbbehavior.HasRole(ctx, pool, "00000000-0000-0000-0000-000000000000", "tutor"); has {
		t.Error("HasRole on a missing KB must be false")
	}
}

// Oracle: kbbehavior.Default — a KB created without a prompt starts in the
// default template role with the default rules; one created with a prompt
// keeps it as its legacy role.
func TestBehavior_NewKBDefaults(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	st := kb.NewStore(pool)
	userID := insertUser(t, pool, "behavior-new-kb")

	created, err := st.CreateKnowledgeBase(ctx, "kb-behavior-new", nil, userID, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM knowledge_bases WHERE id = $1::uuid`, created.ID) }) //nolint:errcheck
	s, err := kbbehavior.NewStore(pool).Load(ctx, created.ID)
	if err != nil || !s.Customized || s.Behavior.ActiveRoleID != kbbehavior.DefaultRoleID() || !kbbehavior.RulesFor(s.Behavior, s.Behavior.ActiveRoleID).Rules["pages"] {
		t.Fatalf("new KB = %+v (%v)", s, err)
	}

	p := "Mein Prompt"
	withPrompt, err := st.CreateKnowledgeBase(ctx, "kb-behavior-new-prompt", nil, userID, &p)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM knowledge_bases WHERE id = $1::uuid`, withPrompt.ID)
	}) //nolint:errcheck
	if got, _ := st.GetKBSystemPrompt(ctx, withPrompt.ID); got == nil || *got != p {
		t.Errorf("KB created with a prompt: %v, want it unchanged", got)
	}
}
