package ai

import (
	"errors"
	"testing"
)

// Oracle: the json_object downgrade may wrap the object in prose or a code
// fence; the strict path answers bare JSON.
func TestParseJSONObjectLoose(t *testing.T) {
	for _, in := range []string{
		`{"name":"Tutor","prompt":"Du bist …"}`,
		"Hier ist die Rolle:\n```json\n{\"name\":\"Tutor\",\"prompt\":\"Du bist …\"}\n```",
	} {
		var out RoleDraft
		if err := parseJSONObjectLoose(in, &out); err != nil || out.Name != "Tutor" || out.Prompt != "Du bist …" {
			t.Errorf("%q → %+v, %v", in, out, err)
		}
	}
	var out RoleDraft
	if err := parseJSONObjectLoose("keine Rolle", &out); err == nil {
		t.Error("prose without an object must fail")
	}
}

// Oracle: the edit semantics in prompts.RoleRevisePrompt — a passage is
// replaced, an empty find appends a paragraph, text no edit names stays
// byte-identical, and a passage found nowhere fails the whole revision.
func TestApplyRoleEdits(t *testing.T) {
	prompt := "Du prüfst Dokumente.\nGleiche sie ab.\n\nVorgehen: Nenne zuerst, ob es vollständig ist."
	cases := []struct {
		name  string
		edits []roleEdit
		want  string
		err   error
	}{
		{"insert after a passage", []roleEdit{{Find: "Gleiche sie ab.", Replace: "Gleiche sie ab.\nAchte auf Fristen."}},
			"Du prüfst Dokumente.\nGleiche sie ab.\nAchte auf Fristen.\n\nVorgehen: Nenne zuerst, ob es vollständig ist.", nil},
		{"append a paragraph", []roleEdit{{Find: "", Replace: "Fristen: nenne sie.\n"}},
			prompt + "\n\nFristen: nenne sie.", nil},
		{"passage re-wrapped by the model", []roleEdit{{Find: "Du prüfst Dokumente. Gleiche sie ab.", Replace: "Du prüfst Anträge."}},
			"Du prüfst Anträge.\n\nVorgehen: Nenne zuerst, ob es vollständig ist.", nil},
		{"remove a passage", []roleEdit{{Find: "Gleiche sie ab.", Replace: ""}},
			"Du prüfst Dokumente.\n\nVorgehen: Nenne zuerst, ob es vollständig ist.", nil},
		{"passage not in the prompt", []roleEdit{{Find: "Gleiche sie ab.", Replace: "x"}, {Find: "Gibt es nicht.", Replace: "y"}}, "", ErrRoleEditNotFound},
		{"no edits", nil, "", ErrRoleUnchanged},
		{"everything removed", []roleEdit{{Find: prompt, Replace: ""}}, "", ErrEmptyRoleDraft},
	}
	for _, c := range cases {
		got, err := applyRoleEdits(prompt, c.edits)
		if got != c.want || !errors.Is(err, c.err) {
			t.Errorf("%s: got %q, %v; want %q, %v", c.name, got, err, c.want, c.err)
		}
	}
}
