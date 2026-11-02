package ai

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/justrag/go-backend/internal/prompts"
)

var kbDescriptionSpec = &StructuredSpec{
	Name: "kb_description",
	Schema: json.RawMessage(`{
		"type": "object",
		"properties": {"description": {"type": "string"}},
		"required": ["description"],
		"additionalProperties": false
	}`),
}

// GenerateKBDescription writes a description draft for a topic from its
// title and one excerpt per document. modelOverride is the caller's fast-tier pick
// (empty = the KB chat model). The text is returned trimmed and unvalidated —
// the caller checks it before serving; a malformed answer is asked for once
// more, then ErrMalformedJSON.
func GenerateKBDescription(ctx context.Context, resolver *ConfigResolver, kbID, modelOverride, title string, docs []prompts.StarterDoc, lang string) (string, error) {
	var out struct {
		Description string `json:"description"`
	}
	if err := CompleteStructuredJSON(ctx, resolver, prompts.KBDescriptionUser(lang, title, docs), prompts.KBDescriptionSystem(lang), kbID, modelOverride, kbDescriptionSpec, &out); err != nil {
		return "", err
	}
	return strings.TrimSpace(out.Description), nil
}
