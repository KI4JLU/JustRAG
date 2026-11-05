package kbstartpage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/kbbehavior"
	"github.com/justrag/go-backend/internal/store"
)

func roles(ids ...string) func(string) bool {
	return func(id string) bool {
		for _, r := range ids {
			if r == id {
				return true
			}
		}
		return false
	}
}

func valid() StartPage {
	p := Default()
	p.StartMode = StartRoles
	p.RoleStarts = map[string]EntryStart{
		"summary": {Kind: EntryTask, Text: "Erkläre mir die Elternzeit", Send: true, Suggestions: DefaultSuggestions()},
		"it":      {Kind: EntryFile, Text: "Antrag prüfen", Instruction: "Prüfe den Antrag.", Suggestions: DefaultSuggestions()},
		// Set up, not on the page: a draft may be unfinished.
		"filecheck": {Kind: EntryTask, Suggestions: DefaultSuggestions()},
	}
	p.RoleEntries = []RoleEntry{{ID: "re-1", RoleID: "summary"}, {ID: "re-2", RoleID: "it"}}
	p.FixedQuestions = []string{"Wie lange dauert die Probezeit?"}
	return p
}

func setStart(p *StartPage, roleID string, f func(*EntryStart)) {
	e := p.RoleStarts[roleID]
	f(&e)
	p.RoleStarts[roleID] = e
}

func TestDefault(t *testing.T) {
	d := Default()
	if err := Validate(d, "chat", roles()); err != nil {
		t.Fatal(err)
	}
	// Oracle: brief v2 §2.2 — input field, starter questions off.
	if d.StartMode != StartInput || d.QuestionsOn || d.Colors == nil || *d.Colors != *DefaultColors() {
		t.Errorf("default = %+v", d)
	}
}

func TestValidate(t *testing.T) {
	if err := Validate(valid(), "chat", roles("summary", "it", "filecheck")); err != nil {
		t.Fatalf("valid: %v", err)
	}
	long := strings.Repeat("ä", MaxQuestionRunes+1)
	cases := map[string]func(*StartPage){
		"version":            func(p *StartPage) { p.Version = 3 },
		"colors":             func(p *StartPage) { p.Colors = &Colors{From: "#fff", To: "#000000"} },
		"start mode":         func(p *StartPage) { p.StartMode = "voice" },
		"unknown role":       func(p *StartPage) { p.RoleEntries[0].RoleID = "c-gone" },
		"unknown start role": func(p *StartPage) { p.RoleStarts["c-gone"] = DefaultStart() },
		"too many cards":     func(p *StartPage) { p.RoleEntries = append(p.RoleEntries, p.RoleEntries[0], p.RoleEntries[0]) },
		"duplicate card":     func(p *StartPage) { p.RoleEntries[1].ID = "re-1" },
		"bad card id":        func(p *StartPage) { p.RoleEntries[0].ID = "a b" },
		"role twice":         func(p *StartPage) { p.RoleEntries[1].RoleID = "summary" },
		"bad kind": func(p *StartPage) {
			p.RoleStarts["filecheck"] = EntryStart{Kind: "voice", Suggestions: DefaultSuggestions()}
		},
		"long card text": func(p *StartPage) { setStart(p, "summary", func(e *EntryStart) { e.Text = long }) },
		"empty task":     func(p *StartPage) { setStart(p, "summary", func(e *EntryStart) { e.Text = " " }) },
		"long instruction": func(p *StartPage) {
			setStart(p, "it", func(e *EntryStart) { e.Instruction = strings.Repeat("x", MaxInstructionRunes+1) })
		},
		"roles, the active role's task without text": func(p *StartPage) {
			p.RoleEntries = []RoleEntry{}
			p.RoleStarts["chat"] = EntryStart{Kind: EntryTask, Suggestions: DefaultSuggestions()}
		},
		"question mode":  func(p *StartPage) { p.QuestionMode = "random" },
		"dynamic count":  func(p *StartPage) { p.DynamicCount = 5 },
		"too many fixed": func(p *StartPage) { p.FixedQuestions = make([]string, MaxFixedQuestions+1) },
		"long fixed":     func(p *StartPage) { p.FixedQuestions[0] = long },
		"card question mode": func(p *StartPage) {
			setStart(p, "summary", func(e *EntryStart) { e.Suggestions.QuestionMode = "random" })
		},
		"card fixed long": func(p *StartPage) {
			setStart(p, "filecheck", func(e *EntryStart) { e.Suggestions.FixedQuestions = []string{long} })
		},
		"long upload label": func(p *StartPage) { p.UploadLabel = strings.Repeat("x", MaxUploadLabelRunes+1) },
	}
	for name, mutate := range cases {
		p := valid()
		mutate(&p)
		if err := Validate(p, "chat", roles("summary", "it", "filecheck")); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", name, err)
		}
	}
	// The active role shows first on its own: no card of it.
	if err := Validate(valid(), "summary", roles("summary", "it", "filecheck")); !errors.Is(err, ErrInvalid) {
		t.Errorf("a card of the active role: err = %v, want ErrInvalid", err)
	}
	// A role's start the page does not show stays a draft: removing its card
	// never loses it (brief v2 §2.2).
	p := valid()
	p.RoleEntries = p.RoleEntries[1:]
	setStart(&p, "summary", func(e *EntryStart) { e.Text = "" })
	if err := Validate(p, "chat", roles("summary", "it", "filecheck")); err != nil {
		t.Errorf("draft start off the page: %v", err)
	}
	// The active role's own start shows: an instruction needs its text.
	p = valid()
	p.RoleEntries = []RoleEntry{}
	p.RoleStarts["chat"] = EntryStart{Kind: EntryTask, Suggestions: DefaultSuggestions()}
	if err := Validate(p, "chat", roles("chat", "summary", "it", "filecheck")); !errors.Is(err, ErrInvalid) {
		t.Errorf("active role's instruction without text: err = %v, want ErrInvalid", err)
	}
	// Oracle: developer ruling 05.11.2026 — „Rollenauswahl" may show the
	// active role's card alone.
	p = valid()
	p.RoleEntries = []RoleEntry{}
	if err := Validate(p, "chat", roles("summary", "it", "filecheck")); err != nil {
		t.Errorf("roles start with the active role alone: %v", err)
	}
	// Rune limits: a question of MaxQuestionRunes multi-byte runes passes.
	p = valid()
	p.FixedQuestions[0] = strings.Repeat("ä", MaxQuestionRunes)
	if err := Validate(p, "chat", roles("summary", "it", "filecheck")); err != nil {
		t.Errorf("at the rune limit: %v", err)
	}
}

// Oracle: developer rulings 05.11.2026 — how a chat starts is the roles':
// the page shows the active role's start (its own, else its template's), or
// the choice of roles with further cards; StartMode only names that.
func TestModeOf(t *testing.T) {
	p := Default()
	if got := ModeOf(p, "summary"); got != StartTask {
		t.Errorf("Zusammenfassen's template = %q, want task", got)
	}
	if got := ModeOf(p, "filecheck"); got != StartUpload {
		t.Errorf("Datei prüfen's template = %q, want upload", got)
	}
	if got := ModeOf(p, "chat"); got != StartInput {
		t.Errorf("chat = %q, want input", got)
	}
	p.RoleStarts = map[string]EntryStart{"summary": DefaultStart()}
	if got := ModeOf(p, "summary"); got != StartInput {
		t.Errorf("own input start over the template = %q, want input", got)
	}
	p.RoleEntries = []RoleEntry{{ID: "re-1", RoleID: "chat"}}
	if got := ModeOf(p, "summary"); got != StartRoles {
		t.Errorf("with a card = %q, want roles", got)
	}
}

// Oracle: developer rulings 05.11.2026 — a page saved before starts were the
// roles' keeps what members saw: its upload becomes the active role's file
// start, its questions the active role's; settling again changes nothing.
func TestSettle_MovesThePagesOwnStartToTheActiveRole(t *testing.T) {
	up := Default()
	up.Version = legacyVersion
	up.StartMode, up.UploadLabel, up.UploadInstruction = StartUpload, "Antrag hochladen", "Prüfe den Antrag."
	got := Settle(up, "chat")
	if s := got.RoleStarts["chat"]; s.Kind != EntryFile || s.Text != "Antrag hochladen" || s.Instruction != "Prüfe den Antrag." {
		t.Errorf("upload = %+v", s)
	}
	if got.StartMode != StartUpload || got.UploadLabel != "" || got.UploadInstruction != "" {
		t.Errorf("settled upload page = %+v", got)
	}
	if again := Settle(got, "chat"); !reflect.DeepEqual(again, got) {
		t.Errorf("settling again changed it:\n%+v\n%+v", again, got)
	}

	in := Default()
	in.Version = legacyVersion
	in.QuestionsOn, in.QuestionMode, in.FixedQuestions = true, QuestionsFixed, []string{"Wie?"}
	got = Settle(in, "chat")
	if s := got.RoleStarts["chat"]; s.Kind != EntryInput || !s.Suggestions.QuestionsOn || s.Suggestions.FixedQuestions[0] != "Wie?" {
		t.Errorf("questions = %+v", s)
	}
	if got.QuestionsOn || got.StartMode != StartInput {
		t.Errorf("settled input page = %+v", got)
	}
	// Questions under the input field mean nothing for a role starting otherwise.
	if got := Settle(in, "summary"); got.StartMode != StartTask {
		t.Errorf("questions with Zusammenfassen = %+v", got)
	}
	if _, own := Settle(in, "summary").RoleStarts["summary"]; own {
		t.Error("Zusammenfassen keeps its template's start")
	}
	// Questions switched off stay off, whatever the role's template offers.
	off := Default()
	off.Version = legacyVersion
	withQuestions := "c-asks"
	off.RoleStarts = map[string]EntryStart{withQuestions: {Kind: EntryInput, Send: true, Suggestions: Suggestions{QuestionsOn: true, QuestionMode: QuestionsDynamic, DynamicCount: 4}}}
	if s := Settle(off, withQuestions).RoleStarts[withQuestions]; s.Suggestions.QuestionsOn {
		t.Errorf("switched-off questions = %+v, want off", s)
	}
	// Fixed questions kept while switched off move with them (Codex review).
	off.FixedQuestions = []string{"Entwurf?"}
	if s := Settle(off, "chat").RoleStarts["chat"]; s.Suggestions.QuestionsOn || len(s.Suggestions.FixedQuestions) != 1 {
		t.Errorf("kept draft = %+v, want it on the role, still off", s)
	}
}

// Oracle: Codex review — a settled page's StartMode was derived for the role
// active then; with another role active it is no choice to migrate.
func TestSettle_LeavesASettledPageToTheNewActiveRole(t *testing.T) {
	p := Settle(Default(), "filecheck")
	if p.StartMode != StartUpload || p.Version != currentVersion {
		t.Fatalf("Datei prüfen = %s v%d, want upload v%d", p.StartMode, p.Version, currentVersion)
	}
	got := Settle(p, "chat")
	if _, own := got.RoleStarts["chat"]; own || got.StartMode != StartInput {
		t.Errorf("chat after Datei prüfen = %s with its own start %v, want its template's input", got.StartMode, own)
	}
}

// Oracle: switching starter questions off or to dynamic keeps what is stored.
func TestNormalize_KeepsSwitchedOffDataAndDropsEmptyQuestions(t *testing.T) {
	p := valid()
	p.QuestionsOn, p.QuestionMode = false, QuestionsDynamic
	p.FixedQuestions = []string{"  Eins  ", " ", "Zwei"}
	n := Normalize(p)
	if len(n.RoleEntries) != 2 || len(n.FixedQuestions) != 2 || n.FixedQuestions[0] != "Eins" {
		t.Errorf("normalized = %+v", n)
	}
}

func TestEffective(t *testing.T) {
	if got := Effective(nil, "chat", roles()); got.StartMode != StartInput || got.QuestionsOn {
		t.Errorf("nil = %+v, want Default", got)
	}
	p := valid()
	p.RoleStarts["c-gone"] = DefaultStart()
	p.RoleEntries = append(p.RoleEntries[:1], RoleEntry{ID: "re-9", RoleID: "c-gone"}, RoleEntry{ID: "re-8", RoleID: "unset"})
	got := Effective(&p, "chat", roles("summary", "it", "filecheck", "unset"))
	// A card of a role without a start stays: it starts with the input field.
	if len(got.RoleEntries) != 2 || got.RoleEntries[0].RoleID != "summary" || got.RoleEntries[1].RoleID != "unset" {
		t.Errorf("only cards of a deleted role drop out: %+v", got.RoleEntries)
	}
	if _, ok := got.RoleStarts["c-gone"]; ok {
		t.Error("the start of a deleted role must drop out")
	}
	if got.StartOf("summary").Kind != EntryTask || got.StartOf("unset").Kind != EntryInput {
		t.Errorf("StartOf: set up %q, not set up %q", got.StartOf("summary").Kind, got.StartOf("unset").Kind)
	}
	// Stored before roles were unique: a repeat and the active role's card drop out.
	p = valid()
	p.RoleEntries = append(p.RoleEntries, RoleEntry{ID: "re-3", RoleID: "summary"}, RoleEntry{ID: "re-4", RoleID: "filecheck"})
	got = Effective(&p, "it", roles("summary", "it", "filecheck"))
	if len(got.RoleEntries) != 2 || got.RoleEntries[0].ID != "re-1" || got.RoleEntries[1].ID != "re-4" {
		t.Errorf("each role once, the active one not at all: %+v", got.RoleEntries)
	}
	// The last further role gone: the page starts as the active role does
	// (developer ruling 05.11.2026) — chat, with the input field.
	p = valid()
	got = Effective(&p, "chat", roles())
	if len(got.RoleEntries) != 0 || got.StartMode != StartInput {
		t.Errorf("without a further role = %s with %d cards, want input", got.StartMode, len(got.RoleEntries))
	}
}

type fakePages struct {
	saved *StartPage
}

func (f *fakePages) Load(context.Context, string) (*StartPage, error) { return f.saved, nil }
func (f *fakePages) Save(_ context.Context, _ string, p StartPage) error {
	f.saved = &p
	return nil
}

type fakeBehavior struct{ missing bool }

func (f fakeBehavior) Load(_ context.Context, kbID string) (kbbehavior.Settings, error) {
	if f.missing {
		return kbbehavior.Settings{}, fmt.Errorf("kb %s: %w", kbID, store.ErrNotFound)
	}
	return kbbehavior.Settings{Behavior: kbbehavior.Default()}, nil
}

func put(t *testing.T, h *Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/api/kb/kb-1/start-page", strings.NewReader(body))
	req.SetPathValue("id", "kb-1")
	rec := httptest.NewRecorder()
	h.Put(rec, req)
	return rec
}

func TestHandler(t *testing.T) {
	pages := &fakePages{}
	h := &Handler{pages: pages, behavior: fakeBehavior{}}

	body, _ := json.Marshal(valid())
	rec := put(t, h, string(body))
	if rec.Code != http.StatusOK || pages.saved == nil {
		t.Fatalf("valid: %d %s", rec.Code, rec.Body)
	}
	var resp response
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil || !resp.Configured || len(resp.StartPage.RoleEntries) != 2 {
		t.Fatalf("response = %+v (%v)", resp, err)
	}

	pages.saved = nil
	bad := valid()
	bad.RoleEntries[0].RoleID = "c-gone"
	body, _ = json.Marshal(bad)
	if rec := put(t, h, string(body)); rec.Code != http.StatusBadRequest || pages.saved != nil {
		t.Errorf("unknown role: %d, saved=%v", rec.Code, pages.saved)
	}

	h.behavior = fakeBehavior{missing: true}
	body, _ = json.Marshal(valid())
	if rec := put(t, h, string(body)); rec.Code != http.StatusNotFound {
		t.Errorf("missing KB: %d", rec.Code)
	}
}

// A card stored before card suggestions existed reads as off, dynamic 4.
func TestNormalize_FillsCardSuggestionsOfOlderPages(t *testing.T) {
	p := valid()
	setStart(&p, "summary", func(e *EntryStart) { e.Suggestions = Suggestions{} })
	got := Normalize(p).RoleStarts["summary"].Suggestions
	if got.QuestionsOn || got.QuestionMode != QuestionsDynamic || got.DynamicCount != 4 || got.FixedQuestions == nil {
		t.Errorf("filled = %+v", got)
	}
}

// Oracle: a template's start follows a shown role card's rules in both
// languages — a task needs its text, the English one falling back to German.
func TestValidateTemplateStart(t *testing.T) {
	s := kbbehavior.TemplateStart{
		Kind: EntryTask, Text: kbbehavior.Texts{DE: "Fasse zusammen"}, Send: true,
		Suggestions: kbbehavior.TemplateSuggestions{QuestionMode: QuestionsDynamic, DynamicCount: 4},
	}
	if err := ValidateTemplateStart(s); err != nil {
		t.Fatalf("valid start: %v", err)
	}
	s.Text = kbbehavior.Texts{}
	if err := ValidateTemplateStart(s); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a task without text: got %v", err)
	}
	s.Text = kbbehavior.Texts{DE: "ok", EN: strings.Repeat("x", MaxQuestionRunes+1)}
	if err := ValidateTemplateStart(s); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a long English text: got %v", err)
	}
	s = kbbehavior.TemplateStart{Kind: "roles", Suggestions: kbbehavior.TemplateSuggestions{QuestionMode: QuestionsDynamic, DynamicCount: 4}}
	if err := ValidateTemplateStart(s); !errors.Is(err, ErrInvalid) {
		t.Fatalf("the role selection is no role's start: got %v", err)
	}
}
