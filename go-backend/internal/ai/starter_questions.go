package ai

import (
	"context"
	"encoding/json"

	"github.com/justrag/go-backend/internal/prompts"
)

// starterQuestionsSpec is the Structured-Outputs contract for the starter
// questions: a bare JSON array of strings, the same shape as
// driftFollowupsSpec (vLLM guided_json accepts a top-level array; on the
// json_object downgrade parseJSONStringArray still recovers it).
var starterQuestionsSpec = &StructuredSpec{
	Name: "starter_questions",
	Schema: json.RawMessage(`{
		"type": "array",
		"items": {"type": "string"}
	}`),
}

// starterTemperature varies the questions between calls: they are generated
// afresh for every empty chat that opens, so the same documents must not
// always give the same list.
const starterTemperature = 0.8

// GenerateStarterQuestions asks the model for up to n questions to open an
// empty chat with, from the KB's name, one excerpt per document and the role
// the chat is in (zero role = no role context).
// modelOverride is the caller's fast-tier pick (model_tier_fast); empty falls
// back to the KB chat model. The raw strings are returned unvalidated — the
// caller filters them (length, URLs, duplicates) before serving. Unparseable
// output yields an empty slice and no error; a transport error is returned
// as is.
func GenerateStarterQuestions(ctx context.Context, resolver *ConfigResolver, kbID, modelOverride, kbName string, role prompts.StarterRole, docs []prompts.StarterDoc, lang string, n int) ([]string, error) {
	user := prompts.StarterQuestionsUser(kbName, role, docs, n)
	system := prompts.StarterQuestionsSystem(lang, n, role.Name != "" || role.Prompt != "")
	var (
		res *CompletionResult
		err error
	)
	if h := resolver.completionHook.Load(); h != nil {
		res, err = (*h)(ctx, resolver, user, system, kbID, modelOverride)
	} else {
		res, err = generateCompletionStructuredAt(ctx, resolver, user, system, kbID, modelOverride, starterQuestionsSpec, starterTemperature)
	}
	if err != nil {
		return nil, err
	}
	return parseJSONStringArray(res.Content), nil
}
