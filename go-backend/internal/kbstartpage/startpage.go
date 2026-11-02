// Package kbstartpage owns a KB's start page settings (knowledge_bases.start_page,
// migration 0093): the gradient of the title card, how a chat starts (input
// field, a file upload, or role cards that each start a chat in a role), and
// fixed or dynamic starter questions under the input field. How each role
// starts its chat (RoleStarts) is set up per role in „Verhalten" — every role
// starts with the input field until one is set; the „Rollenauswahl" picks
// which roles the page shows (RoleEntries).
//
// Title and description are not stored here: they are the KB's name
// (renamed through PATCH /api/kb/{id}, with its stricter rename rule) and
// description. The category is kb_category_links (internal/kbcategories).
// Dynamic questions are GET /api/kb/{id}/starter-questions.
package kbstartpage

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Limits on a saved StartPage.
const (
	MaxRoleEntries      = 3
	MaxRoleStarts       = 40
	MaxFixedQuestions   = 6
	MaxQuestionRunes    = 120
	MaxUploadLabelRunes = 80
	MaxInstructionRunes = 300
	currentVersion      = 1
	QuestionsDynamic    = "dynamic"
	QuestionsFixed      = "fixed"
	StartInput          = "input"
	StartUpload         = "upload"
	StartRoles          = "roles"
	EntryInput          = "input"
	EntryTask           = "task"
	EntryFile           = "file"
)

// Colors are the start page's two colours, a gradient From → To: the glow
// behind the title on the start page and the cover band of the „Entdecken"
// card. Each is "#RRGGBB" (upper case once stored).
type Colors struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// DefaultColors are the colours of a KB that never chose its own: the JLU
// brand blue into a lighter blue.
func DefaultColors() *Colors { return &Colors{From: "#0056B3", To: "#3897E8"} }

var hexPattern = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

// dynamicCounts are the offered numbers of dynamic questions.
var dynamicCounts = map[int]bool{3: true, 4: true, 6: true}

// EntryStart is how a role card starts its chat: "input" opens an empty chat
// in the role, "task" starts with Text as the first question (sent at once
// when Send, else put into the input field), "file" asks for a file and sends
// it with Instruction as the first message. A file start takes what any chat
// attachment takes (POST /api/kb/{id}/chat/attachments, with its own checks):
// there is no per-page list of file types.
type EntryStart struct {
	Kind        string `json:"kind"`
	Text        string `json:"text"`
	Send        bool   `json:"send"`
	Instruction string `json:"instruction"`
	// Suggestions under the input field of a chat this card opens ("input"
	// cards; kept as a draft for the other kinds).
	Suggestions Suggestions `json:"suggestions"`
}

// Suggestions are starter questions under an input field: QuestionMode
// "dynamic" shows DynamicCount of the KB's generated questions per visit,
// "fixed" shows FixedQuestions. Switching them off or to dynamic keeps the
// fixed ones. The page's own (the "input" start) and every role card's.
type Suggestions struct {
	QuestionsOn    bool     `json:"questionsOn"`
	QuestionMode   string   `json:"questionMode"`
	DynamicCount   int      `json:"dynamicCount"`
	FixedQuestions []string `json:"fixedQuestions"`
}

// DefaultSuggestions are off, dynamic with 4, no fixed questions.
func DefaultSuggestions() Suggestions {
	return Suggestions{QuestionMode: QuestionsDynamic, DynamicCount: 4, FixedQuestions: []string{}}
}

// RoleEntry is a further role card of the "roles" start mode: a NEW chat in
// RoleID, started as RoleStarts[RoleID] says.
type RoleEntry struct {
	ID     string `json:"id"`
	RoleID string `json:"roleId"`
}

// StartPage is the stored and wire shape. The settings of all three start
// modes are kept when the mode changes.
type StartPage struct {
	Version int `json:"version"`
	// Colors: the gradient; nil shows no colour.
	Colors *Colors `json:"colors"`
	// StartMode: "input" (composer, optionally with starter questions),
	// "upload" (a file first), "roles" (role cards only, no composer).
	StartMode string `json:"startMode"`
	// Starter questions under the input field ("input" mode), flat on the
	// page: questionsOn, questionMode, dynamicCount, fixedQuestions.
	Suggestions
	// "upload" mode. UploadLabel "" is the client's default label;
	// UploadInstruction "" sends the client's default text with the file.
	UploadLabel       string `json:"uploadLabel"`
	UploadInstruction string `json:"uploadInstruction"`
	// RoleStarts is how a role starts its chat, by role id (set up in
	// „Verhalten"); a role without one starts with the input field. "roles"
	// mode shows the KB's active role first, then RoleEntries: up to
	// MaxRoleEntries further roles.
	RoleStarts  map[string]EntryStart `json:"roleStarts"`
	RoleEntries []RoleEntry           `json:"roleEntries"`
}

// DefaultStart is how a role without a set-up start starts: the input field.
func DefaultStart() EntryStart {
	return EntryStart{Kind: EntryInput, Send: true, Suggestions: DefaultSuggestions()}
}

// StartOf is how roleID's card starts its chat.
func (p StartPage) StartOf(roleID string) EntryStart {
	if e, ok := p.RoleStarts[roleID]; ok {
		return e
	}
	return DefaultStart()
}

// Default is the start page of a KB that never configured one: the input
// field without starter questions under it.
func Default() StartPage {
	return StartPage{
		Version:     currentVersion,
		Colors:      DefaultColors(),
		StartMode:   StartInput,
		Suggestions: DefaultSuggestions(),
		RoleStarts:  map[string]EntryStart{},
		RoleEntries: []RoleEntry{},
	}
}

// ErrInvalid wraps every validation failure; the message is safe to return.
var ErrInvalid = errors.New("invalid start page")

var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

func runes(s string) int { return utf8.RuneCountInString(strings.TrimSpace(s)) }

// validateStart checks one role's start. strict applies the rule that only
// matters while its card is shown (on the page in the "roles" mode): a task
// needs its text. Otherwise an unfinished start is kept as a draft.
func validateStart(e EntryStart, strict bool) error {
	switch e.Kind {
	case EntryInput, EntryTask, EntryFile:
	default:
		return invalid("kind must be %q, %q or %q", EntryInput, EntryTask, EntryFile)
	}
	if runes(e.Text) > MaxQuestionRunes {
		return invalid("a card text must not exceed %d characters", MaxQuestionRunes)
	}
	if runes(e.Instruction) > MaxInstructionRunes {
		return invalid("an instruction must not exceed %d characters", MaxInstructionRunes)
	}
	if strict && e.Kind == EntryTask && strings.TrimSpace(e.Text) == "" {
		return invalid("a task card needs its text")
	}
	return validateSuggestions(e.Suggestions)
}

func validateSuggestions(s Suggestions) error {
	if s.QuestionMode != QuestionsDynamic && s.QuestionMode != QuestionsFixed {
		return invalid("questionMode must be %q or %q", QuestionsDynamic, QuestionsFixed)
	}
	if !dynamicCounts[s.DynamicCount] {
		return invalid("dynamicCount must be 3, 4 or 6")
	}
	if len(s.FixedQuestions) > MaxFixedQuestions {
		return invalid("at most %d starter questions", MaxFixedQuestions)
	}
	for _, q := range s.FixedQuestions {
		if runes(q) > MaxQuestionRunes {
			return invalid("a starter question must not exceed %d characters", MaxQuestionRunes)
		}
	}
	return nil
}

// Validate checks a StartPage sent by a client. activeRoleID is the KB's
// active role, which the roles start shows first on its own; hasRole reports
// whether the KB can answer in a role id (kbbehavior). Lengths count runes.
func Validate(p StartPage, activeRoleID string, hasRole func(string) bool) error {
	if p.Version != currentVersion {
		return invalid("version must be %d", currentVersion)
	}
	if p.Colors != nil && (!hexPattern.MatchString(p.Colors.From) || !hexPattern.MatchString(p.Colors.To)) {
		return invalid("colors must be #RRGGBB")
	}
	if p.StartMode != StartInput && p.StartMode != StartUpload && p.StartMode != StartRoles {
		return invalid("startMode must be %q, %q or %q", StartInput, StartUpload, StartRoles)
	}
	if err := validateSuggestions(p.Suggestions); err != nil {
		return err
	}
	if runes(p.UploadLabel) > MaxUploadLabelRunes {
		return invalid("uploadLabel must not exceed %d characters", MaxUploadLabelRunes)
	}
	if runes(p.UploadInstruction) > MaxInstructionRunes {
		return invalid("uploadInstruction must not exceed %d characters", MaxInstructionRunes)
	}
	roles := p.StartMode == StartRoles
	if len(p.RoleStarts) > MaxRoleStarts {
		return invalid("at most %d role starts", MaxRoleStarts)
	}
	shown := map[string]bool{}
	for _, e := range p.RoleEntries {
		shown[e.RoleID] = true
	}
	for roleID, e := range p.RoleStarts {
		if !hasRole(roleID) {
			return invalid("role %q does not exist", roleID)
		}
		if err := validateStart(e, roles && shown[roleID]); err != nil {
			return err
		}
	}
	if len(p.RoleEntries) > MaxRoleEntries {
		return invalid("at most %d further role cards", MaxRoleEntries)
	}
	// A choice needs two roles: with the active role alone, the input field
	// (StartInput) starts the same chat.
	if roles && len(p.RoleEntries) == 0 {
		return invalid("the roles start needs at least one further role card")
	}
	seen := map[string]bool{}
	// A role shows once: the active role first, every further role on one card.
	seenRoles := map[string]bool{activeRoleID: true}
	for _, e := range p.RoleEntries {
		if !idPattern.MatchString(e.ID) {
			return invalid("card id %q is not valid", e.ID)
		}
		if seen[e.ID] {
			return invalid("card id %q is used twice", e.ID)
		}
		seen[e.ID] = true
		if !hasRole(e.RoleID) {
			return invalid("role %q does not exist", e.RoleID)
		}
		if seenRoles[e.RoleID] {
			return invalid("role %q is on the page twice", e.RoleID)
		}
		seenRoles[e.RoleID] = true
	}
	return nil
}

func normalizeStart(e EntryStart) EntryStart {
	e.Text = strings.TrimSpace(e.Text)
	e.Instruction = strings.TrimSpace(e.Instruction)
	e.Suggestions = normalizeSuggestions(e.Suggestions)
	return e
}

// normalizeSuggestions drops empty fixed questions and fills what a page
// stored before card suggestions existed leaves unset (no mode, count 0).
func normalizeSuggestions(s Suggestions) Suggestions {
	out := s
	if out.QuestionMode == "" {
		out.QuestionMode = QuestionsDynamic
	}
	if out.DynamicCount == 0 {
		out.DynamicCount = DefaultSuggestions().DynamicCount
	}
	out.FixedQuestions = make([]string, 0, len(s.FixedQuestions))
	for _, q := range s.FixedQuestions {
		if q = strings.TrimSpace(q); q != "" {
			out.FixedQuestions = append(out.FixedQuestions, q)
		}
	}
	return out
}

// Normalize trims the texts of a validated StartPage and drops empty fixed
// questions, which is what gets stored.
func Normalize(p StartPage) StartPage {
	out := p
	out.Suggestions = normalizeSuggestions(p.Suggestions)
	if p.Colors != nil {
		out.Colors = &Colors{From: strings.ToUpper(p.Colors.From), To: strings.ToUpper(p.Colors.To)}
	}
	out.UploadLabel = strings.TrimSpace(p.UploadLabel)
	out.UploadInstruction = strings.TrimSpace(p.UploadInstruction)
	out.RoleStarts = make(map[string]EntryStart, len(p.RoleStarts))
	for id, e := range p.RoleStarts {
		out.RoleStarts[id] = normalizeStart(e)
	}
	out.RoleEntries = append([]RoleEntry{}, p.RoleEntries...)
	return out
}

// Effective is what a KB's start page shows: stored (nil = Default) without
// the starts and cards of roles the KB no longer has, and without a second
// card of a role already shown (the active one, or an earlier card). Deleting
// a role in the behavior settings removes them there too; this read-side
// filter keeps a role deleted any other way from leaving a dead card behind,
// and a page stored before roles were unique from showing one twice.
func Effective(stored *StartPage, activeRoleID string, hasRole func(string) bool) StartPage {
	if stored == nil {
		return Default()
	}
	out := Normalize(*stored)
	for id := range out.RoleStarts {
		if !hasRole(id) {
			delete(out.RoleStarts, id)
		}
	}
	entries := make([]RoleEntry, 0, len(out.RoleEntries))
	shown := map[string]bool{activeRoleID: true}
	for _, e := range out.RoleEntries {
		if hasRole(e.RoleID) && !shown[e.RoleID] {
			shown[e.RoleID] = true
			entries = append(entries, e)
		}
	}
	out.RoleEntries = entries
	// The last further role went (deleted outside the settings): one role
	// leaves nothing to choose, so the page starts with the input field.
	if out.StartMode == StartRoles && len(entries) == 0 {
		out.StartMode = StartInput
	}
	return out
}
