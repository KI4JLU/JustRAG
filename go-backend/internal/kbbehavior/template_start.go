package kbbehavior

import "strings"

// TemplateStart is how a role template's chat starts on a start page, set by
// „Vorlagen": the kind of start (see kbstartpage.EntryStart) with its texts
// in both prompt languages. A KB that sets up no start of its own for the
// role uses it; nil is the input field. kbstartpage validates it
// (ValidateTemplateStart) — it owns the start's rules and limits, and
// imports this package.
type TemplateStart struct {
	Kind        string              `json:"kind"`
	Text        Texts               `json:"text"`
	Send        bool                `json:"send"`
	Instruction Texts               `json:"instruction"`
	Suggestions TemplateSuggestions `json:"suggestions"`
}

// TemplateSuggestions are the starter questions under the input field of a
// template's start; the fixed ones in both languages.
type TemplateSuggestions struct {
	QuestionsOn    bool      `json:"questionsOn"`
	QuestionMode   string    `json:"questionMode"`
	DynamicCount   int       `json:"dynamicCount"`
	FixedQuestions TextLists `json:"fixedQuestions"`
}

// TextLists is a list of texts in the two prompt languages.
type TextLists struct {
	DE []string `json:"de"`
	EN []string `json:"en"`
}

// CatalogStart is a template's start in one language, shaped like
// kbstartpage.EntryStart (the catalog's clients read both the same way).
type CatalogStart struct {
	Kind        string             `json:"kind"`
	Text        string             `json:"text"`
	Send        bool               `json:"send"`
	Instruction string             `json:"instruction"`
	Suggestions CatalogSuggestions `json:"suggestions"`
}

// CatalogSuggestions is kbstartpage.Suggestions' shape.
type CatalogSuggestions struct {
	QuestionsOn    bool     `json:"questionsOn"`
	QuestionMode   string   `json:"questionMode"`
	DynamicCount   int      `json:"dynamicCount"`
	FixedQuestions []string `json:"fixedQuestions"`
}

// In is the start in lang: an empty English text (or an empty English
// question list) falls back to the German one, as a template's other texts do.
func (s TemplateStart) In(lang string) CatalogStart {
	in := func(t Texts) string { return localized{t.DE, t.EN}.in(lang) }
	questions := s.Suggestions.FixedQuestions.DE
	if lang == "en" && len(s.Suggestions.FixedQuestions.EN) > 0 {
		questions = s.Suggestions.FixedQuestions.EN
	}
	return CatalogStart{
		Kind: s.Kind, Text: in(s.Text), Send: s.Send, Instruction: in(s.Instruction),
		Suggestions: CatalogSuggestions{
			QuestionsOn: s.Suggestions.QuestionsOn, QuestionMode: s.Suggestions.QuestionMode,
			DynamicCount: s.Suggestions.DynamicCount, FixedQuestions: append([]string{}, questions...),
		},
	}
}

func trimTexts(t Texts) Texts { return Texts{strings.TrimSpace(t.DE), strings.TrimSpace(t.EN)} }

func trimList(list []string) []string {
	out := make([]string, 0, len(list))
	for _, q := range list {
		if q = strings.TrimSpace(q); q != "" {
			out = append(out, q)
		}
	}
	return out
}

// trimmedStart trims a validated start's texts and drops empty questions.
func trimmedStart(s *TemplateStart) *TemplateStart {
	if s == nil {
		return nil
	}
	out := *s
	out.Text = trimTexts(s.Text)
	out.Instruction = trimTexts(s.Instruction)
	out.Suggestions.FixedQuestions = TextLists{DE: trimList(s.Suggestions.FixedQuestions.DE), EN: trimList(s.Suggestions.FixedQuestions.EN)}
	return &out
}
