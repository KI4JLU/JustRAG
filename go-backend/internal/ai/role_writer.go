package ai

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/justrag/go-backend/internal/prompts"
)

var roleGenerateSpec = &StructuredSpec{
	Name: "role_prompt",
	Schema: json.RawMessage(`{
		"type": "object",
		"properties": {"name": {"type": "string"}, "prompt": {"type": "string"}},
		"required": ["name", "prompt"],
		"additionalProperties": false
	}`),
}

var roleReviseSpec = &StructuredSpec{
	Name: "role_prompt_edits",
	Schema: json.RawMessage(`{
		"type": "object",
		"properties": {"edits": {"type": "array", "items": {
			"type": "object",
			"properties": {"find": {"type": "string"}, "replace": {"type": "string"}},
			"required": ["find", "replace"],
			"additionalProperties": false
		}}},
		"required": ["edits"],
		"additionalProperties": false
	}`),
}

var roleDescribeSpec = &StructuredSpec{
	Name: "role_description",
	Schema: json.RawMessage(`{
		"type": "object",
		"properties": {"description": {"type": "string"}},
		"required": ["description"],
		"additionalProperties": false
	}`),
}

// RoleDraft is a role written by GenerateRolePrompt.
type RoleDraft struct {
	Name   string `json:"name"`
	Prompt string `json:"prompt"`
}

// ErrEmptyRoleDraft reports a model answer without a usable prompt.
var ErrEmptyRoleDraft = errors.New("ai: role writer returned no prompt")

// GenerateRolePrompt writes a KB role — a name and a role prompt — from a
// short description, in lang ("de" or "en"). model "" = the KB's chat model.
// topic (the KB's name) may be empty.
func GenerateRolePrompt(ctx context.Context, resolver *ConfigResolver, kbID, model, topic, description, lang string) (RoleDraft, error) {
	user := description
	if t := strings.TrimSpace(topic); t != "" {
		label := "Topic"
		if lang == "de" {
			label = "Thema"
		}
		user = label + ": " + t + "\n\n" + description
	}
	var out RoleDraft
	if err := CompleteStructuredJSON(ctx, resolver, user, prompts.RoleGeneratePrompt(lang), kbID, model, roleGenerateSpec, &out); err != nil {
		return RoleDraft{}, err
	}
	out.Name, out.Prompt = strings.TrimSpace(out.Name), strings.TrimSpace(out.Prompt)
	if out.Prompt == "" {
		return RoleDraft{}, ErrEmptyRoleDraft
	}
	return out, nil
}

// ReviseRolePrompt changes a role prompt by an instruction ("kürzer",
// "ergänze Hinweise zu Fristen"). The model answers with edits — passages of
// the prompt and their new text — never the whole prompt, so what the
// instruction does not touch stays as it was, byte for byte.
func ReviseRolePrompt(ctx context.Context, resolver *ConfigResolver, kbID, model, prompt, instruction, lang string) (string, error) {
	ask := "Instruction"
	if lang == "de" {
		ask = "Anweisung"
	}
	user := "<prompt>\n" + prompt + "\n</prompt>\n\n" + ask + ": " + instruction
	var out struct {
		Edits []roleEdit `json:"edits"`
	}
	if err := CompleteStructuredJSON(ctx, resolver, user, prompts.RoleRevisePrompt(lang), kbID, model, roleReviseSpec, &out); err != nil {
		return "", err
	}
	return applyRoleEdits(prompt, out.Edits)
}

// roleEdit replaces Find, a passage of the prompt, by Replace; an empty Find
// appends Replace as a new paragraph.
type roleEdit struct {
	Find    string `json:"find"`
	Replace string `json:"replace"`
}

// ErrRoleUnchanged reports a revision that left the prompt as it was.
var ErrRoleUnchanged = errors.New("ai: role writer changed nothing")

// ErrRoleEditNotFound reports an edit whose passage is not in the prompt.
var ErrRoleEditNotFound = errors.New("ai: role writer edit does not match the prompt")

var blankLines = regexp.MustCompile(`\n[ \t]*\n(?:[ \t]*\n)+`)

// applyRoleEdits applies edits in order. A passage matches verbatim, else
// with any run of whitespace standing for any other (models re-wrap lines).
// One passage that matches nowhere fails the whole revision: a half-applied
// one would read as done.
func applyRoleEdits(prompt string, edits []roleEdit) (string, error) {
	text := prompt
	for _, e := range edits {
		find := strings.TrimSpace(e.Find)
		if find == "" {
			if add := strings.TrimSpace(e.Replace); add != "" {
				text = strings.TrimRight(text, " \t\n") + "\n\n" + add
			}
			continue
		}
		if i := strings.Index(text, find); i >= 0 {
			text = text[:i] + e.Replace + text[i+len(find):]
			continue
		}
		words := strings.Fields(find)
		for i, w := range words {
			words[i] = regexp.QuoteMeta(w)
		}
		loc := regexp.MustCompile(strings.Join(words, `\s+`)).FindStringIndex(text)
		if loc == nil {
			return "", ErrRoleEditNotFound
		}
		text = text[:loc[0]] + e.Replace + text[loc[1]:]
	}
	// A removed passage leaves its blank lines behind.
	text = strings.TrimSpace(blankLines.ReplaceAllString(text, "\n\n"))
	if text == "" {
		return "", ErrEmptyRoleDraft
	}
	if text == strings.TrimSpace(prompt) {
		return "", ErrRoleUnchanged
	}
	return text, nil
}

// DescribeRole writes a role's short description — the line under its name
// on the role cards — from its name and prompt. It is plain text: markdown
// emphasis and line breaks the model adds anyway are removed.
func DescribeRole(ctx context.Context, resolver *ConfigResolver, kbID, model, name, prompt, lang string) (string, error) {
	label, body := "Role", "Role prompt"
	if lang == "de" {
		label, body = "Rolle", "Rollen-Prompt"
	}
	user := label + ": " + strings.TrimSpace(name) + "\n\n" + body + ":\n<prompt>\n" + prompt + "\n</prompt>"
	var out struct {
		Description string `json:"description"`
	}
	if err := CompleteStructuredJSON(ctx, resolver, user, prompts.RoleDescribePrompt(lang), kbID, model, roleDescribeSpec, &out); err != nil {
		return "", err
	}
	d := strings.Join(strings.Fields(strings.NewReplacer("**", "", "__", "", "`", "").Replace(out.Description)), " ")
	if d == "" {
		return "", ErrEmptyRoleDraft
	}
	return d, nil
}
