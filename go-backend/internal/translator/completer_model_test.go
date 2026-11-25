package translator

import (
	"context"
	"testing"

	"github.com/justrag/go-backend/internal/ai"
)

// providerStore serves one active provider offering the models it lists (the
// first is its default chat model, unless one is flagged default), or no
// provider at all.
type providerStore struct {
	none   bool
	models []string
}

func (s providerStore) GetActiveAIProvider(context.Context) (*ai.AIProviderInfo, error) {
	if s.none {
		return nil, nil
	}
	return &ai.AIProviderInfo{ID: "p", Name: "Test", APIKey: "k", BaseURL: "http://127.0.0.1:1"}, nil
}

func (s providerStore) GetAIProviderByID(ctx context.Context, _ string) (*ai.AIProviderInfo, error) {
	return s.GetActiveAIProvider(ctx)
}

func (s providerStore) GetAIModelsByProvider(context.Context, string) ([]ai.AIModelInfo, error) {
	names := s.models
	if names == nil {
		names = []string{"default-model"}
	}
	out := make([]ai.AIModelInfo, len(names))
	for i, n := range names {
		out[i] = ai.AIModelInfo{Name: n, IsDefault: i == 0}
	}
	return out, nil
}

func (providerStore) GetKBModelOverrides(context.Context, string) (*ai.KBModelOverrides, error) {
	return nil, nil
}

// Model reports the model that will actually serve: the Fast Tier model only
// when a provider is active and offers it, else the default chat model
// (source "default"), else nothing. Complete resolves the same way.
func TestAICompleterModelSaysWhatServes(t *testing.T) {
	tests := []struct {
		name       string
		cfg        mapReader
		store      providerStore
		wantName   string
		wantSource string
	}{
		{"a Fast Tier model the provider offers", mapReader{"model_tier_fast": "tier-model"}, providerStore{models: []string{"default-model", "tier-model"}}, "tier-model", ModelSourceFastTier},
		{"a Fast Tier model the provider does not offer: the default serves", mapReader{"model_tier_fast": "tier-model"}, providerStore{}, "default-model", ModelSourceDefault},
		{"the Fast Tier model is the default model itself", mapReader{"model_tier_fast": "default-model"}, providerStore{}, "default-model", ModelSourceFastTier},
		{"none is set: the provider's default answers", mapReader{}, providerStore{}, "default-model", ModelSourceDefault},
		{"none is set and no provider is active", mapReader{}, providerStore{none: true}, "", ""},
		{"a Fast Tier model is set but no provider is active", mapReader{"model_tier_fast": "tier-model"}, providerStore{none: true}, "", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			c := NewAICompleter(ai.NewConfigResolver(tc.store), tc.cfg)
			name, source := c.Model(context.Background())
			if name != tc.wantName || source != tc.wantSource {
				t.Errorf("Model = %q from %q, want %q from %q", name, source, tc.wantName, tc.wantSource)
			}
		})
	}
}
