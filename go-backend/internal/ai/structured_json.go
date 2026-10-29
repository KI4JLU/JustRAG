package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/justrag/go-backend/internal/logctx"
)

// structuredJSONAttempts is how many answers CompleteStructuredJSON asks for
// before it gives up on malformed JSON: a malformed answer (prose around the
// object or a cut-off reply on the json_object downgrade path, a model that
// ignores the format) is usually a one-off.
const structuredJSONAttempts = 2

// ErrMalformedJSON reports a model answer that is not a JSON object, after
// every attempt.
var ErrMalformedJSON = errors.New("ai: model answer is not a JSON object")

// structuredJSONRetryNote is appended to the user prompt of a repeated
// attempt. It changes the input, so a deterministic (temperature 0) model
// does not answer the same malformed text again.
const structuredJSONRetryNote = "\n\nYour previous answer could not be parsed as JSON. Answer with the JSON object only, nothing before or after it."

// CompleteStructuredJSON runs a Structured-Outputs completion
// (GenerateCompletionStructured, through the resolver's test hook) and
// decodes its answer into out, a pointer to the expected object. When the
// answer is not a JSON object it asks once more, with a note in the user
// prompt; after that it returns ErrMalformedJSON. A transport error is
// returned at once — the completion layer has its own retries. out is only
// meaningful when the error is nil.
func CompleteStructuredJSON(ctx context.Context, resolver *ConfigResolver, prompt, systemPrompt, kbID, modelOverride string, spec *StructuredSpec, out any) error {
	user := prompt
	for attempt := 1; ; attempt++ {
		res, err := resolver.structuredCompletionFn(ctx, user, systemPrompt, kbID, modelOverride, spec)
		if err != nil {
			return err
		}
		if parseJSONObjectLoose(res.Content, out) == nil {
			return nil
		}
		task := ""
		if spec != nil {
			task = spec.Name
		}
		if attempt >= structuredJSONAttempts {
			logctx.From(ctx).Warn("ai.structured.malformed_json", "task", task, "attempts", attempt)
			return ErrMalformedJSON
		}
		logctx.From(ctx).Info("ai.structured.malformed_json_retry", "task", task, "attempt", attempt)
		user = prompt + structuredJSONRetryNote
	}
}

// parseJSONObjectLoose unmarshals a JSON object, also when the model wrapped
// it in prose or a code fence (the json_object downgrade path).
func parseJSONObjectLoose(text string, out any) error {
	trimmed := strings.TrimSpace(text)
	if err := json.Unmarshal([]byte(trimmed), out); err == nil {
		return nil
	}
	start, end := strings.Index(trimmed, "{"), strings.LastIndex(trimmed, "}")
	if start >= 0 && end > start {
		return json.Unmarshal([]byte(trimmed[start:end+1]), out)
	}
	return ErrMalformedJSON
}
