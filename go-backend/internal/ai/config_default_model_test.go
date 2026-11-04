package ai

import (
	"context"
	"testing"
)

// KI-939: a KB without an override gets the model flagged IsDefault, not
// whichever row comes first, for every kind. The flagged model is never the
// first of its list here, so a resolver that still takes [0] fails.
func TestResolve_UsesFlaggedDefaultPerKind(t *testing.T) {
	store := &mockStore{
		activeProvider: &AIProviderInfo{ID: "p", Name: "jlu", BaseURL: "https://x/v1"},
		modelsByProv: map[string][]AIModelInfo{"p": {
			{Name: "a-chat"},
			{Name: "b-chat", IsReasoning: true, IsDefault: true},
			{Name: "a-emb", IsEmbedding: true, Dimensions: 1024},
			{Name: "b-emb", IsEmbedding: true, Dimensions: 4096, IsDefault: true},
			{Name: "a-rr", IsRerank: true},
			{Name: "b-rr", IsRerank: true, IsDefault: true},
			{Name: "a-tts", IsTts: true},
			{Name: "b-tts", IsTts: true, IsDefault: true},
			{Name: "a-stt", IsStt: true},
			{Name: "b-stt", IsStt: true, IsDefault: true},
		}},
	}
	cfg, err := NewConfigResolver(store).Resolve(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	got := []string{cfg.ChatModel, cfg.EmbeddingModel, cfg.RerankModel, cfg.TtsModel, cfg.SttModel}
	want := []string{"b-chat", "b-emb", "b-rr", "b-tts", "b-stt"}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("default %d = %q, want %q", i, got[i], want[i])
		}
	}
	// The dimensions come from the default embedding model, not the first.
	if cfg.EmbeddingDimensions != 4096 {
		t.Errorf("EmbeddingDimensions = %d, want 4096 (b-emb)", cfg.EmbeddingDimensions)
	}
	// The full chat list is still offered for overrides.
	if len(cfg.ChatModels) != 2 {
		t.Errorf("ChatModels = %v, want both", cfg.ChatModels)
	}
}

// A kind without a flagged model falls back to the first of the list, which
// the store orders by name.
func TestDefaultModel_FallsBackToFirst(t *testing.T) {
	got := defaultModel([]AIModelInfo{{Name: "a"}, {Name: "b"}})
	if got.Name != "a" {
		t.Errorf("defaultModel = %q, want a", got.Name)
	}
}
