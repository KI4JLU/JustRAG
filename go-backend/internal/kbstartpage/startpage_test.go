package kbstartpage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
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
		"tutor": {Kind: EntryTask, Text: "Erkläre mir die Elternzeit", Send: true, Suggestions: DefaultSuggestions()},
		"admin": {Kind: EntryFile, Text: "Antrag prüfen", Instruction: "Prüfe den Antrag.", Suggestions: DefaultSuggestions()},
		// Set up, not on the page: a draft may be unfinished.
		"editor": {Kind: EntryTask, Suggestions: DefaultSuggestions()},
	}
	p.RoleEntries = []RoleEntry{{ID: "re-1", RoleID: "tutor"}, {ID: "re-2", RoleID: "admin"}}
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
	if err := Validate(d, "research", roles()); err != nil {
		t.Fatal(err)
	}
	// Oracle: brief v2 §2.2 — input field, starter questions off.
	if d.StartMode != StartInput || d.QuestionsOn || d.Colors == nil || *d.Colors != *DefaultColors() {
		t.Errorf("default = %+v", d)
	}
}

func TestValidate(t *testing.T) {
	if err := Validate(valid(), "research", roles("tutor", "admin", "editor")); err != nil {
		t.Fatalf("valid: %v", err)
	}
	long := strings.Repeat("ä", MaxQuestionRunes+1)
	cases := map[string]func(*StartPage){
		"version":            func(p *StartPage) { p.Version = 2 },
		"colors":             func(p *StartPage) { p.Colors = &Colors{From: "#fff", To: "#000000"} },
		"start mode":         func(p *StartPage) { p.StartMode = "voice" },
		"unknown role":       func(p *StartPage) { p.RoleEntries[0].RoleID = "c-gone" },
		"unknown start role": func(p *StartPage) { p.RoleStarts["c-gone"] = DefaultStart() },
		"too many cards":     func(p *StartPage) { p.RoleEntries = append(p.RoleEntries, p.RoleEntries[0], p.RoleEntries[0]) },
		"duplicate card":     func(p *StartPage) { p.RoleEntries[1].ID = "re-1" },
		"bad card id":        func(p *StartPage) { p.RoleEntries[0].ID = "a b" },
		"role twice":         func(p *StartPage) { p.RoleEntries[1].RoleID = "tutor" },
		"bad kind": func(p *StartPage) {
			p.RoleStarts["editor"] = EntryStart{Kind: "voice", Suggestions: DefaultSuggestions()}
		},
		"long card text": func(p *StartPage) { setStart(p, "tutor", func(e *EntryStart) { e.Text = long }) },
		"empty task":     func(p *StartPage) { setStart(p, "tutor", func(e *EntryStart) { e.Text = " " }) },
		"long instruction": func(p *StartPage) {
			setStart(p, "admin", func(e *EntryStart) { e.Instruction = strings.Repeat("x", MaxInstructionRunes+1) })
		},
		"roles, one role": func(p *StartPage) { p.RoleEntries = []RoleEntry{} },
		"question mode":   func(p *StartPage) { p.QuestionMode = "random" },
		"dynamic count":   func(p *StartPage) { p.DynamicCount = 5 },
		"too many fixed":  func(p *StartPage) { p.FixedQuestions = make([]string, MaxFixedQuestions+1) },
		"long fixed":      func(p *StartPage) { p.FixedQuestions[0] = long },
		"card question mode": func(p *StartPage) {
			setStart(p, "tutor", func(e *EntryStart) { e.Suggestions.QuestionMode = "random" })
		},
		"card fixed long": func(p *StartPage) {
			setStart(p, "editor", func(e *EntryStart) { e.Suggestions.FixedQuestions = []string{long} })
		},
		"long upload label": func(p *StartPage) { p.UploadLabel = strings.Repeat("x", MaxUploadLabelRunes+1) },
	}
	for name, mutate := range cases {
		p := valid()
		mutate(&p)
		if err := Validate(p, "research", roles("tutor", "admin", "editor")); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", name, err)
		}
	}
	// The active role shows first on its own: no card of it.
	if err := Validate(valid(), "tutor", roles("tutor", "admin", "editor")); !errors.Is(err, ErrInvalid) {
		t.Errorf("a card of the active role: err = %v, want ErrInvalid", err)
	}
	// Outside the "roles" mode an unfinished card stays a draft: switching
	// modes never loses it (brief v2 §2.2, "settings of all modes are kept").
	p := valid()
	p.StartMode = StartInput
	setStart(&p, "tutor", func(e *EntryStart) { e.Text = "" })
	if err := Validate(p, "research", roles("tutor", "admin", "editor")); err != nil {
		t.Errorf("draft cards outside roles mode: %v", err)
	}
	// Rune limits: a question of MaxQuestionRunes multi-byte runes passes.
	p = valid()
	p.FixedQuestions[0] = strings.Repeat("ä", MaxQuestionRunes)
	if err := Validate(p, "research", roles("tutor", "admin", "editor")); err != nil {
		t.Errorf("at the rune limit: %v", err)
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
	if got := Effective(nil, "research", roles()); got.StartMode != StartInput || got.QuestionsOn {
		t.Errorf("nil = %+v, want Default", got)
	}
	p := valid()
	p.RoleStarts["c-gone"] = DefaultStart()
	p.RoleEntries = append(p.RoleEntries[:1], RoleEntry{ID: "re-9", RoleID: "c-gone"}, RoleEntry{ID: "re-8", RoleID: "unset"})
	got := Effective(&p, "research", roles("tutor", "admin", "editor", "unset"))
	// A card of a role without a start stays: it starts with the input field.
	if len(got.RoleEntries) != 2 || got.RoleEntries[0].RoleID != "tutor" || got.RoleEntries[1].RoleID != "unset" {
		t.Errorf("only cards of a deleted role drop out: %+v", got.RoleEntries)
	}
	if _, ok := got.RoleStarts["c-gone"]; ok {
		t.Error("the start of a deleted role must drop out")
	}
	if got.StartOf("tutor").Kind != EntryTask || got.StartOf("unset").Kind != EntryInput {
		t.Errorf("StartOf: set up %q, not set up %q", got.StartOf("tutor").Kind, got.StartOf("unset").Kind)
	}
	// Stored before roles were unique: a repeat and the active role's card drop out.
	p = valid()
	p.RoleEntries = append(p.RoleEntries, RoleEntry{ID: "re-3", RoleID: "tutor"}, RoleEntry{ID: "re-4", RoleID: "editor"})
	got = Effective(&p, "admin", roles("tutor", "admin", "editor"))
	if len(got.RoleEntries) != 2 || got.RoleEntries[0].ID != "re-1" || got.RoleEntries[1].ID != "re-4" {
		t.Errorf("each role once, the active one not at all: %+v", got.RoleEntries)
	}
	// The last further role gone: one role leaves nothing to choose.
	p = valid()
	got = Effective(&p, "research", roles())
	if len(got.RoleEntries) != 0 || got.StartMode != StartInput {
		t.Errorf("roles start without a further role = %s with %d cards, want input", got.StartMode, len(got.RoleEntries))
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
	setStart(&p, "tutor", func(e *EntryStart) { e.Suggestions = Suggestions{} })
	got := Normalize(p).RoleStarts["tutor"].Suggestions
	if got.QuestionsOn || got.QuestionMode != QuestionsDynamic || got.DynamicCount != 4 || got.FixedQuestions == nil {
		t.Errorf("filled = %+v", got)
	}
}
