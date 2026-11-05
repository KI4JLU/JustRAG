package kbbehavior

import (
	"sync/atomic"
)

// The role templates every process answers with: a snapshot of the
// role_templates table, swapped whole on every refresh (templates_store_pg.go),
// so the read path — every answer compiles its prompt through it — takes no
// lock and never sees a half-updated catalog. Until the first load it holds
// builtinRoles.
type roleRegistry struct {
	roles     []templateRole
	defaultID string
}

var registry atomic.Pointer[roleRegistry]

func init() { setTemplates(builtinRoles) }

// setTemplates installs roles (in display order) as the catalog. Exactly one
// is the default; with none marked (never written so by the store) the first
// role is.
func setTemplates(roles []templateRole) {
	r := &roleRegistry{roles: roles}
	for _, t := range roles {
		if t.isDefault {
			r.defaultID = t.id
			break
		}
	}
	if r.defaultID == "" && len(roles) > 0 {
		r.defaultID = roles[0].id
	}
	registry.Store(r)
}

func templateRoles() []templateRole { return registry.Load().roles }

// findTemplateRole finds a template by id, a disabled one too: KBs and chats
// that use it keep answering with it.
func findTemplateRole(id string) (templateRole, bool) {
	for _, r := range templateRoles() {
		if r.id == id {
			return r, true
		}
	}
	return templateRole{}, false
}

// TemplateStartOf is how a template role starts its chat where a KB sets up
// none of its own („Vorlagen"); false for a role without a start of its own
// or one that is no template.
func TemplateStartOf(id string) (TemplateStart, bool) {
	r, ok := findTemplateRole(id)
	if !ok || r.start == nil {
		return TemplateStart{}, false
	}
	return *r.start, true
}

// DefaultRoleID is the role a new KB starts with: the template marked as the
// default in „Vorlagen".
func DefaultRoleID() string { return registry.Load().defaultID }

// BuiltinTemplates are the templates a fresh install starts with
// (builtinRoles), in display order, as „Vorlagen" reads them. Migration 0100
// writes the same rows; a test holds the two together.
func BuiltinTemplates() []AdminTemplate {
	out := make([]AdminTemplate, 0, len(builtinRoles))
	for _, r := range builtinRoles {
		out = append(out, AdminTemplate{ID: r.id, TemplateInput: TemplateInput{
			Icon: r.icon, IsDefault: r.isDefault, Enabled: !r.disabled,
			Name:        Texts{DE: r.name.de, EN: r.name.en},
			Description: Texts{DE: r.description.de, EN: r.description.en},
			Prompt:      Texts{DE: r.prompt.de, EN: r.prompt.en},
			Cover:       Cover{From: r.coverFrom, To: r.coverTo},
			Start:       r.start,
		}})
	}
	return out
}
