package kbassistant

import (
	"errors"
	"testing"

	"github.com/justrag/go-backend/internal/kbbehavior"
	"github.com/justrag/go-backend/internal/kbstartpage"
)

func snap(mut func(*Snapshot)) Snapshot {
	b := kbbehavior.Default()
	p := kbstartpage.Default()
	s := Snapshot{Title: "KB", Behavior: &b, StartPage: &p}
	if mut != nil {
		mut(&s)
	}
	return s
}

func noCategory(*string) string { return "" }

func fields(cs []Change) map[string]Change {
	m := map[string]Change{}
	for _, c := range cs {
		m[c.Field] = c
	}
	return m
}

func TestDiff_NoChange(t *testing.T) {
	if got := diff(snap(nil), snap(nil), "de", noCategory); len(got) != 0 {
		t.Fatalf("identical snapshots: %+v", got)
	}
}

func TestDiff_StartAndBehaviorFields(t *testing.T) {
	a := snap(nil)
	b := snap(func(s *Snapshot) {
		s.Title = "Neu"
		s.StartPage.Colors = &kbstartpage.Colors{From: "#112233", To: "#445566"}
		s.StartPage.StartMode = kbstartpage.StartRoles
		s.StartPage.RoleStarts = map[string]kbstartpage.EntryStart{"tutor": {Kind: kbstartpage.EntryTask, Text: "Erkläre", Send: true}}
		s.StartPage.RoleEntries = []kbstartpage.RoleEntry{{ID: "c1", RoleID: "tutor"}}
		s.Behavior.ActiveRoleID = "editor"
		set := kbbehavior.DefaultRules()
		set.Rules["pages"] = false
		set.CustomRules = []kbbehavior.CustomRule{{ID: "r1", Text: "Sei nett", On: true}}
		s.Behavior.CustomRoles = append(s.Behavior.CustomRoles, kbbehavior.Role{ID: "c-9", Name: "Eigene", Prompt: "P"})
		s.Behavior.RoleRules = map[string]kbbehavior.RuleSet{"c-9": set}
	})
	got := fields(diff(a, b, "de", noCategory))
	for _, f := range []string{"title", "colors", "startMode", "roleEntry", "roleStart", "activeRole", "rule", "customRule"} {
		if _, ok := got[f]; !ok {
			t.Errorf("missing change %q in %+v", f, got)
		}
	}
	if c := got["title"]; *c.From != "KB" || *c.To != "Neu" || c.Area != AreaStart {
		t.Errorf("title change = %+v", c)
	}
	if c := got["roleEntry"]; c.Added == nil || *c.Added != "Tutor" {
		t.Errorf("role entry change = %+v", c)
	}
	// A start set up in „Verhalten": from none to the task.
	if c := got["roleStart"]; c.Area != AreaBehavior || c.Ref != "Tutor" || *c.From != "" || *c.To != "task: Erkläre" {
		t.Errorf("role start change = %+v", c)
	}
	if c := got["rule"]; c.Area != AreaBehavior || c.Ref == "" || *c.To != "off" {
		t.Errorf("rule change = %+v", c)
	}
}

// Oracle: per-role suggestions (developer ruling 27.10.2026) — a change to
// one card's suggestions is one change named after that card's role.
func TestDiff_RoleSuggestions(t *testing.T) {
	start := kbstartpage.DefaultStart()
	a := snap(func(s *Snapshot) { s.StartPage.RoleStarts = map[string]kbstartpage.EntryStart{"tutor": start} })
	b := snap(func(s *Snapshot) {
		c := start
		c.Suggestions = kbstartpage.Suggestions{QuestionsOn: true, QuestionMode: kbstartpage.QuestionsFixed, DynamicCount: 4, FixedQuestions: []string{"Wie?", "Wann?"}}
		s.StartPage.RoleStarts = map[string]kbstartpage.EntryStart{"tutor": c}
	})
	got := diff(a, b, "de", noCategory)
	if len(got) != 1 || got[0].Field != "roleSuggestions" || got[0].Ref != "Tutor" || *got[0].From != "off" || *got[0].To != "fixed: Wie? | Wann?" {
		t.Fatalf("role suggestions = %+v", got)
	}
}

// Oracle: the bug of 27.10.2026 — switching a further card from the input
// field to a file start (no text) changed nothing the list could name, so
// the save was dropped. It is a change of that card's start now.
func TestDiff_RoleEntryKind(t *testing.T) {
	start := kbstartpage.DefaultStart()
	a := snap(func(s *Snapshot) { s.StartPage.RoleStarts = map[string]kbstartpage.EntryStart{"tutor": start} })
	b := snap(func(s *Snapshot) {
		c := start
		c.Kind = kbstartpage.EntryFile
		s.StartPage.RoleStarts = map[string]kbstartpage.EntryStart{"tutor": c}
	})
	got := diff(a, b, "de", noCategory)
	if len(got) != 1 || got[0].Field != "roleStart" || got[0].Ref != "Tutor" || *got[0].From != "input" {
		t.Fatalf("kind change = %+v", got)
	}
}

// Oracle: a save is skipped only when the settings read the same — also an
// edit the change list has no field for (a role's icon) is saved.
func TestSameSnapshot(t *testing.T) {
	a := snap(func(s *Snapshot) {
		s.Behavior.CustomRoles = []kbbehavior.Role{{ID: "c1", Name: "Eigene", Icon: "user"}}
	})
	b := snap(func(s *Snapshot) {
		s.Behavior.CustomRoles = []kbbehavior.Role{{ID: "c1", Name: "Eigene", Icon: "book"}}
	})
	if !sameSnapshot(a, a, "de") {
		t.Error("a snapshot must equal itself")
	}
	if sameSnapshot(a, b, "de") {
		t.Error("an icon change must count as a change")
	}
}

// Oracle: a pure reorder is one change, not an add plus a remove.
func TestDiff_FixedQuestionsReorder(t *testing.T) {
	a := snap(func(s *Snapshot) { s.StartPage.FixedQuestions = []string{"A", "B"} })
	b := snap(func(s *Snapshot) { s.StartPage.FixedQuestions = []string{"B", "A"} })
	got := diff(a, b, "de", noCategory)
	if len(got) != 1 || got[0].Field != "fixedQuestionsOrder" {
		t.Fatalf("reorder = %+v", got)
	}
	c := snap(func(s *Snapshot) { s.StartPage.FixedQuestions = []string{"B", "C"} })
	got = diff(a, c, "de", noCategory)
	f := fields(got)
	if len(got) != 2 || f["fixedQuestion"].Field == "" {
		t.Fatalf("add+remove = %+v", got)
	}
}

// Oracle: the legacy (uncustomized) baseline diffs against its effective
// form, so switching to a template role reads as an activeRole change.
func TestDiff_LegacyBaseline(t *testing.T) {
	legacy := "Du bist X."
	a := Snapshot{Title: "KB", SystemPrompt: &legacy}
	b := snap(nil)
	f := fields(diff(a, b, "de", noCategory))
	if _, ok := f["activeRole"]; !ok {
		t.Fatalf("legacy → default: %+v", f)
	}
}

func TestSnapshotOf_Validates(t *testing.T) {
	ok := Input{Title: "  KB  ", Behavior: kbbehavior.Default(), StartPage: kbstartpage.Default()}
	s, err := snapshotOf(ok)
	if err != nil || s.Title != "KB" || s.Description != nil {
		t.Fatalf("valid input: %+v %v", s, err)
	}
	empty := "   "
	ok.Description = &empty
	if s, _ := snapshotOf(ok); s.Description != nil {
		t.Error("blank description must store as NULL")
	}

	bad := ok
	bad.Title = " "
	if _, err := snapshotOf(bad); !errors.Is(err, ErrInvalid) {
		t.Errorf("empty title: %v", err)
	}
	// A card for a role the behavior saved with it does not have.
	bad = ok
	bad.StartPage.StartMode = kbstartpage.StartRoles
	bad.StartPage.RoleStarts = map[string]kbstartpage.EntryStart{"nope": kbstartpage.DefaultStart()}
	bad.StartPage.RoleEntries = []kbstartpage.RoleEntry{{ID: "c1", RoleID: "nope"}}
	if _, err := snapshotOf(bad); !errors.Is(err, ErrInvalid) {
		t.Errorf("unknown role card: %v", err)
	}
}
