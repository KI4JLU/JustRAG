package kbassistant

import (
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/justrag/go-backend/internal/kbbehavior"
	"github.com/justrag/go-backend/internal/kbstartpage"
)

// Area values of a Change: the settings section it belongs to.
const (
	AreaStart    = "start"
	AreaBehavior = "behavior"
)

// Change is one field change of a version against the version before it.
// Field is a stable code the client turns into a label; From/To (a value
// changed), Added/Removed (a list item) are display values resolved at save
// time — role and rule names in the KB's language, so a role deleted later
// still reads right. Ref names the item a change is about (a rule's label, a
// role's name). Codes and value forms are listed in API.md.
type Change struct {
	Area    string  `json:"area"`
	Field   string  `json:"field"`
	Ref     string  `json:"ref,omitempty"`
	From    *string `json:"from,omitempty"`
	To      *string `json:"to,omitempty"`
	Added   *string `json:"added,omitempty"`
	Removed *string `json:"removed,omitempty"`
}

func sp(s string) *string { return &s }

func onOff(b bool) string {
	if b {
		return "on"
	}
	return "off"
}

// view is a snapshot in its effective (displayed) form.
type view struct {
	snap     Snapshot
	behavior kbbehavior.Behavior
	start    kbstartpage.StartPage
}

// viewOf names the legacy role after kbName — the same name for both sides of
// a diff, so a rename never reads as a role change.
func viewOf(s Snapshot, kbName, lang string) view {
	b := kbbehavior.Effective(s.Behavior, s.SystemPrompt, kbName, lang)
	return view{snap: s, behavior: b, start: kbstartpage.Effective(s.StartPage, b.ActiveRoleID, b.HasRole)}
}

// diff lists what changed from a to b. categoryName resolves a category id.
func diff(a, b Snapshot, lang string, categoryName func(*string) string) []Change {
	va, vb := viewOf(a, b.Title, lang), viewOf(b, b.Title, lang)
	var out []Change
	value := func(area, field, ref, from, to string) {
		if from != to {
			out = append(out, Change{Area: area, Field: field, Ref: ref, From: sp(from), To: sp(to)})
		}
	}
	list := func(area, field string, from, to []string) {
		for _, x := range to {
			if !slices.Contains(from, x) {
				out = append(out, Change{Area: area, Field: field, Added: sp(x)})
			}
		}
		for _, x := range from {
			if !slices.Contains(to, x) {
				out = append(out, Change{Area: area, Field: field, Removed: sp(x)})
			}
		}
	}

	// --- Startseite
	value(AreaStart, "title", "", a.Title, b.Title)
	value(AreaStart, "description", "", deref(a.Description), deref(b.Description))
	value(AreaStart, "category", "", categoryName(a.CategoryID), categoryName(b.CategoryID))
	sa, sb := va.start, vb.start
	value(AreaStart, "colors", "", colorsValue(sa.Colors), colorsValue(sb.Colors))
	value(AreaStart, "startMode", "", sa.StartMode, sb.StartMode)
	value(AreaStart, "questionsOn", "", onOff(sa.QuestionsOn), onOff(sb.QuestionsOn))
	value(AreaStart, "questionMode", "", sa.QuestionMode, sb.QuestionMode)
	value(AreaStart, "dynamicCount", "", fmt.Sprint(sa.DynamicCount), fmt.Sprint(sb.DynamicCount))
	list(AreaStart, "fixedQuestion", sa.FixedQuestions, sb.FixedQuestions)
	// Same questions in another order: a reorder, which the list diff misses.
	sameSet := len(sa.FixedQuestions) == len(sb.FixedQuestions)
	for _, q := range sa.FixedQuestions {
		sameSet = sameSet && slices.Contains(sb.FixedQuestions, q)
	}
	if sameSet && !slices.Equal(sa.FixedQuestions, sb.FixedQuestions) {
		out = append(out, Change{Area: AreaStart, Field: "fixedQuestionsOrder"})
	}
	value(AreaStart, "uploadLabel", "", sa.UploadLabel, sb.UploadLabel)
	value(AreaStart, "uploadInstruction", "", sa.UploadInstruction, sb.UploadInstruction)
	cards := func(v view) []string {
		var s []string
		for _, e := range v.start.RoleEntries {
			s = append(s, kbbehavior.RoleName(v.behavior, e.RoleID, lang))
		}
		return s
	}
	list(AreaStart, "roleEntry", cards(va), cards(vb))

	// How each role starts its chat, set up per role in „Verhalten": "" where
	// a side has none set up.
	startIDs := map[string]bool{}
	for id := range sa.RoleStarts {
		startIDs[id] = true
	}
	for id := range sb.RoleStarts {
		startIDs[id] = true
	}
	for _, id := range slices.Sorted(maps.Keys(startIDs)) {
		name := kbbehavior.RoleName(vb.behavior, id, lang)
		if name == "" {
			name = kbbehavior.RoleName(va.behavior, id, lang)
		}
		ea, okA := sa.RoleStarts[id]
		eb, okB := sb.RoleStarts[id]
		from, to := "", ""
		if okA {
			from = entrySummary(ea)
		}
		if okB {
			to = entrySummary(eb)
		}
		value(AreaBehavior, "roleStart", name, from, to)
		if okA && okB {
			value(AreaBehavior, "roleSuggestions", name, suggestionsValue(ea.Suggestions), suggestionsValue(eb.Suggestions))
		}
	}

	// --- Verhalten
	value(AreaBehavior, "activeRole", "",
		kbbehavior.RoleName(va.behavior, va.behavior.ActiveRoleID, lang),
		kbbehavior.RoleName(vb.behavior, vb.behavior.ActiveRoleID, lang))
	roleNames := func(v view) map[string]kbbehavior.Role {
		m := map[string]kbbehavior.Role{}
		for _, r := range v.behavior.CustomRoles {
			m[r.ID] = r
		}
		return m
	}
	ra, rb := roleNames(va), roleNames(vb)
	for _, r := range vb.behavior.CustomRoles {
		old, ok := ra[r.ID]
		switch {
		case !ok:
			out = append(out, Change{Area: AreaBehavior, Field: "customRole", Added: sp(r.Name)})
		case old.Name != r.Name || old.Prompt != r.Prompt || old.Description != r.Description || old.Icon != r.Icon:
			out = append(out, Change{Area: AreaBehavior, Field: "customRoleEdited", Ref: r.Name})
		}
	}
	for _, r := range va.behavior.CustomRoles {
		if _, ok := rb[r.ID]; !ok {
			out = append(out, Change{Area: AreaBehavior, Field: "customRole", Removed: sp(r.Name)})
		}
	}
	// Rules are per role: compare every role that has a set of its own on
	// either side (both sides of the others answer with the same default).
	var ruleRoles []string
	for _, v := range []view{va, vb} {
		for id := range v.behavior.RoleRules {
			if !slices.Contains(ruleRoles, id) {
				ruleRoles = append(ruleRoles, id)
			}
		}
	}
	slices.Sort(ruleRoles)
	for _, roleID := range ruleRoles {
		role := kbbehavior.RoleName(vb.behavior, roleID, lang)
		if role == "" {
			role = kbbehavior.RoleName(va.behavior, roleID, lang)
		}
		inRole := func(s string) string { return s + " (" + role + ")" }
		sa, sb := kbbehavior.RulesFor(va.behavior, roleID), kbbehavior.RulesFor(vb.behavior, roleID)
		for _, id := range kbbehavior.RuleIDs() {
			value(AreaBehavior, "rule", inRole(kbbehavior.RuleLabel(id, lang)), onOff(sa.Rules[id]), onOff(sb.Rules[id]))
		}
		rulesOf := func(set kbbehavior.RuleSet) map[string]kbbehavior.CustomRule {
			m := map[string]kbbehavior.CustomRule{}
			for _, r := range set.CustomRules {
				m[r.ID] = r
			}
			return m
		}
		ca, cb := rulesOf(sa), rulesOf(sb)
		for _, r := range sb.CustomRules {
			old, ok := ca[r.ID]
			switch {
			case !ok:
				out = append(out, Change{Area: AreaBehavior, Field: "customRule", Ref: role, Added: sp(r.Text)})
			case old.Text != r.Text:
				out = append(out, Change{Area: AreaBehavior, Field: "customRuleText", Ref: role, From: sp(old.Text), To: sp(r.Text)})
			case old.On != r.On:
				out = append(out, Change{Area: AreaBehavior, Field: "customRuleToggled", Ref: inRole(r.Text), From: sp(onOff(old.On)), To: sp(onOff(r.On))})
			}
		}
		for _, r := range sa.CustomRules {
			if _, ok := cb[r.ID]; !ok {
				out = append(out, Change{Area: AreaBehavior, Field: "customRule", Ref: role, Removed: sp(r.Text)})
			}
		}
	}
	if out == nil {
		out = []Change{}
	}
	return out
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// entrySummary is how a role card starts, as one comparable value:
// "input", "task: <text>", "task (prefill): <text>" or "file: <label>".
func entrySummary(e kbstartpage.EntryStart) string {
	switch e.Kind {
	case kbstartpage.EntryTask:
		if e.Send {
			return "task: " + e.Text
		}
		return "task (prefill): " + e.Text
	case kbstartpage.EntryFile:
		return "file: " + e.Text + " " + e.Instruction
	default:
		return e.Kind
	}
}

// suggestionsValue is a card's suggestions as one comparable value: "off",
// "dynamic <n>" or "fixed: <q1> | <q2>".
func suggestionsValue(s kbstartpage.Suggestions) string {
	switch {
	case !s.QuestionsOn:
		return "off"
	case s.QuestionMode == kbstartpage.QuestionsFixed:
		return "fixed: " + strings.Join(s.FixedQuestions, " | ")
	default:
		return fmt.Sprintf("dynamic %d", s.DynamicCount)
	}
}

// colorsValue is the colours as a diff value: "#FROM #TO", "" for none.
func colorsValue(c *kbstartpage.Colors) string {
	if c == nil {
		return ""
	}
	return c.From + " " + c.To
}
