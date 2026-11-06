package kbbehavior

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"unicode/utf8"

	"github.com/justrag/go-backend/internal/logctx"
)

// The deployment's names a role prompt can refer to: {{assistant_name}} is who
// answers; {{institution_name}} and {{system_name}} are the two parts of the
// app name, the platform it answers on ("JLU" and "RAG" — the logo shows
// „JLU [RAG]", the window title "JLU RAG"). System admins set them as the
// global-only site_config keys below. An unset, blank or invalid value reads
// as the default, so a damaged row never puts an empty name into a prompt; the
// two app-name parts default to APP_NAME_PREFIX / APP_NAME_PRODUCT
// (SetAppNameDefaults), the constants only stand in until those are set.
const (
	AssistantNameKey       = "assistant_name"
	InstitutionNameKey     = "institution_name"
	SystemNameKey          = "system_name"
	DefaultAssistantName   = "JLU RAG"
	DefaultInstitutionName = "JLU"
	DefaultSystemName      = "RAG"
	MaxNameRunes           = 40

	assistantPlaceholder   = "{{assistant_name}}"
	institutionPlaceholder = "{{institution_name}}"
	systemPlaceholder      = "{{system_name}}"
)

// namesSQL selects the three stored names, for a query that reads them along
// with a KB row (SystemPrompt, StarterRole). Scan them in this order into
// namesFrom.
const namesSQL = `(SELECT value FROM site_configs WHERE key = 'assistant_name'),
	(SELECT value FROM site_configs WHERE key = 'institution_name'),
	(SELECT value FROM site_configs WHERE key = 'system_name')`

// Names are the values the placeholders resolve to.
type Names struct {
	Assistant   string `json:"assistant"`
	Institution string `json:"institution"`
	System      string `json:"system"`
}

// AppName is the app name in text, institution and system joined: "JLU RAG".
func (n Names) AppName() string {
	return n.Institution + " " + n.System
}

// appNameDefaults holds what SetAppNameDefaults set; nil until then.
var appNameDefaults atomic.Pointer[[2]string]

// SetAppNameDefaults makes institution and system the names of a deployment
// that set none: the server's APP_NAME_PREFIX and APP_NAME_PRODUCT. The
// server, the worker and the eval CLI call it at startup, before they compile
// a prompt. A blank or invalid part keeps its constant default.
func SetAppNameDefaults(institution, system string) {
	d := [2]string{nameOr(&institution, DefaultInstitutionName), nameOr(&system, DefaultSystemName)}
	appNameDefaults.Store(&d)
}

func defaultAppName() (institution, system string) {
	if d := appNameDefaults.Load(); d != nil {
		return d[0], d[1]
	}
	return DefaultInstitutionName, DefaultSystemName
}

// DefaultNames are the names of a deployment that set none.
func DefaultNames() Names {
	institution, system := defaultAppName()
	return Names{Assistant: DefaultAssistantName, Institution: institution, System: system}
}

// LineBreaks are the characters that start a new line in a prompt: CR and LF,
// and the vertical tab, form feed, NEL and the Unicode line and paragraph
// separators, which a model reads as line breaks just the same.
const LineBreaks = "\r\n\v\f\u0085\u2028\u2029"

// ValidateName reports why v cannot be a name: longer than MaxNameRunes or
// more than one line. Blank is valid and means the default.
func ValidateName(v string) error {
	v = strings.TrimSpace(v)
	if strings.ContainsAny(v, LineBreaks) {
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

func namesFrom(assistant, institution, system *string) Names {
	defInstitution, defSystem := defaultAppName()
	return Names{
		Assistant:   nameOr(assistant, DefaultAssistantName),
		Institution: nameOr(institution, defInstitution),
		System:      nameOr(system, defSystem),
	}
}

// Resolve replaces the placeholders in s with n. Any other {{…}} stays as
// written.
func (n Names) Resolve(s string) string {
	if !strings.Contains(s, "{{") {
		return s
	}
	return strings.NewReplacer(
		assistantPlaceholder, n.Assistant,
		institutionPlaceholder, n.Institution,
		systemPlaceholder, n.System,
	).Replace(s)
}

// SiteConfigGetter reads one global site_config value (nil when unset).
type SiteConfigGetter interface {
	GetSiteConfigValue(ctx context.Context, key string) (*string, error)
}

// siteConfigMultiGetter reads several global site_config values in one call.
type siteConfigMultiGetter interface {
	GetSiteConfigValues(ctx context.Context, keys []string) (map[string]*string, error)
}

// nameKeys are the three name keys in namesFrom's order.
var nameKeys = []string{AssistantNameKey, InstitutionNameKey, SystemNameKey}

// ReadNames reads the names through r. A failed read is logged and reads as
// the default, like an unset value: the answer goes on.
// A reader that also reads several keys at once (GetSiteConfigValues) reads
// all names in one lookup; when that fails, the names are the defaults — the
// single reads would only hit the same failing store three more times.
func ReadNames(ctx context.Context, r SiteConfigGetter) Names {
	if r == nil {
		return DefaultNames()
	}
	if multi, ok := r.(siteConfigMultiGetter); ok {
		vals, err := multi.GetSiteConfigValues(ctx, nameKeys)
		if err == nil {
			return namesFrom(vals[AssistantNameKey], vals[InstitutionNameKey], vals[SystemNameKey])
		}
		logctx.From(ctx).Warn("kbbehavior: reading the names failed; using the defaults", "error", err)
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
	return namesFrom(read(AssistantNameKey), read(InstitutionNameKey), read(SystemNameKey))
}

// DefaultRolePrompt is the KB part of the prompt for an answer that has no KB
// (library chat, eval answers): the default template role with its rules,
// compiled in lang and resolved to n, so such an answer has an identity too.
func DefaultRolePrompt(lang string, n Names) string {
	p, _ := Compile(Default(), "", lang)
	return n.Resolve(p)
}
