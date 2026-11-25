package processor

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/justrag/go-backend/internal/ai"
)

// reasoningModelStore serves one active provider with one chat model flagged as
// reasoning, at the address of a fake provider.
type reasoningModelStore struct{ baseURL string }

func (s reasoningModelStore) provider() *ai.AIProviderInfo {
	return &ai.AIProviderInfo{ID: "p", Name: "Test", APIKey: "k", BaseURL: s.baseURL}
}

func (s reasoningModelStore) GetActiveAIProvider(context.Context) (*ai.AIProviderInfo, error) {
	return s.provider(), nil
}

func (s reasoningModelStore) GetAIProviderByID(context.Context, string) (*ai.AIProviderInfo, error) {
	return s.provider(), nil
}

func (reasoningModelStore) GetAIModelsByProvider(context.Context, string) ([]ai.AIModelInfo, error) {
	return []ai.AIModelInfo{{Name: "fast-model", IsReasoning: true}}, nil
}

func (reasoningModelStore) GetKBModelOverrides(context.Context, string) (*ai.KBModelOverrides, error) {
	return nil, nil
}

// A RAPTOR summary is a fast-tier task: a reasoning-flagged model is asked not
// to think before it summarises.
func TestRaptorSummaryTurnsThinkingOff(t *testing.T) {
	var captured map[string]any
	mux := http.NewServeMux()
	mux.HandleFunc("/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&captured)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": "Zusammenfassung"}}},
		})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	adapter := &raptorSummariserAdapter{resolver: ai.NewConfigResolver(reasoningModelStore{baseURL: srv.URL})}
	got, err := adapter.Summarise(context.Background(), "", "fast-model", "datei.pdf", 1, "Text der Abschnitte.")
	if err != nil || got != "Zusammenfassung" {
		t.Fatalf("Summarise = %q, %v", got, err)
	}
	want := map[string]any{"enable_thinking": false}
	if !reflect.DeepEqual(captured["chat_template_kwargs"], want) {
		t.Errorf("chat_template_kwargs = %v, want %v", captured["chat_template_kwargs"], want)
	}
}
