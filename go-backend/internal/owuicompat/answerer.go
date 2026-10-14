package owuicompat

import (
	"context"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/chat"
	"github.com/justrag/go-backend/internal/vector"
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

// KBPromptReader loads a KB's system prompt (kb.PGStore satisfies it).
type KBPromptReader interface {
	GetKBSystemPrompt(ctx context.Context, kbID string) (*string, error)
}

type pipelineAnswerer struct {
	resolver *ai.ConfigResolver
	search   vector.Searcher
	prompts  KBPromptReader
	dates    chat.FileDateLookup
}

// NewPipelineAnswerer runs the same pipeline as internal/openaicompat:
// condense, PrepareChatContext with a nil site-config reader, source dates.
func NewPipelineAnswerer(resolver *ai.ConfigResolver, search vector.Searcher, prompts KBPromptReader, dates chat.FileDateLookup) Answerer {
	return &pipelineAnswerer{resolver: resolver, search: search, prompts: prompts, dates: dates}
}

func (p *pipelineAnswerer) Prepare(ctx context.Context, kbID, query, systemPrefix string, history []ai.ChatHistoryEntry) (*Prepared, error) {
	searchQuery := query
	if len(history) >= 2 {
		if condensed, err := ai.CondenseQuestion(ctx, p.resolver, history, query, kbID, "de", ""); err == nil && condensed != "" {
			searchQuery = condensed
		}
	}
	kbPrompt := ""
	if sp, err := p.prompts.GetKBSystemPrompt(ctx, kbID); err == nil && sp != nil {
		kbPrompt = *sp
	}
	if systemPrefix != "" {
		if kbPrompt != "" {
			kbPrompt = systemPrefix + "\n\n" + kbPrompt
		} else {
			kbPrompt = systemPrefix
		}
	}
	cc, err := chat.PrepareChatContext(ctx, p.resolver, p.search, nil, chat.ChatContextParams{
		KbID: kbID, SearchQuery: searchQuery, Language: "de", KbSystemPrompt: kbPrompt, FileDates: p.dates,
	})
	if err != nil {
		return nil, err
	}
	chat.EnrichSourceDates(ctx, p.dates, cc.Sources)
	return &Prepared{SystemPrompt: cc.SystemPrompt, Sources: cc.Sources}, nil
}

func (p *pipelineAnswerer) Stream(ctx context.Context, kbID string, history []ai.ChatHistoryEntry, prompt, systemPrompt, effort string, temp float64) (<-chan ai.StreamEvent, error) {
	return ai.StreamCompletionWithHistory(ctx, p.resolver, history, prompt, systemPrompt, kbID, effort, temp)
}

func (p *pipelineAnswerer) Generate(ctx context.Context, kbID string, history []ai.ChatHistoryEntry, prompt, systemPrompt string, wantReasoning bool) (string, error) {
	res, err := ai.GenerateCompletionWithHistory(ctx, p.resolver, history, prompt, systemPrompt, kbID, wantReasoning)
	if err != nil {
		return "", err
	}
	return res.Content, nil
}
