package chat

import (
	"context"
	"encoding/json"
	"time"
)

// MessageVerification is the JSON blob persisted on `messages.verification`
// and emitted to the frontend as `{"verification": ...}`.
//
// It carries the editorial verdict from the LLM-based factchecker
// (Verified/Score/Issues — present when factchecking ran) plus the
// deterministic per-citation verdict from the n-gram-based citation
// validator (Citations — present when citation validation ran).
//
// Either subsystem may run independently; the wrapper is emitted whenever
// at least one ran. Fields the inactive subsystem produced are zero-valued
// (Verified=false, Score=0, Issues=nil, Citations=nil) and the frontend
// must treat their absence as "not run", not "failed".
//
// Wire format (matches the existing `verification` SSE payload, extended):
//
//	{
//	  "verified": bool,             // factcheck verdict
//	  "score":    number,           // factcheck 0..100
//	  "issues":   [string],         // factcheck findings
//	  "citations":[                  // citation-validator per-N entries (optional)
//	    {"n": 3, "verified": false, "reason": "no_overlap"},
//	    {"n": 1, "verified": true, "method": "span",
//	     "span": {"start": 19, "end": 48}}   // rune offsets into sources[n-1].content
//	  ]
//	}
type MessageVerification struct {
	Verified  bool             `json:"verified"`
	Score     float64          `json:"score"`
	Issues    []string         `json:"issues"`
	Citations []CitationStatus `json:"citations,omitempty"`
	// Factuality is the Phase 3 §3.3 factuality-verifier verdict —
	// per-claim flags for unsupported / contradicted / out-of-scope
	// passages. Present only when the verifier ran; absent when its
	// site_config is off or the cost gate skipped it for this answer.
	Factuality *FactualityVerification `json:"factuality,omitempty"`
	// Refine carries the AP-A1 refine-gate metadata: the mode picked
	// (surgical|holistic), the count of unsupported/contradicted
	// claims that triggered refine, and the verifier's verdict on the
	// refined text. Present only when chat_factuality_gate_enabled is
	// on AND the verifier produced ≥1 refine-eligible claim. Absent
	// otherwise.
	Refine *RefineStatus `json:"refine,omitempty"`
	// SelfRAG is the AP-D2 unified verifier output (ISREL + ISSUP +
	// ISUSE). Present only when chat_self_rag_enabled is on AND the
	// verifier ran. When present it REPLACES Factuality (above) — the
	// two are mutually exclusive in the post-response path. The
	// frontend reads .SelfRAG when present, otherwise falls back to
	// .Factuality, so the cutover doesn't break existing UI.
	SelfRAG *SelfRAGVerification `json:"self_rag,omitempty"`
}

// SelfRAGVerification is the on-disk JSON shape for AP-D2 verifier
// output. Mirrors ai.SelfRAGResult but uses chat-side types so the
// chat package doesn't import ai for this small shape.
type SelfRAGVerification struct {
	Relevance     []ChunkRelevanceStatus `json:"isrel"`
	FlaggedClaims []FlaggedClaimStatus   `json:"issup"`
	Usefulness    UsefulnessStatus       `json:"isuse"`
}

// ChunkRelevanceStatus mirrors ai.ChunkRelevance on the wire.
type ChunkRelevanceStatus struct {
	N       int    `json:"n"`
	Verdict string `json:"verdict"` // "relevant" | "partially_relevant" | "irrelevant"
}

// UsefulnessStatus mirrors ai.UsefulnessVerdict on the wire.
type UsefulnessStatus struct {
	Verdict string `json:"verdict"` // "yes" | "partial" | "no"
	Reason  string `json:"reason"`
}

// RefineStatus mirrors ai.RefineResult on the chat-side wire so the
// frontend can show "this answer was rewritten after a fact check"
// without importing AI types. Mode is the same closed enum as
// prompts.RefineMode: "surgical" | "holistic". ClaimsBefore counts
// only refine-triggering reasons (unsupported / contradicted) — it
// can differ from len(Factuality.FlaggedClaims) when out_of_scope
// claims also fired. ClaimsAfter is the verifier's second-pass count
// over the same answer, after refine; same filter applies.
type RefineStatus struct {
	Mode         string `json:"mode"`
	ClaimsBefore int    `json:"claims_before"`
	ClaimsAfter  int    `json:"claims_after"`
}

// FactualityVerification is the on-disk JSON shape for the
// factuality-verifier output. The slice may be empty (verifier ran
// and the answer was clean); a nil pointer means "verifier did NOT
// run" — the frontend treats absence and empty differently.
type FactualityVerification struct {
	FlaggedClaims []FlaggedClaimStatus `json:"flagged_claims"`
}

// FlaggedClaimStatus mirrors ai.FlaggedClaim on the chat-side wire so
// the chat package doesn't import ai for this small shape. Reason is
// the same closed enum: "unsupported" | "contradicted" | "out_of_scope".
type FlaggedClaimStatus struct {
	ClaimText string `json:"claim_text"`
	Reason    string `json:"reason"`
	CitedN    int    `json:"cited_n,omitempty"`
}

// ChatRow represents a row from the chats table.
type ChatRow struct {
	ID        string    `json:"id" db:"id"`
	KbID      string    `json:"kbId" db:"kb_id"`
	UserID    string    `json:"userId" db:"user_id"`
	Title     string    `json:"title" db:"title"`
	Type      string    `json:"type" db:"type"`
	TeamID    *string   `json:"teamId" db:"team_id"`
	AgentID   *string   `json:"agentId" db:"agent_id"`
	CreatedAt time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt time.Time `json:"updatedAt" db:"updated_at"`
	// BranchedFromChatID is the chat this one was branched from
	// (POST /api/chats/{id}/branch), nil for an ordinary chat. The history
	// marks a branched chat with the branch icon. The origin may have been
	// deleted since; the id is not a reference to follow.
	BranchedFromChatID *string `json:"branchedFromChatId,omitempty" db:"branched_from_chat_id"`
	// HasBranches is set by GetChats only (the chat list): true when the chat
	// holds at least two sibling messages — an edited question, a regenerated
	// answer, or a fork made inside the chat before branching opened a new
	// chat — so the history marks those older branched chats too. Every other
	// read leaves it false, and it is omitted from the JSON then.
	HasBranches bool `json:"hasBranches,omitempty" db:"-"`
}

// BranchResult is a new branch chat and the id of the copy of the message
// it was branched at — the parent the client sends its next turn under (or
// the question it asks to have answered). Empty for an empty branch.
type BranchResult struct {
	ChatRow
	CopiedMessageID string `json:"copiedMessageId,omitempty"`
}

// MessageRow represents a row from the messages table.
//
// Sources is stored on disk as a JSONB array of ChatSource objects (the
// retrieval result surfaced to the user) and decoded into the typed slice
// when the row is read. Verification is the JSONB blob produced by the
// LLM-based factchecker and the citation validator (see MessageVerification);
// either subsystem may run independently, so a nil pointer means "not run"
// and an empty struct means "ran but found nothing".
//
// Both fields preserve the existing wire format — Sources and Verification
// emit `null` (not omitted) when their underlying JSONB column was NULL or
// the message hasn't run through the corresponding pipeline stage. The
// frontend's `Message` interface depends on that shape (see web/src/types.ts).
type MessageRow struct {
	ID              string  `json:"id" db:"id"`
	ChatID          string  `json:"chatId" db:"chat_id"`
	ParentMessageID *string `json:"parentMessageId" db:"parent_message_id"`
	Role            string  `json:"role" db:"role"`
	Content         string  `json:"content" db:"content"`
	// Sources is passed through as stored, not re-encoded from a typed
	// value. Research/academic sessions reuse this column for their
	// findings ([{content, sources, relevanceScore}]), which a []ChatSource
	// round-trip silently truncated. toMessageRow still decodes it into
	// []ChatSource as a validation step, so schema drift is caught.
	Sources           json.RawMessage      `json:"sources" db:"sources"`
	IsEnhanced        bool                 `json:"isEnhanced" db:"is_enhanced"`
	EnhancedQuery     *string              `json:"enhancedQuery" db:"enhanced_query"`
	Reasoning         *string              `json:"reasoning" db:"reasoning"`
	Feedback          *string              `json:"feedback" db:"feedback"`
	FeedbackComment   *string              `json:"feedbackComment,omitempty" db:"feedback_comment"`
	FeedbackUpdatedAt *time.Time           `json:"feedbackUpdatedAt,omitempty" db:"feedback_updated_at"`
	Verification      *MessageVerification `json:"verification" db:"verification"`
	TraceID           *string              `json:"traceId,omitempty" db:"trace_id"`
	StructuredTable   *StructuredTable     `json:"structured_table,omitempty" db:"structured_table"`
	// Conflicts is the W5-R7 conflict / supersession list, computed at
	// answer time (unlike Verification, which is a post-response update),
	// so it is written by AddMessage and never patched afterwards.
	//
	// The BARE ARRAY, deliberately: the SSE frame, the non-streaming
	// response body and a reloaded message all carry the same shape, so a
	// client reads `conflicts[0].claim` on every surface and cannot drift.
	// `omitempty` keeps the key absent for the overwhelming majority of
	// turns, which is what makes "absent means not run" hold.
	Conflicts []MessageConflict `json:"conflicts,omitempty" db:"conflicts"`
	// Attachments are the files attached to a user message (migration 0090),
	// filled by GetMessages; omitted when there are none.
	Attachments []MessageAttachment `json:"attachments,omitempty" db:"-"`
	TeamID      *string             `json:"teamId,omitempty" db:"team_id"`
	AgentID     *string             `json:"agentId,omitempty" db:"agent_id"`
	CreatedAt   time.Time           `json:"createdAt" db:"created_at"`
}

// DecodedSources returns Sources as typed chat sources for the few callers
// that need to read individual fields (as opposed to forwarding the column to
// the client). Returns nil when the column is absent or does not hold chat
// sources — rows loaded through toMessageRow have already been validated, so
// in practice this only yields nil for genuinely empty columns.
func (m MessageRow) DecodedSources() []ChatSource {
	if len(m.Sources) == 0 {
		return nil
	}
	var out []ChatSource
	if err := json.Unmarshal(m.Sources, &out); err != nil {
		return nil
	}
	return out
}

// AddMessageParams collects the inputs for Store.AddMessage. Using a struct
// instead of positional parameters avoids the maintenance hazard of a
// 9-argument signature: callers name the fields they set, defaults stay zero,
// and adding a new column (e.g. another optional pointer) does not force every
// call site to grow another anonymous nil.
type AddMessageParams struct {
	ChatID          string
	Role            string
	Content         string
	Sources         []ChatSource
	IsEnhanced      bool
	EnhancedQuery   *string
	Reasoning       *string
	ParentMessageID *string
	StructuredTable *StructuredTable
	// Conflicts is the W5-R7 conflict list for this turn; empty (the common
	// case) inserts SQL NULL rather than an empty array, so "absent means
	// not run" survives the round trip.
	Conflicts []MessageConflict
	// TeamID / AgentID attribute an AI message to the user-created team or
	// agent that produced it (nil on user messages and non-team turns).
	TeamID  *string
	AgentID *string
	// AttachmentIDs are the user_files ids attached to a user message, in the
	// order the user attached them (message_attachments, migration 0090).
	// Written in the same transaction as the message. Every id must already
	// have been checked to belong to the message's author.
	AttachmentIDs []string
}

// Store is the interface for chat-related database operations.
type Store interface {
	GetChats(ctx context.Context, kbID, userID string) ([]ChatRow, error)
	GetChatByID(ctx context.Context, chatID string) (*ChatRow, error)
	CreateChat(ctx context.Context, kbID, userID, title string) (*ChatRow, error)
	DeleteChat(ctx context.Context, chatID string) error
	// UpdateChatTitle renames chatID if userID owns it; store.ErrNotFound
	// when no such chat belongs to the user. Leaves updated_at untouched.
	UpdateChatTitle(ctx context.Context, chatID, userID, title string) error
	// BranchChat copies chatID's conversation from its first message down to
	// messageID into a new chat of the same user and KB, branched from
	// chatID; an empty messageID copies nothing (a branch before the first
	// question). Ordinary KB chats only. store.ErrNotFound when the chat is
	// not the user's or not branchable (library, research, agent chat), or
	// the message is not in it.
	BranchChat(ctx context.Context, chatID, messageID, userID string) (*BranchResult, error)
	GetChatMessages(ctx context.Context, chatID string) ([]MessageRow, error)
	GetMessageAncestors(ctx context.Context, messageID, chatID string) ([]MessageRow, error)
	AddMessage(ctx context.Context, params AddMessageParams) (*MessageRow, error)
	UpdateMessageFeedback(ctx context.Context, messageID, chatID, userID string, feedback *string, comment *string) error
	UpdateMessageVerification(ctx context.Context, messageID string, verification *MessageVerification) error
	UpdateMessageContent(ctx context.Context, messageID string, content string) error
	UpdateMessageTraceID(ctx context.Context, messageID string, traceID string) error
	GetKBSystemPrompt(ctx context.Context, kbID string) (*string, error)
	UpdateChatAgentSelection(ctx context.Context, chatID string, teamID, agentID *string) error
	// StarterContext returns what the starter questions of an empty chat
	// are generated from: the KB's name and up to limit of its documents.
	StarterContext(ctx context.Context, kbID string, limit int) (StarterSource, error)
}
