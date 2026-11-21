package adkbridge

import (
	"errors"
	"slices"

	"github.com/justrag/go-backend/internal/kbaccess"
)

// Routes the agent-chat retrieve node emits.
const (
	RouteFound      = "found"
	RouteNoEvidence = "no_evidence"
	RouteNoFiles    = "no_files"
)

// ErrLibraryScopeUnsupported: retrieval over library files lands with the
// user-file-library "chat with my files" work.
var ErrLibraryScopeUnsupported = errors.New("adkbridge: library-file retrieval not available yet")

// Action is one suggestion offered in a pause (plan §6a).
type Action struct {
	ID           string     `json:"id"`
	Tool         string     `json:"tool,omitempty"`
	FrontendTool string     `json:"frontendTool,omitempty"`
	Label        string     `json:"label"`
	SideEffect   SideEffect `json:"sideEffect,omitempty"`
	RequiresRole string     `json:"requiresRole,omitempty"`
	// RequiresCapability is the kbaccess capability the action needs on
	// top of RequiresRole (addSources for the KB-writing actions).
	RequiresCapability kbaccess.Capability `json:"requiresCapability,omitempty"`
	Args               map[string]any      `json:"args,omitempty"`
}

// VisibleActions keeps frontend actions and the server tools that are
// allowlisted and executable by the running user. Execution re-checks at
// dispatch; this only avoids offering buttons that would fail.
func VisibleActions(sc Scope, actions []Action, allowed []string) []Action {
	out := make([]Action, 0, len(actions))
	for _, a := range actions {
		if a.Tool == "" {
			out = append(out, a)
			continue
		}
		p := PolicyFor(a.Tool)
		if !slices.Contains(allowed, a.Tool) || !RoleAtLeast(sc.Role, p.RequiresRole) ||
			!capabilityAllowed(sc, p) ||
			(privilegedInBridge(a.Tool) && !sc.AllowPrivileged) {
			continue
		}
		a.SideEffect, a.RequiresRole, a.RequiresCapability = p.SideEffect, p.RequiresRole, p.RequiresCapability
		out = append(out, a)
	}
	return out
}
