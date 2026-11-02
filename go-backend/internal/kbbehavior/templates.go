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

// DefaultRoleID is the role a new KB starts with: the template marked as the
// default in „Vorlagen".
func DefaultRoleID() string { return registry.Load().defaultID }
