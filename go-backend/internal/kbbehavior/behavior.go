// Package kbbehavior owns how a KB behaves in chat: its active role, its own
// roles, and per role which catalog rules are on and its own rules
// (knowledge_bases.behavior, migration 0092), plus the role a single chat was
// started in (chats.role_id).
//
// Every answer path reads the KB's prompt through SystemPrompt, which compiles
// it in this order: the role's prompt, then "Regeln:" with the active rules.
// The rules are the role's own (RoleRules): each role of a KB has its set.
// The answer paths append the fixed RAG instructions (prompts.ChatSystemPrompt)
// after it, as they did with the free system prompt before.
//
// A KB that was never customized (behavior IS NULL) answers from system_prompt
// alone, byte for byte as before: it reads as the KB's own role "legacy"
// ("Bisheriger Prompt") with no rule on. system_prompt stays the storage of
// that role's prompt after customizing too.
package kbbehavior

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

// Limits on a saved Behavior. Prompt matches the old systemPrompt limit.
const (
	MaxPromptRunes   = 8000
	MaxRoleNameRunes = 80
	MaxRoleDescRunes = 200
	MaxRuleRunes     = 300
	MaxCustomRoles   = 20
	MaxCustomRules   = 20
	currentVersion   = 1
	LegacyRoleID     = "legacy"
	legacyIcon       = "user-round"
	customRoleIcon   = "user-round"
)

// Role is a role in a KB's settings: a catalog template (Template true, read
// only) or one of the KB's own roles. Icon is a lucide icon name from a fixed
// set the web client renders.
type Role struct {
	ID          string `json:"id"`
	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`
	Prompt      string `json:"prompt,omitempty"`
	Icon        string `json:"icon,omitempty"`
}

// CustomRule is one of a KB's own rules: one sentence, on or off.
type CustomRule struct {
	ID   string `json:"id"`
	Text string `json:"text"`
	On   bool   `json:"on"`
}

// RuleSet is one role's rules: Rules maps a catalog rule id to on/off (a
// catalog rule missing from the map is off, so a rule added to the catalog
// later never switches itself on in a set someone made), CustomRules are the
// role's own sentences.
type RuleSet struct {
	Rules       map[string]bool `json:"rules"`
	CustomRules []CustomRule    `json:"customRules"`
}

// Behavior is the stored and wire shape of a KB's behavior settings.
// RoleRules holds the rule set of every own role someone set rules for; a
// template's rules are the catalog's defaults, fixed (RulesFor).
type Behavior struct {
	Version      int                `json:"version"`
	ActiveRoleID string             `json:"activeRoleId"`
	CustomRoles  []Role             `json:"customRoles"`
	RoleRules    map[string]RuleSet `json:"roleRules"`
}

// Default is what a new KB starts with: the default template role, its rules
// the catalog's defaults (RulesFor).
func Default() Behavior {
	return Behavior{
		Version:      currentVersion,
		ActiveRoleID: DefaultRoleID(),
		CustomRoles:  []Role{},
		RoleRules:    map[string]RuleSet{},
	}
}

// DefaultRules is the rule set of a role nobody set rules for: the catalog's
// default rules, no own ones.
func DefaultRules() RuleSet {
	rules := map[string]bool{}
	for _, g := range ruleGroups {
		for _, r := range g.rules {
			rules[r.id] = r.defaultOn
		}
	}
	return RuleSet{Rules: rules, CustomRules: []CustomRule{}}
}

// RulesFor is the rule set roleID answers with. A template's are the
// catalog's defaults, fixed: a template is changed only as a copy. An own role
// answers with its set, else the defaults — except the legacy role, which
// without a set of its own has no rule on, so a KB's pre-roles prompt stays
// byte for byte what it was.
func RulesFor(b Behavior, roleID string) RuleSet {
	if _, ok := findTemplateRole(roleID); ok {
		return DefaultRules()
	}
	if set, ok := b.RoleRules[roleID]; ok {
		return set
	}
	if roleID == LegacyRoleID {
		return RuleSet{Rules: map[string]bool{}, CustomRules: []CustomRule{}}
	}
	return DefaultRules()
}

// Lang maps a KB's language column to a prompt language: "en" or "de".
func Lang(kbLanguage string) string {
	if kbLanguage == "en" {
		return "en"
	}
	return "de"
}

// Effective is the behavior a KB answers with, complete for display: stored
// is the saved behavior (nil when never customized), legacyPrompt the
// system_prompt column, kbName the KB's name, lang the prompt language (Lang).
// The legacy role gets its prompt filled in here, and its name and description
// unless the author set their own (stored on the role, see ForStorage);
// without a legacy prompt it is named after the KB.
// Callers that only compile or compare pass kbName "" — the name never reaches
// the prompt.
func Effective(stored *Behavior, legacyPrompt *string, kbName, lang string) Behavior {
	if stored == nil {
		return Behavior{
			Version:      currentVersion,
			ActiveRoleID: LegacyRoleID,
			CustomRoles:  []Role{legacyRole(Role{}, legacyPrompt, kbName, lang)},
			RoleRules:    map[string]RuleSet{},
		}
	}
	out := Behavior{
		Version:      currentVersion,
		ActiveRoleID: stored.ActiveRoleID,
		CustomRoles:  make([]Role, 0, len(stored.CustomRoles)),
		RoleRules:    make(map[string]RuleSet, len(stored.RoleRules)),
	}
	for _, r := range stored.CustomRoles {
		if r.ID == LegacyRoleID {
			r = legacyRole(r, legacyPrompt, kbName, lang)
		}
		out.CustomRoles = append(out.CustomRoles, r)
	}
	// The set of a role the KB no longer has (or of a template) drops out,
	// and so does a rule taken out of the catalog, so a KB that had it on
	// still saves.
	for roleID, set := range stored.RoleRules {
		if _, template := findTemplateRole(roleID); template || !out.HasRole(roleID) {
			continue
		}
		rules := make(map[string]bool, len(set.Rules))
		for k, v := range set.Rules {
			if isTemplateRule(k) {
				rules[k] = v
			}
		}
		out.RoleRules[roleID] = RuleSet{Rules: rules, CustomRules: append([]CustomRule{}, set.CustomRules...)}
	}
	return out
}

func legacyRole(stored Role, prompt *string, kbName, lang string) Role {
	r := Role{ID: LegacyRoleID, Name: legacyRoleName.in(lang), Icon: legacyIcon}
	if prompt != nil && *prompt != "" {
		r.Prompt = *prompt
		r.Description = legacyRoleDescription.in(lang)
	} else {
		if name := strings.TrimSpace(kbName); name != "" {
			r.Name = name
		}
		r.Description = legacyRoleDescriptionEmpty.in(lang)
	}
	// The author's own name and description win over the defaults.
	if stored.Name != "" {
		r.Name = stored.Name
	}
	if stored.Description != "" {
		r.Description = stored.Description
	}
	return r
}

// DropLegacyDefaults clears the legacy role's stored name and description
// where they are only the defaults Effective fills in (in either language, or
// the KB's name in kbNames): a default stored as the author's own would no
// longer follow a rename of the KB or a change of its language.
func DropLegacyDefaults(b *Behavior, kbNames ...string) {
	if b == nil {
		return
	}
	for i, r := range b.CustomRoles {
		if r.ID != LegacyRoleID {
			continue
		}
		if isDefault(r.Name, legacyRoleName) || slices.Contains(kbNames, r.Name) {
			b.CustomRoles[i].Name = ""
		}
		if isDefault(r.Description, legacyRoleDescription, legacyRoleDescriptionEmpty) {
			b.CustomRoles[i].Description = ""
		}
	}
}

func isDefault(s string, defaults ...localized) bool {
	for _, d := range defaults {
		if s == d.de || s == d.en {
			return true
		}
	}
	return false
}

// HasRole reports whether id names a role eff can answer in: a catalog
// template or one of the KB's own roles.
func (b Behavior) HasRole(id string) bool {
	if _, ok := findTemplateRole(id); ok {
		return true
	}
	for _, r := range b.CustomRoles {
		if r.ID == id {
			return true
		}
	}
	return false
}

// Compile builds the KB part of the answer prompt for roleID ("" = the active
// role): the role's prompt, then the rules heading and one "- " line per
// active rule of that role (RulesFor), catalog rules in catalog order before
// its own. A roleID
// the KB no longer has falls back to the active role; found reports which
// happened. With no rule on, the result is the role prompt unchanged.
func Compile(eff Behavior, roleID, lang string) (prompt string, found bool) {
	found = true
	if roleID == "" || !eff.HasRole(roleID) {
		found = roleID == ""
		roleID = eff.ActiveRoleID
	}
	rolePrompt := rolePromptFor(eff, roleID, lang)
	set := RulesFor(eff, roleID)

	var lines []string
	for _, g := range ruleGroups {
		for _, r := range g.rules {
			if set.Rules[r.id] {
				lines = append(lines, "- "+r.text.in(lang))
			}
		}
	}
	for _, r := range set.CustomRules {
		if r.On && strings.TrimSpace(r.Text) != "" {
			lines = append(lines, "- "+strings.TrimSpace(r.Text))
		}
	}
	if len(lines) == 0 {
		return rolePrompt, found
	}
	rules := rulesHeading.in(lang) + "\n" + strings.Join(lines, "\n")
	if rolePrompt == "" {
		return rules, found
	}
	return rolePrompt + "\n\n" + rules, found
}

func rolePromptFor(eff Behavior, id, lang string) string {
	if t, ok := findTemplateRole(id); ok {
		return t.prompt.in(lang)
	}
	for _, r := range eff.CustomRoles {
		if r.ID == id {
			return r.Prompt
		}
	}
	return ""
}

// ErrInvalid wraps every validation failure; the message is safe to return
// to the client.
var ErrInvalid = errors.New("invalid behavior")

var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// knownIcons are the icon names the web client can render.
var knownIcons = map[string]bool{
	"graduation-cap": true, "book-open": true, "building-2": true, "pen-line": true,
	"file-text": true, "life-buoy": true, "user-round": true, "sparkles": true, "copy": true,
	"file-check": true,
}

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

// Validate checks a Behavior sent by a client. Lengths count runes.
func Validate(b Behavior) error {
	if b.Version != currentVersion {
		return invalid("version must be %d", currentVersion)
	}
	if len(b.CustomRoles) > MaxCustomRoles {
		return invalid("at most %d custom roles", MaxCustomRoles)
	}
	seen := map[string]bool{}
	for _, r := range b.CustomRoles {
		if !idPattern.MatchString(r.ID) {
			return invalid("role id %q is not valid", r.ID)
		}
		if _, ok := findTemplateRole(r.ID); ok {
			return invalid("role id %q is taken by a template", r.ID)
		}
		if seen[r.ID] {
			return invalid("role id %q is used twice", r.ID)
		}
		seen[r.ID] = true
		if utf8.RuneCountInString(r.Prompt) > MaxPromptRunes {
			return invalid("a role prompt must not exceed %d characters", MaxPromptRunes)
		}
		if r.ID == LegacyRoleID {
			// Name and description are optional (empty = the default); the icon is fixed.
			if utf8.RuneCountInString(strings.TrimSpace(r.Name)) > MaxRoleNameRunes {
				return invalid("a role name must not exceed %d characters", MaxRoleNameRunes)
			}
			if utf8.RuneCountInString(r.Description) > MaxRoleDescRunes {
				return invalid("a role description must not exceed %d characters", MaxRoleDescRunes)
			}
			continue
		}
		name := strings.TrimSpace(r.Name)
		if name == "" {
			return invalid("every role needs a name")
		}
		if utf8.RuneCountInString(name) > MaxRoleNameRunes {
			return invalid("a role name must not exceed %d characters", MaxRoleNameRunes)
		}
		if utf8.RuneCountInString(r.Description) > MaxRoleDescRunes {
			return invalid("a role description must not exceed %d characters", MaxRoleDescRunes)
		}
		if strings.TrimSpace(r.Prompt) == "" {
			return invalid("role %q needs a prompt", name)
		}
		if r.Icon != "" && !knownIcons[r.Icon] {
			return invalid("unknown icon %q", r.Icon)
		}
	}
	if !b.HasRole(b.ActiveRoleID) {
		return invalid("active role %q does not exist", b.ActiveRoleID)
	}
	for roleID, set := range b.RoleRules {
		if _, ok := findTemplateRole(roleID); ok {
			return invalid("the rules of template %q are fixed", roleID)
		}
		if !b.HasRole(roleID) {
			return invalid("rules for role %q, which does not exist", roleID)
		}
		if err := validateRuleSet(set); err != nil {
			return err
		}
	}
	return nil
}

func validateRuleSet(set RuleSet) error {
	for id := range set.Rules {
		if !isTemplateRule(id) {
			return invalid("unknown rule %q", id)
		}
	}
	if len(set.CustomRules) > MaxCustomRules {
		return invalid("at most %d custom rules per role", MaxCustomRules)
	}
	seenRule := map[string]bool{}
	for _, r := range set.CustomRules {
		if !idPattern.MatchString(r.ID) {
			return invalid("rule id %q is not valid", r.ID)
		}
		if seenRule[r.ID] {
			return invalid("rule id %q is used twice", r.ID)
		}
		seenRule[r.ID] = true
		text := strings.TrimSpace(r.Text)
		if text == "" {
			return invalid("a custom rule must not be empty")
		}
		if utf8.RuneCountInString(text) > MaxRuleRunes {
			return invalid("a custom rule must not exceed %d characters", MaxRuleRunes)
		}
	}
	return nil
}

// ForStorage splits a validated Behavior into what is written: the behavior
// column (the legacy role reduced to its id plus an own name and description,
// names and texts trimmed) and the
// system_prompt column (the legacy role's prompt; nil when the KB no longer
// has that role or its prompt is empty, as a cleared systemPrompt was before).
func ForStorage(b Behavior) (stored Behavior, legacyPrompt *string) {
	stored = Behavior{
		Version:      currentVersion,
		ActiveRoleID: b.ActiveRoleID,
		CustomRoles:  make([]Role, 0, len(b.CustomRoles)),
		RoleRules:    make(map[string]RuleSet, len(b.RoleRules)),
	}
	for _, r := range b.CustomRoles {
		if r.ID == LegacyRoleID {
			if r.Prompt != "" {
				p := r.Prompt
				legacyPrompt = &p
			}
			stored.CustomRoles = append(stored.CustomRoles, Role{
				ID: LegacyRoleID, Name: strings.TrimSpace(r.Name), Description: strings.TrimSpace(r.Description),
			})
			continue
		}
		r.Name = strings.TrimSpace(r.Name)
		r.Description = strings.TrimSpace(r.Description)
		if r.Icon == "" {
			r.Icon = customRoleIcon
		}
		stored.CustomRoles = append(stored.CustomRoles, r)
	}
	for roleID, set := range b.RoleRules {
		out := RuleSet{Rules: make(map[string]bool, len(set.Rules)), CustomRules: make([]CustomRule, 0, len(set.CustomRules))}
		for k, v := range set.Rules {
			out.Rules[k] = v
		}
		for _, r := range set.CustomRules {
			r.Text = strings.TrimSpace(r.Text)
			out.CustomRules = append(out.CustomRules, r)
		}
		stored.RoleRules[roleID] = out
	}
	DropLegacyDefaults(&stored)
	return stored, legacyPrompt
}
