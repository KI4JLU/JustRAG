package kbbehavior

import (
	"errors"
	"strings"
	"testing"
)

func strp(s string) *string { return &s }

// Oracle: the pre-roles contract — an uncustomized KB's prompt is its
// system_prompt byte for byte, so Compile over Effective(nil, sp) must
// return sp unchanged, including whitespace and an empty prompt.
func TestCompile_UncustomizedIsTheLegacyPromptByteForByte(t *testing.T) {
	for _, sp := range []*string{nil, strp(""), strp("Du bist X.\n\n  Antworte kurz.  \n"), strp(strings.Repeat("ä", 8000))} {
		for _, lang := range []string{"de", "en"} {
			got, found := Compile(Effective(nil, sp, "", lang), "", lang)
			want := ""
			if sp != nil {
				want = *sp
			}
			if got != want || !found {
				t.Errorf("sp=%v lang=%s: got %q found=%v, want %q", sp, lang, got, found, want)
			}
		}
	}
}

func TestEffective_UncustomizedShowsTheLegacyRoleActive(t *testing.T) {
	eff := Effective(nil, strp("alt"), "Personalrecht", "de")
	if eff.ActiveRoleID != LegacyRoleID || len(eff.CustomRoles) != 1 {
		t.Fatalf("got %+v", eff)
	}
	r := eff.CustomRoles[0]
	if r.ID != LegacyRoleID || r.Name != "Bisheriger Prompt" || r.Prompt != "alt" {
		t.Errorf("legacy role = %+v", r)
	}
	if set := RulesFor(eff, LegacyRoleID); len(eff.RoleRules) != 0 || len(set.Rules) != 0 || len(set.CustomRules) != 0 {
		t.Errorf("no rule may be on: %+v", eff)
	}
	if Effective(nil, strp("alt"), "", "en").CustomRoles[0].Name != "Previous prompt" {
		t.Error("legacy role name must follow the prompt language")
	}
}

// Without a legacy prompt the role is the KB answering from its sources: it
// carries the KB's name (developer ruling 27.10.2026), the generic name only
// when the KB has none.
func TestEffective_EmptyLegacyRoleIsNamedAfterTheKB(t *testing.T) {
	r := Effective(nil, nil, " Personalrecht ", "de").CustomRoles[0]
	if r.Name != "Personalrecht" || r.Description != "Durchsucht die bereitgestellten Quellen." || r.Prompt != "" {
		t.Errorf("legacy role = %+v", r)
	}
	if r := Effective(nil, strp(""), "", "en").CustomRoles[0]; r.Name != "Previous prompt" || r.Description != "Searches the provided sources." {
		t.Errorf("legacy role without a KB name = %+v", r)
	}
}

// The author may name and describe the legacy role (developer ruling
// 28.10.2026); the defaults stay as long as they leave them alone, and a
// default sent back unchanged is not frozen as their own.
func TestLegacyRole_OwnNameAndDescription(t *testing.T) {
	b := validBehavior()
	b.CustomRoles[0].Name = "  Kanzlei  "
	b.CustomRoles[0].Description = "Prüft Verträge."
	if err := Validate(b); err != nil {
		t.Fatalf("validate: %v", err)
	}
	stored, legacy := ForStorage(b)
	if got := stored.CustomRoles[0]; got != (Role{ID: LegacyRoleID, Name: "Kanzlei", Description: "Prüft Verträge."}) {
		t.Errorf("stored legacy role = %+v", got)
	}
	r := Effective(&stored, legacy, "KB", "de").CustomRoles[0]
	if r.Name != "Kanzlei" || r.Description != "Prüft Verträge." || r.Prompt != "alt" || r.Icon != legacyIcon {
		t.Errorf("effective legacy role = %+v", r)
	}

	// The defaults as the client got them: nothing of the author's own.
	b = validBehavior()
	b.CustomRoles[0].Name = "Personalrecht"
	b.CustomRoles[0].Description = "Searches the provided sources."
	stored, _ = ForStorage(b)
	DropLegacyDefaults(&stored, "Personalrecht")
	if got := stored.CustomRoles[0]; got != (Role{ID: LegacyRoleID}) {
		t.Errorf("defaults must not be stored: %+v", got)
	}
	if r := Effective(&stored, nil, "Arbeitsrecht", "de").CustomRoles[0]; r.Name != "Arbeitsrecht" {
		t.Errorf("legacy role must follow a rename, got %q", r.Name)
	}

	b = validBehavior()
	b.CustomRoles[0].Description = strings.Repeat("x", MaxRoleDescRunes+1)
	if err := Validate(b); !errors.Is(err, ErrInvalid) {
		t.Errorf("an over-long legacy description must be refused, got %v", err)
	}
}

// Oracle: the order fixed by the settings' preview — role prompt, then the
// rules heading with catalog rules in catalog order, then the KB's own rules.
func TestCompile_RolePromptThenRulesInCatalogOrder(t *testing.T) {
	b := Behavior{
		Version: 1, ActiveRoleID: "c-1",
		CustomRoles: []Role{{ID: "c-1", Name: "Eigene", Prompt: "ROLLE"}},
		RoleRules: map[string]RuleSet{"c-1": {
			Rules:       map[string]bool{"clarify": true, "pages": true, "plain": false},
			CustomRules: []CustomRule{{ID: "r1", Text: "  Eigene Regel.  ", On: true}, {ID: "r2", Text: "aus", On: false}},
		}},
	}
	got, _ := Compile(b, "", "de")
	want := "ROLLE\n\nRegeln:\n" +
		"- Nenne zu jeder zitierten Quelle Seite oder Abschnitt.\n" +
		"- Stelle bei mehrdeutigen Fragen zuerst eine kurze Rückfrage.\n" +
		"- Eigene Regel."
	if got != want {
		t.Errorf("got\n%s\nwant\n%s", got, want)
	}
	gotEN, _ := Compile(b, "", "en")
	if !strings.HasPrefix(gotEN, "ROLLE\n\nRules:\n- Name the page") {
		t.Errorf("en: %q", gotEN)
	}
}

func TestCompile_TemplateRoleAndChatRole(t *testing.T) {
	b := Default()
	rules := "\n\nRegeln:\n- Antworte in der Sprache, in der die Frage gestellt wurde."
	got, found := Compile(b, "", "de")
	research, _ := findTemplateRole("research")
	if !strings.HasPrefix(got, research.prompt.de+rules) || !found {
		t.Errorf("active template: %q", got)
	}
	got, found = Compile(b, "tutor", "de")
	tutor, _ := findTemplateRole("tutor")
	if !strings.HasPrefix(got, tutor.prompt.de+rules) || !found {
		t.Errorf("chat role: %q", got)
	}
	// A role the KB no longer has falls back to the active one.
	got, found = Compile(b, "c-deleted", "de")
	if !strings.HasPrefix(got, research.prompt.de+rules) || found {
		t.Errorf("deleted role: %q found=%v", got, found)
	}
}

func TestCompile_RulesWithoutRolePrompt(t *testing.T) {
	b := Effective(&Behavior{Version: 1, ActiveRoleID: LegacyRoleID, CustomRoles: []Role{{ID: LegacyRoleID}},
		RoleRules: map[string]RuleSet{LegacyRoleID: {Rules: map[string]bool{"pages": true}}}}, nil, "", "de")
	got, _ := Compile(b, "", "de")
	if got != "Regeln:\n- Nenne zu jeder zitierten Quelle Seite oder Abschnitt." {
		t.Errorf("got %q", got)
	}
}

// A catalog rule absent from a role's stored map is off: a rule added to the
// catalog later must not switch itself on in a set someone made.
func TestCompile_MissingRuleIsOff(t *testing.T) {
	b := Behavior{Version: 1, ActiveRoleID: "c-1", CustomRoles: []Role{{ID: "c-1", Name: "E", Prompt: "P"}},
		RoleRules: map[string]RuleSet{"c-1": {Rules: map[string]bool{}}}}
	if got, _ := Compile(b, "", "de"); got != "P" {
		t.Errorf("got %q", got)
	}
}

func TestDefault_IsValidAndUsesCatalogDefaults(t *testing.T) {
	d := Default()
	if err := Validate(d); err != nil {
		t.Fatalf("Default must validate: %v", err)
	}
	if d.ActiveRoleID != DefaultRoleID() {
		t.Errorf("active = %s", d.ActiveRoleID)
	}
	rules := RulesFor(d, d.ActiveRoleID).Rules
	for _, id := range []string{"mirror", "formal", "pages", "clarify"} {
		if !rules[id] {
			t.Errorf("rule %s must default on", id)
		}
	}
	for _, id := range []string{"plain", "examples", "quotes"} {
		if rules[id] {
			t.Errorf("rule %s must default off", id)
		}
	}
}

func TestCatalog_IDsAreUniqueAndDefaultRoleExists(t *testing.T) {
	seen := map[string]bool{LegacyRoleID: true}
	defaults := 0
	for _, r := range builtinRoles {
		if seen[r.id] || !idPattern.MatchString(r.id) {
			t.Errorf("role id %q duplicate or invalid", r.id)
		}
		seen[r.id] = true
		if !knownIcons[r.icon] {
			t.Errorf("role %s: icon %q not in knownIcons", r.id, r.icon)
		}
		if !hexColor.MatchString(r.coverFrom) || !hexColor.MatchString(r.coverTo) {
			t.Errorf("role %s: cover %q → %q is not #RRGGBB", r.id, r.coverFrom, r.coverTo)
		}
		if r.isDefault {
			defaults++
			if r.id != DefaultRoleID() {
				t.Errorf("default role is %s, DefaultRoleID is %s", r.id, DefaultRoleID())
			}
		}
		for _, l := range []localized{r.name, r.description, r.prompt} {
			if l.de == "" || l.en == "" {
				t.Errorf("role %s: missing translation", r.id)
			}
		}
	}
	if defaults != 1 {
		t.Errorf("exactly one default role, got %d", defaults)
	}
	rules := map[string]bool{}
	for _, g := range ruleGroups {
		for _, r := range g.rules {
			if rules[r.id] {
				t.Errorf("rule id %q duplicate", r.id)
			}
			rules[r.id] = true
			if r.text.de == "" || r.text.en == "" || r.label.de == "" || r.label.en == "" {
				t.Errorf("rule %s: missing translation", r.id)
			}
		}
	}
	c := CatalogFor("en")
	if c.Language != "en" || len(c.Roles) != len(builtinRoles) || c.RulesHeading != "Rules:" {
		t.Errorf("catalog en = %+v", c)
	}
}

func validBehavior() Behavior {
	return Behavior{
		Version: 1, ActiveRoleID: "c-1",
		CustomRoles: []Role{{ID: LegacyRoleID, Prompt: "alt"}, {ID: "c-1", Name: "Eigene", Prompt: "P", Icon: "sparkles"}},
		RoleRules: map[string]RuleSet{"c-1": {
			Rules:       map[string]bool{"pages": true},
			CustomRules: []CustomRule{{ID: "r1", Text: "Regel", On: true}},
		}},
	}
}

func TestValidate(t *testing.T) {
	if err := Validate(validBehavior()); err != nil {
		t.Fatalf("valid: %v", err)
	}
	cases := map[string]func(*Behavior){
		"version":             func(b *Behavior) { b.Version = 2 },
		"unknown active role": func(b *Behavior) { b.ActiveRoleID = "nope" },
		"template id taken":   func(b *Behavior) { b.CustomRoles[1].ID = "tutor"; b.ActiveRoleID = "tutor" },
		"duplicate role id":   func(b *Behavior) { b.CustomRoles = append(b.CustomRoles, b.CustomRoles[1]) },
		"bad role id":         func(b *Behavior) { b.CustomRoles[1].ID = "a b"; b.ActiveRoleID = "a b" },
		"empty name":          func(b *Behavior) { b.CustomRoles[1].Name = "  " },
		"long name":           func(b *Behavior) { b.CustomRoles[1].Name = strings.Repeat("x", MaxRoleNameRunes+1) },
		"empty prompt":        func(b *Behavior) { b.CustomRoles[1].Prompt = " " },
		"long prompt":         func(b *Behavior) { b.CustomRoles[1].Prompt = strings.Repeat("ä", MaxPromptRunes+1) },
		"long legacy prompt":  func(b *Behavior) { b.CustomRoles[0].Prompt = strings.Repeat("ä", MaxPromptRunes+1) },
		"unknown icon":        func(b *Behavior) { b.CustomRoles[1].Icon = "skull" },
		"unknown rule":        func(b *Behavior) { b.RoleRules["c-1"].Rules["nope"] = true },
		"empty custom rule":   func(b *Behavior) { b.RoleRules["c-1"].CustomRules[0].Text = " " },
		"long custom rule":    func(b *Behavior) { b.RoleRules["c-1"].CustomRules[0].Text = strings.Repeat("ä", MaxRuleRunes+1) },
		"duplicate rule id": func(b *Behavior) {
			set := b.RoleRules["c-1"]
			set.CustomRules = append(set.CustomRules, set.CustomRules[0])
			b.RoleRules["c-1"] = set
		},
		"rules of a missing role": func(b *Behavior) { b.RoleRules["c-gone"] = RuleSet{Rules: map[string]bool{}} },
		"rules of a template":     func(b *Behavior) { b.RoleRules["tutor"] = RuleSet{Rules: map[string]bool{}} },
		"too many roles": func(b *Behavior) {
			for i := 0; i <= MaxCustomRoles; i++ {
				b.CustomRoles = append(b.CustomRoles, Role{ID: "x" + strings.Repeat("y", i+1), Name: "n", Prompt: "p"})
			}
		},
	}
	for name, mutate := range cases {
		b := validBehavior()
		mutate(&b)
		if err := Validate(b); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", name, err)
		}
	}
	// Character limits count runes: exactly at the limit in multi-byte runes passes.
	b := validBehavior()
	b.CustomRoles[1].Prompt = strings.Repeat("ä", MaxPromptRunes)
	if err := Validate(b); err != nil {
		t.Errorf("prompt at the rune limit: %v", err)
	}
	// A template may be the active role.
	b = validBehavior()
	b.ActiveRoleID = "tutor"
	if err := Validate(b); err != nil {
		t.Errorf("template active: %v", err)
	}
}

func TestForStorage_LegacyPromptGoesToSystemPrompt(t *testing.T) {
	stored, legacy := ForStorage(validBehavior())
	if legacy == nil || *legacy != "alt" {
		t.Fatalf("legacy = %v", legacy)
	}
	if stored.CustomRoles[0] != (Role{ID: LegacyRoleID}) {
		t.Errorf("legacy entry must be reduced to its id: %+v", stored.CustomRoles[0])
	}
	// Round trip: what is read back is what was saved.
	eff := Effective(&stored, legacy, "", "de")
	if eff.CustomRoles[0].Prompt != "alt" || eff.CustomRoles[1].Prompt != "P" || eff.ActiveRoleID != "c-1" {
		t.Errorf("round trip = %+v", eff)
	}

	b := validBehavior()
	b.CustomRoles = b.CustomRoles[1:] // legacy role deleted
	if _, legacy := ForStorage(b); legacy != nil {
		t.Errorf("deleted legacy role must clear system_prompt, got %q", *legacy)
	}
	b = validBehavior()
	b.CustomRoles[0].Prompt = ""
	if _, legacy := ForStorage(b); legacy != nil {
		t.Errorf("empty legacy prompt must store NULL, got %q", *legacy)
	}
	b = validBehavior()
	b.CustomRoles[1].Icon = ""
	if stored, _ := ForStorage(b); stored.CustomRoles[1].Icon != customRoleIcon {
		t.Errorf("missing icon must fall back, got %q", stored.CustomRoles[1].Icon)
	}
}

// Oracle: developer rulings 28.10.2026 — each role has its own rules; a
// template's are the system preset (the catalog's defaults), not editable; an
// own role nobody set rules for answers with the defaults, the legacy role
// with none (its pre-roles prompt stays byte for byte).
func TestRulesFor_OwnSetDefaultsAndLegacy(t *testing.T) {
	b := Behavior{Version: 1, ActiveRoleID: "c-1",
		CustomRoles: []Role{{ID: LegacyRoleID}, {ID: "c-1", Name: "Eigene", Prompt: "P"}},
		RoleRules:   map[string]RuleSet{"c-1": {Rules: map[string]bool{"quotes": true}}},
	}
	if got := RulesFor(b, "c-1").Rules; !got["quotes"] || got["pages"] {
		t.Errorf("own set = %v", got)
	}
	b.RoleRules["tutor"] = RuleSet{Rules: map[string]bool{"quotes": true}}
	if got := RulesFor(b, "tutor").Rules; !got["pages"] || got["quotes"] {
		t.Errorf("template = %v, want the catalog defaults, fixed", got)
	}
	if got := RulesFor(b, "c-2").Rules; !got["pages"] {
		t.Errorf("own role without a set = %v, want the catalog defaults", got)
	}
	if got := RulesFor(b, LegacyRoleID); len(got.Rules) != 0 || len(got.CustomRules) != 0 {
		t.Errorf("legacy role without a set = %+v, want none", got)
	}
	// The set of a deleted role and a rule gone from the catalog drop out.
	stored := b
	stored.RoleRules = map[string]RuleSet{"c-1": {Rules: map[string]bool{"quotes": true, "gone": true}}, "c-gone": {}, "tutor": {}}
	eff := Effective(&stored, nil, "", "de")
	_, gone := eff.RoleRules["c-gone"]
	_, template := eff.RoleRules["tutor"]
	if gone || template || eff.RoleRules["c-1"].Rules["gone"] {
		t.Errorf("effective sets = %+v", eff.RoleRules)
	}
}

// Oracle: StarterRole's contract — the starter questions are tailored to the
// role a chat starts in; "" and a role the KB does not have mean the active
// role, a template answers with its catalog text.
func TestBrief_RoleOrActive(t *testing.T) {
	b := Behavior{Version: 1, ActiveRoleID: "c-1", CustomRoles: []Role{{ID: "c-1", Name: "Eigene", Description: "D", Prompt: "P"}}}
	want := RoleBrief{Name: "Eigene", Description: "D", Prompt: "P"}
	for _, id := range []string{"", "c-1", "gone"} {
		if got := Brief(b, id, "de"); got != want {
			t.Errorf("%q: %+v, want %+v", id, got, want)
		}
	}
	tpl := templateRoles()[0]
	if got := Brief(b, tpl.id, "en"); got.Name != tpl.name.in("en") || got.Prompt != tpl.prompt.in("en") {
		t.Errorf("template %s: %+v", tpl.id, got)
	}
}
