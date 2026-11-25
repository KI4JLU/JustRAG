// Package glossaryaccess resolves who may do what with a translator glossary.
//
// A glossary has four roles, strictly ordered viewer < editor < admin < owner,
// held per glossary in glossary_members — the sole authority, exactly as
// kb_members is for knowledge bases (internal/kbaccess). EffectiveRole is the
// only resolution ladder, RequireGlossaryRole the only route gate, and
// VisibleGlossariesCTE the one SQL rendering of the ladder.
//
// System roles have no rung here: a superadmin or system admin is a stranger
// to somebody else's private glossary. The system role matters only for the
// translation permission, which the route chains in internal/app check before
// a glossary role is looked at.
package glossaryaccess

// Glossary roles, strictly ordered. Handlers and the middleware use these
// constants only, so a typo is a compile error.
const (
	RoleViewer = "viewer"
	RoleEditor = "editor"
	RoleAdmin  = "admin"
	RoleOwner  = "owner"
)

// Glossary visibility. There is no organization level: JLU RAG has no groups,
// the members of a glossary are its group.
const (
	VisibilityPrivate = "private"
	VisibilityGlobal  = "global"
)

// roleRank orders the roles. Unexported so the order is only asked through
// Rank and AtLeast and never duplicated.
var roleRank = map[string]int{
	RoleViewer: 0,
	RoleEditor: 1,
	RoleAdmin:  2,
	RoleOwner:  3,
}

// Rank returns the ordinal of role, or -1 when role is not a glossary role.
func Rank(role string) int {
	if r, ok := roleRank[role]; ok {
		return r
	}
	return -1
}

// AtLeast reports whether granted meets or exceeds required. An unknown value
// on either side yields false: an unparseable role never satisfies a gate.
func AtLeast(granted, required string) bool {
	g, r := Rank(granted), Rank(required)
	return g >= 0 && r >= 0 && g >= r
}

// Valid reports whether role is one of the four glossary roles.
func Valid(role string) bool { return Rank(role) >= 0 }

// Assignable reports whether role may be granted through the member routes,
// bulk add and invite links. Ownership is excluded: it moves only through the
// explicit transfer, which also keeps the single-owner invariant.
func Assignable(role string) bool {
	return role == RoleViewer || role == RoleEditor || role == RoleAdmin
}

// ValidVisibility reports whether v is a glossary visibility.
func ValidVisibility(v string) bool {
	return v == VisibilityPrivate || v == VisibilityGlobal
}
