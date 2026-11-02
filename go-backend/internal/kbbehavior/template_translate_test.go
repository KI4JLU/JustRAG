package kbbehavior

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/ai"
)

func templateWithStart() TemplateInput {
	return TemplateInput{
		Icon: "sparkles", Enabled: true,
		Name: Texts{"Tutor", ""}, Description: Texts{"Erklärt", ""}, Prompt: Texts{"Du bist Tutor.", ""},
		Cover: Cover{"#0056B3", "#0056B3"},
		Start: &TemplateStart{
			Kind: "task", Text: Texts{"Fasse zusammen", ""}, Send: true,
			Suggestions: TemplateSuggestions{QuestionMode: "fixed", DynamicCount: 4, FixedQuestions: TextLists{DE: []string{"Was?", "Wie?"}}},
		},
	}
}

// Oracle: the written language's texts are what the translation takes — the
// card, the prompt and the start's texts and questions.
func TestSourceTexts(t *testing.T) {
	got := sourceTexts(templateWithStart(), "de")
	want := ai.RoleTexts{Name: "Tutor", Description: "Erklärt", Prompt: "Du bist Tutor.", StartText: "Fasse zusammen", Questions: []string{"Was?", "Wie?"}}
	if !sameTexts(got, want) {
		t.Fatalf("sourceTexts = %+v, want %+v", got, want)
	}
	if sameTexts(got, sourceTexts(templateWithStart(), "en")) {
		t.Fatal("the English texts are empty, so they differ from the German ones")
	}
}

// Oracle: a translation fills only the other language and leaves the written
// one, the start's kind and settings as they are.
func TestWithTexts_FillsTheOtherLanguage(t *testing.T) {
	in := templateWithStart()
	out := withTexts(in, "en", ai.RoleTexts{Name: " Tutor ", Description: "Explains", Prompt: "You are a tutor.", StartText: "Summarise", Questions: []string{"What?", "How?"}})
	if out.Name != (Texts{"Tutor", "Tutor"}) || out.Prompt.DE != "Du bist Tutor." || out.Prompt.EN != "You are a tutor." {
		t.Fatalf("texts = %+v / %+v", out.Name, out.Prompt)
	}
	if out.Start.Text != (Texts{"Fasse zusammen", "Summarise"}) || out.Start.Kind != "task" || !out.Start.Send {
		t.Fatalf("start = %+v", out.Start)
	}
	if got := out.Start.Suggestions.FixedQuestions; len(got.DE) != 2 || got.EN[1] != "How?" {
		t.Fatalf("questions = %+v", got)
	}
	if in.Start.Text.EN != "" {
		t.Fatal("withTexts must not write through to the input's start")
	}
}

// Oracle: KBs compile the German texts, so a template written in English
// keeps them filled — the English ones stand in until the translation.
func TestTrimmed_EnglishStandsInForGerman(t *testing.T) {
	in := TemplateInput{Lang: "en", Name: Texts{"", " Tutor "}, Prompt: Texts{"", "You are"}, Start: &TemplateStart{
		Kind: "task", Text: Texts{"", "Summarise"}, Suggestions: TemplateSuggestions{FixedQuestions: TextLists{EN: []string{" What? ", " "}}},
	}}
	out := trimmed(in)
	if out.Name.DE != "Tutor" || out.Prompt.DE != "You are" || out.Start.Text.DE != "Summarise" {
		t.Fatalf("German texts = %q %q %q", out.Name.DE, out.Prompt.DE, out.Start.Text.DE)
	}
	if q := out.Start.Suggestions.FixedQuestions; len(q.EN) != 1 || q.EN[0] != "What?" || len(q.DE) != 1 {
		t.Fatalf("questions = %+v", q)
	}
	if trimmed(TemplateInput{}).Lang != "de" {
		t.Fatal("German is the default language")
	}
}

// Oracle: the written language must carry name and prompt; German is the default.
func TestValidateTemplate_Lang(t *testing.T) {
	en := TemplateInput{Lang: "en", Icon: "sparkles", Enabled: true, Name: Texts{"", "Tutor"}, Prompt: Texts{"", "You are"}, Cover: Cover{"#0056B3", "#0056B3"}}
	if err := ValidateTemplate(en); err != nil {
		t.Fatalf("an English-only template is valid: %v", err)
	}
	en.Lang = ""
	if err := ValidateTemplate(en); !errors.Is(err, ErrInvalid) {
		t.Fatalf("without lang the German name is required, got %v", err)
	}
	en.Lang = "fr"
	if err := ValidateTemplate(en); !errors.Is(err, ErrInvalid) {
		t.Fatalf("lang fr: got %v", err)
	}
}

// Oracle: the catalog shows a start in the asked language; an empty English
// text or question list falls back to the German one.
func TestTemplateStartIn(t *testing.T) {
	s := *templateWithStart().Start
	if c := s.In("en"); c.Text != "Fasse zusammen" || len(c.Suggestions.FixedQuestions) != 2 {
		t.Fatalf("English falls back to German: %+v", c)
	}
	s.Text.EN = "Summarise"
	s.Suggestions.FixedQuestions.EN = []string{"What?"}
	if c := s.In("en"); c.Text != "Summarise" || len(c.Suggestions.FixedQuestions) != 1 {
		t.Fatalf("English: %+v", c)
	}
	if c := s.In("de"); c.Text != "Fasse zusammen" || c.Kind != "task" || !c.Send {
		t.Fatalf("German: %+v", c)
	}
}

// Oracle: the start is validated as it is stored — an English task start has
// its German text filled from the English one, so a validator that needs the
// German text accepts it.
func TestDecodeTemplate_EnglishStartValidatesAsStored(t *testing.T) {
	h := NewTemplatesHandler(nil, func(s TemplateStart) error {
		if s.Kind == "task" && s.Text.DE == "" {
			return invalid("a task card needs its text")
		}
		return nil
	})
	body := `{"lang":"en","icon":"sparkles","enabled":true,"name":{"de":"","en":"Tutor"},"description":{"de":"","en":""},` +
		`"prompt":{"de":"","en":"You are"},"cover":{"from":"#0056B3","to":"#0056B3"},` +
		`"start":{"kind":"task","text":{"de":"","en":"Summarise"},"send":true,"instruction":{"de":"","en":""},` +
		`"suggestions":{"questionsOn":false,"questionMode":"dynamic","dynamicCount":4,"fixedQuestions":{"de":[],"en":[]}}}}`
	w := httptest.NewRecorder()
	if _, ok := h.decodeTemplate(w, httptest.NewRequest(http.MethodPost, "/api/admin/role-templates", strings.NewReader(body))); !ok {
		t.Fatalf("decodeTemplate rejected an English start: %d %s", w.Code, w.Body)
	}
}

// Oracle: a save that leaves the written texts as stored keeps the stored
// translation (the client's may predate it); a save that changes them keeps
// the client's texts and asks for a new translation.
func TestKeepTranslation(t *testing.T) {
	prev := withTexts(trimmed(templateWithStart()), "en", ai.RoleTexts{Name: "Tutor", Description: "Explains", Prompt: "You are a tutor.", StartText: "Summarise", Questions: []string{"What?", "How?"}})
	stale := trimmed(templateWithStart())
	stale.Cover = Cover{"#3897E8", "#3897E8"}
	got, changed := keepTranslation(prev, stale)
	if changed || got.Prompt.EN != "You are a tutor." || got.Start.Text.EN != "Summarise" || len(got.Start.Suggestions.FixedQuestions.EN) != 2 {
		t.Fatalf("settings-only save: changed=%v, got %+v / %+v", changed, got.Prompt, got.Start)
	}
	if got.Cover.From != "#3897E8" || got.Prompt.DE != "Du bist Tutor." {
		t.Fatalf("settings-only save lost the client's settings: %+v / %+v", got.Cover, got.Prompt)
	}
	edited := stale
	edited.Prompt.DE = "Du bist Coach."
	if got, changed := keepTranslation(prev, edited); !changed || got.Prompt.EN != "" {
		t.Fatalf("text edit: changed=%v, prompt %+v", changed, got.Prompt)
	}
}
