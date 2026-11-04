//go:build integration

// Integration tests for the default model per provider and kind (migration
// 0098, KI-939): how CreateAIConfig and UpdateAIConfig set ai_models.is_default,
// and that internal/ai reads the same flag. Skipped when DB_* env is unset.

package adminconfigs

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/ai"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	host, port, name := os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_NAME")
	if host == "" || port == "" || name == "" {
		t.Skip("default-model tests require DB_* env (main Postgres)")
	}
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%s/%s",
		url.QueryEscape(os.Getenv("DB_USER")), url.QueryEscape(os.Getenv("DB_PASSWORD")), host, port, name)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// createProvider creates a provider through the store and deletes it (and,
// by cascade, its models) when the test ends.
func createProvider(t *testing.T, st *PGStore, in CreateAIConfigInput) *AIConfigResponse {
	t.Helper()
	in.Name = "it-default-model-" + t.Name()
	in.Provider = "openai"
	in.APIKey = "sk-test"
	resp, err := st.CreateAIConfig(context.Background(), in)
	if err != nil {
		t.Fatalf("CreateAIConfig: %v", err)
	}
	t.Cleanup(func() { st.DeleteAIConfig(context.Background(), resp.ID) }) //nolint:errcheck
	return resp
}

// defaults returns the names flagged isDefault in a model list.
func defaults(models []AIModelRow) []string {
	var out []string
	for _, m := range models {
		if m.IsDefault {
			out = append(out, m.Name)
		}
	}
	return out
}

func wantDefault(t *testing.T, kind string, models []AIModelRow, want string) {
	t.Helper()
	got := defaults(models)
	if want == "" {
		if len(got) != 0 {
			t.Errorf("%s defaults = %v, want none", kind, got)
		}
		return
	}
	if len(got) != 1 || got[0] != want {
		t.Errorf("%s defaults = %v, want [%s]", kind, got, want)
	}
}

func names(ns ...string) []AIModelInput {
	out := make([]AIModelInput, len(ns))
	for i, n := range ns {
		out[i] = AIModelInput{Name: n}
	}
	return out
}

// With no flag, the first submitted model is the default. The names are
// submitted in reverse alphabetical order, so "first by name" would fail.
func TestCreate_DefaultIsFirstSubmitted(t *testing.T) {
	st := NewStore(testPool(t))
	resp := createProvider(t, st, CreateAIConfigInput{
		ChatModels:      names("zeta", "alpha"),
		EmbeddingModels: names("z-emb", "a-emb"),
		RerankModels:    names("rr"),
	})
	wantDefault(t, "chat", resp.ChatModels, "zeta")
	wantDefault(t, "embedding", resp.EmbeddingModels, "z-emb")
	wantDefault(t, "rerank", resp.RerankModels, "rr")
	wantDefault(t, "tts", resp.TtsModels, "")
}

func TestCreate_FlaggedModelWins(t *testing.T) {
	st := NewStore(testPool(t))
	resp := createProvider(t, st, CreateAIConfigInput{
		ChatModels: []AIModelInput{{Name: "zeta"}, {Name: "alpha", IsDefault: true}, {Name: "beta", IsDefault: true}},
	})
	wantDefault(t, "chat", resp.ChatModels, "alpha")
}

// The current admin form sends no isDefault and lists models by name. A
// save must not move the default just because the order changed.
func TestUpdate_UnflaggedSaveKeepsDefault(t *testing.T) {
	ctx := context.Background()
	st := NewStore(testPool(t))
	resp := createProvider(t, st, CreateAIConfigInput{ChatModels: names("zeta", "alpha")})

	got, err := st.UpdateAIConfig(ctx, resp.ID, UpdateAIConfigInput{ChatModels: names("alpha", "mid", "zeta")})
	if err != nil {
		t.Fatal(err)
	}
	wantDefault(t, "chat", got.ChatModels, "zeta")

	// The default removed: the first submitted model takes over.
	got, err = st.UpdateAIConfig(ctx, resp.ID, UpdateAIConfigInput{ChatModels: names("mid", "alpha")})
	if err != nil {
		t.Fatal(err)
	}
	wantDefault(t, "chat", got.ChatModels, "mid")

	// The kind emptied: no default left.
	got, err = st.UpdateAIConfig(ctx, resp.ID, UpdateAIConfigInput{ChatModels: []AIModelInput{}})
	if err != nil {
		t.Fatal(err)
	}
	wantDefault(t, "chat", got.ChatModels, "")
}

func TestUpdate_FlagMovesDefault(t *testing.T) {
	ctx := context.Background()
	st := NewStore(testPool(t))
	resp := createProvider(t, st, CreateAIConfigInput{EmbeddingModels: names("z-emb", "a-emb")})

	got, err := st.UpdateAIConfig(ctx, resp.ID, UpdateAIConfigInput{
		EmbeddingModels: []AIModelInput{{Name: "z-emb"}, {Name: "a-emb", IsDefault: true}},
	})
	if err != nil {
		t.Fatal(err)
	}
	wantDefault(t, "embedding", got.EmbeddingModels, "a-emb")
}

// The legacy reasoning-only payload replaces just the reasoning chat models.
// A non-reasoning chat default survives it, and a flag in it can move the
// chat default without tripping the one-default index.
func TestUpdate_LegacyReasoningListSharesChatDefault(t *testing.T) {
	ctx := context.Background()
	st := NewStore(testPool(t))
	resp := createProvider(t, st, CreateAIConfigInput{ChatModels: names("plain")})

	got, err := st.UpdateAIConfig(ctx, resp.ID, UpdateAIConfigInput{ReasoningModels: names("thinker")})
	if err != nil {
		t.Fatal(err)
	}
	wantDefault(t, "chat", got.ChatModels, "plain")

	got, err = st.UpdateAIConfig(ctx, resp.ID, UpdateAIConfigInput{
		ReasoningModels: []AIModelInput{{Name: "thinker", IsDefault: true}},
	})
	if err != nil {
		t.Fatal(err)
	}
	wantDefault(t, "chat", got.ChatModels, "thinker")
}

// End to end: the resolver's store reads the flag the admin store writes, so
// a KB without an override resolves to the flagged model, not to "alpha"
// (first by name) or "zeta" (first submitted).
func TestResolverReadsFlaggedDefault(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	resp := createProvider(t, st, CreateAIConfigInput{
		ChatModels: []AIModelInput{{Name: "zeta"}, {Name: "mid", IsDefault: true}, {Name: "alpha"}},
	})
	models, err := ai.NewStore(pool).GetAIModelsByProvider(context.Background(), resp.ID)
	if err != nil {
		t.Fatal(err)
	}
	var flagged []string
	for _, m := range models {
		if m.IsDefault {
			flagged = append(flagged, m.Name)
		}
	}
	if len(flagged) != 1 || flagged[0] != "mid" {
		t.Errorf("flagged = %v, want [mid]", flagged)
	}
}
