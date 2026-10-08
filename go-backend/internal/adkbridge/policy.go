package adkbridge

import "github.com/justrag/go-backend/internal/kbaccess"

// SideEffect classifies what a tool does outside the conversation.
type SideEffect string

const (
	SideEffectNone          SideEffect = "none"
	SideEffectExternalRead  SideEffect = "external_read"  // query leaves the house (web_search)
	SideEffectKBWrite       SideEffect = "kb_write"       // changes a KB's corpus
	SideEffectExternalWrite SideEffect = "external_write" // changes a system outside JustRAG
)

// Approval says whether a call pauses for the user before it runs.
type Approval string

const (
	ApprovalNever  Approval = "never"
	ApprovalAlways Approval = "always"
)

// ToolPolicy is enforced at dispatch time by every bridge tool.
type ToolPolicy struct {
	SideEffect   SideEffect
	RequiresRole string // minimum KB role of the RUNNING user
	Approval     Approval
}

var readOnly = ToolPolicy{SideEffect: SideEffectNone, RequiresRole: kbaccess.RoleView, Approval: ApprovalNever}

// builtinPolicies covers every built-in tool. Decisions (plan §0, §6b):
// web_search is approval-always (the query leaves the house); every write
// is approval-always and needs edit.
var builtinPolicies = map[string]ToolPolicy{
	"kb_search":         readOnly,
	"keyword_search":    readOnly,
	"graph_search":      readOnly,
	"chunk_read":        readOnly,
	"document_outline":  readOnly,
	"table_query":       readOnly,
	"calculator":        readOnly,
	"count_mentions":    readOnly,
	"recent_documents":  readOnly,
	"memory":            readOnly,
	"sql_query":         readOnly, // privileged; gated separately
	"code_exec":         readOnly, // privileged; gated separately
	"web_search":        {SideEffect: SideEffectExternalRead, RequiresRole: kbaccess.RoleView, Approval: ApprovalAlways},
	"confluence_import": {SideEffect: SideEffectKBWrite, RequiresRole: kbaccess.RoleEdit, Approval: ApprovalAlways},
	"library_add_to_kb": {SideEffect: SideEffectKBWrite, RequiresRole: kbaccess.RoleEdit, Approval: ApprovalAlways},
}

// PolicyFor returns the policy for a tool name. Unknown tools (remote MCP
// servers) get the most restrictive policy: we cannot know what they do.
func PolicyFor(name string) ToolPolicy {
	if p, ok := builtinPolicies[name]; ok {
		return p
	}
	return ToolPolicy{SideEffect: SideEffectExternalWrite, RequiresRole: kbaccess.RoleEdit, Approval: ApprovalAlways}
}

var roleRank = map[string]int{kbaccess.RoleView: 1, kbaccess.RoleEdit: 2, kbaccess.RoleAdmin: 3, kbaccess.RoleOwner: 4}

// RoleAtLeast reports whether have meets need; an unknown role meets nothing.
func RoleAtLeast(have, need string) bool {
	h, ok := roleRank[have]
	return ok && h >= roleRank[need]
}
