package owuicompat

import (
	"context"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/chat"
)

// Prepared is the RAG context for one turn.
type Prepared struct {
	SystemPrompt string
	Sources      []chat.ChatSource
}

// Answerer runs retrieval and generation. pipelineAnswerer (Task 8) is the
// production implementation; tests use a fake.
type Answerer interface {
	// Prepare condenses the query against history, loads the KB prompt,
	// prepends systemPrefix and runs retrieval. kbID is never empty.
	Prepare(ctx context.Context, kbID, query, systemPrefix string, history []ai.ChatHistoryEntry) (*Prepared, error)
	// Stream generates the answer; kbID "" uses the global default model.
	Stream(ctx context.Context, kbID string, history []ai.ChatHistoryEntry, prompt, systemPrompt, reasoningEffort string, temperature float64) (<-chan ai.StreamEvent, error)
	// Generate is the non-streaming variant.
	Generate(ctx context.Context, kbID string, history []ai.ChatHistoryEntry, prompt, systemPrompt string, wantReasoning bool) (string, error)
}
