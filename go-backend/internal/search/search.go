// Package search serves GET /api/search, the shell header's global search:
// one request, one response with one array per result group (topics,
// sources, and — from KI-836 on — chats and messages), optionally scoped to a
// single topic.
//
// The load-bearing piece is not the matching but the visibility rule. A
// search result must never reveal a topic the caller could not open, so every
// group is filtered by visibleKBsCTE (store_pg.go), a SQL rendering of
// kbaccess.EffectiveRole's ladder, rule for rule. The listing queries in
// internal/kb and internal/kbsubs each apply a *different subset* of that
// ladder (they answer "what is on my overview", not "what may I open"), so
// none of them could be reused here. The integration test in
// store_pg_integration_test.go runs both over the same fixture matrix and
// asserts they agree on every row.
package search

import (
	"context"
	"errors"
	"time"
)

// Group limits. The limit is per group, not per response: a search for a
// common word should not let fifty file hits push every topic hit out.
const (
	DefaultLimit = 5
	MaxLimit     = 20
	// MinQueryLen is counted in runes after trimming, so "äö" is a valid
	// two-character query even though it is four bytes.
	MinQueryLen = 2
	// MaxQueryLen bounds the ILIKE pattern. Not part of the card's contract;
	// a header search box never needs more, and without a bound the pattern
	// size is limited only by the server's header size limit.
	MaxQueryLen = 200
)

// ErrNotFound means the scoping topic (kb_id) does not exist or is not
// visible to the caller. The two are deliberately indistinguishable: the
// handler answers 404 either way, so the route cannot be used to confirm that
// a hidden topic exists.
var ErrNotFound = errors.New("search: knowledge base not found")

// Caller is who is searching. SysRole is the system role from the caller's
// auth claims — the same value RequireKBRole hands to kbaccess.EffectiveRole —
// never a column read back from the users table.
type Caller struct {
	UserID  string
	SysRole string
}

// Query is one validated search request. Text is already trimmed and within
// [MinQueryLen, MaxQueryLen]; Limit within [1, MaxLimit]; KBID empty for a
// global search or a syntactically valid UUID.
type Query struct {
	Text  string
	KBID  string
	Limit int
}

// Response is the body of GET /api/search. One array per group.
//
// Chats and Messages are pointers on purpose. nil means "this group was not
// searched" and is omitted from the JSON; a non-nil pointer to an empty slice
// means "searched, nothing found" and serialises as []. Until KI-836 lands
// both are always nil, so a client can tell "no chat matched" from "chat
// search does not exist yet" instead of trusting an empty array that lies.
type Response struct {
	Query    string        `json:"query"`
	KBID     *string       `json:"kbId"`
	Topics   []TopicHit    `json:"topics"`
	Sources  []SourceHit   `json:"sources"`
	Chats    *[]ChatHit    `json:"chats,omitempty"`
	Messages *[]MessageHit `json:"messages,omitempty"`
}

// TopicHit is one knowledge base the caller may open.
type TopicHit struct {
	ID   string `json:"id"   db:"id"`
	Name string `json:"name" db:"name"`
	// Description is the head of knowledge_bases.description, falling back to
	// header_text (the same fallback GET /api/kb/catalog uses: description
	// has no editor in the UI, header_text is what admins actually write),
	// whitespace-collapsed and cut at descriptionSnippetLen characters. null
	// when both are empty.
	Description *string `json:"description" db:"description"`
	Visibility  string  `json:"visibility"  db:"visibility"`
	// Role is the caller's effective KB role on this topic — exactly what
	// kbaccess.EffectiveRole resolves to: view, edit, admin or owner.
	Role string `json:"role" db:"role"`
}

// SourceHit is one file in a topic the caller may open.
type SourceHit struct {
	ID     string `json:"id"     db:"id"`
	Name   string `json:"name"   db:"name"`
	Type   string `json:"type"   db:"type"`
	KBID   string `json:"kbId"   db:"kb_id"`
	KBName string `json:"kbName" db:"kb_name"`
}

// ChatHit is one of the caller's chats whose title matches. Defined now so
// the frontend builds against one contract; filled by KI-836.
//
// TODO: field set is this card's proposal; KI-836 may still refine it
// (together with API.md and the frontend types) — not yet confirmed.
type ChatHit struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	KBID      string    `json:"kbId"`
	KBName    string    `json:"kbName"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// MessageHit is one message in one of the caller's chats whose content
// matches, with a snippet around the match. Defined now; filled by KI-836.
//
// TODO: field set is this card's proposal; KI-836 may still refine it
// (together with API.md and the frontend types) — not yet confirmed.
type MessageHit struct {
	ID        string    `json:"id"`
	ChatID    string    `json:"chatId"`
	ChatTitle string    `json:"chatTitle"`
	KBID      string    `json:"kbId"`
	KBName    string    `json:"kbName"`
	Role      string    `json:"role"`
	Snippet   string    `json:"snippet"`
	CreatedAt time.Time `json:"createdAt"`
}

// Store runs the searches. PGStore is its only implementation.
type Store interface {
	// Search returns the topic and source groups for q. When q.KBID is set
	// and the caller cannot see that topic, it returns ErrNotFound.
	Search(ctx context.Context, caller Caller, q Query) (*Response, error)
}
