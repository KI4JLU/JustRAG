package kbbehavior

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/justrag/go-backend/internal/logctx"
)

// The deployment's names a role prompt can refer to: {{assistant_name}} is who
// answers, {{system_name}} the platform it answers on. System admins set them
// as the global-only site_config keys below; an unset, blank or invalid value
// reads as the default, so a damaged row never puts an empty name into a
// prompt.
const (
	AssistantNameKey     = "assistant_name"
	SystemNameKey        = "system_name"
	DefaultAssistantName = "JLU RAG"
	DefaultSystemName    = "JLU RAG"
	MaxNameRunes         = 40

	assistantPlaceholder = "{{assistant_name}}"
	systemPlaceholder    = "{{system_name}}"
)

// namesSQL selects the two stored names, for a query that reads them along
// with a KB row (SystemPrompt, StarterRole).
const namesSQL = `(SELECT value FROM site_configs WHERE key = 'assistant_name'),
	(SELECT value FROM site_configs WHERE key = 'system_name')`

// Names are the values the placeholders resolve to.
type Names struct {
	Assistant string `json:"assistant"`
	System    string `json:"system"`
}

// DefaultNames are the names of a deployment that set none.
func DefaultNames() Names {
	return Names{Assistant: DefaultAssistantName, System: DefaultSystemName}
}

// ValidateName reports why v cannot be a name: longer than MaxNameRunes or
// more than one line. Blank is valid and means the default.
func ValidateName(v string) error {
	v = strings.TrimSpace(v)
	if strings.ContainsAny(v, "\r\n") {
		return errors.New("must be a single line")
	}
	if utf8.RuneCountInString(v) > MaxNameRunes {
		return fmt.Errorf("must not exceed %d characters", MaxNameRunes)
	}
	return nil
}

func nameOr(stored *string, def string) string {
	if stored == nil {
		return def
	}
	v := strings.TrimSpace(*stored)
	if v == "" || ValidateName(v) != nil {
		return def
	}
	return v
}

func namesFrom(assistant, system *string) Names {
	return Names{
		Assistant: nameOr(assistant, DefaultAssistantName),
		System:    nameOr(system, DefaultSystemName),
	}
}

// Resolve replaces the placeholders in s with n. Any other {{…}} stays as
// written.
func (n Names) Resolve(s string) string {
	if !strings.Contains(s, "{{") {
		return s
	}
	return strings.NewReplacer(assistantPlaceholder, n.Assistant, systemPlaceholder, n.System).Replace(s)
}

// SiteConfigGetter reads one global site_config value (nil when unset).
type SiteConfigGetter interface {
	GetSiteConfigValue(ctx context.Context, key string) (*string, error)
}

// ReadNames reads the names through r. A failed read is logged and reads as
// the default, like an unset value: the answer goes on.
func ReadNames(ctx context.Context, r SiteConfigGetter) Names {
	if r == nil {
		return DefaultNames()
	}
	read := func(key string) *string {
		v, err := r.GetSiteConfigValue(ctx, key)
		if err != nil {
			logctx.From(ctx).Warn("kbbehavior: reading a name failed; using the default", "key", key, "error", err)
			return nil
		}
		return v
	}
	return namesFrom(read(AssistantNameKey), read(SystemNameKey))
}

// DefaultRolePrompt is the KB part of the prompt for an answer that has no KB
// (library chat, eval answers): the default template role with its rules,
// compiled in lang and resolved to n, so such an answer has an identity too.
func DefaultRolePrompt(lang string, n Names) string {
	p, _ := Compile(Default(), "", lang)
	return n.Resolve(p)
}
