package chat

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"sync"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/kbaccess"
	"github.com/justrag/go-backend/internal/logctx"
)

// Citation visibility (kbaccess capability seeCitations).
//
// A caller without seeCitations on a KB receives its answers without any
// source attribution: no sources (file names, file ids, chunk text, pages,
// dates), no conflict findings (they name files), no per-citation
// verification, no retrieved-chunk previews in trajectory or tool-trace
// frames, no provenance columns in a corpus table, no cited KB passages in
// comparison findings, and no inline [n] markers in the answer text.
//
// What is STORED never changes: messages.sources, messages.conflicts,
// messages.verification and the answer text with its markers are written in
// full whoever asks. Redaction happens only on the way out, per request and
// for the current reader, so a KB admin who later grants seeCitations makes
// the existing history show its citations retroactively — and a reader
// whose capability is withdrawn stops seeing them on the next read.
//
// The answer prompt is unchanged too, so the model still cites with [n]
// markers and may, in prose, still name a document it read; the markers are
// stripped here, prose is not rewritten.

// citationStripRe matches one citation marker in the single format
// citationMarkerRe defines, plus the horizontal whitespace before it, so
// "Satz [2]." becomes "Satz." rather than "Satz ."
var citationStripRe = regexp.MustCompile(`[ \t]*` + citationMarkerRe.String())

// citationHoldRe matches the tail of a streamed text that may still become
// (the leading whitespace of) a citation marker once the next chunk
// arrives: trailing blanks, optionally followed by "[" or "[<digits, commas,
// spaces>". Leftmost match, so it starts at the first blank of the run.
var citationHoldRe = regexp.MustCompile(`[ \t]*(?:\[(?:\d[\d,\s]*)?)?$`)

// maxCitationHold bounds how much text a CitationMarkerStream holds back. A
// real marker ("[1, 2, 5]") is far shorter; a longer tail is released as is.
const maxCitationHold = 64

// StripCitationMarkers removes every citation marker ([3], [1, 2, 5]) from
// text. Markers whose numbers are all non-positive are not citations
// (ExtractCitationSpans skips them too) and stay.
func StripCitationMarkers(text string) string {
	if !strings.Contains(text, "[") {
		return text
	}
	return citationStripRe.ReplaceAllStringFunc(text, func(m string) string {
		inner := m[strings.IndexByte(m, '[')+1 : len(m)-1]
		if len(parseCitationNumbers(inner)) == 0 {
			return m
		}
		return ""
	})
}

// CitationMarkerStream strips citation markers from text that arrives in
// chunks, where a marker can be split across two chunks ("[1" + "2]"). Feed
// returns what can be sent now and holds back a tail that may still turn
// into a marker; Flush releases that tail at the end of the text. Not safe
// for concurrent use.
type CitationMarkerStream struct {
	pending string
}

// Feed adds a chunk and returns the text that can be sent now, markers
// removed. The result may be empty while a possible marker is held back.
func (s *CitationMarkerStream) Feed(chunk string) string {
	buf := s.pending + chunk
	cut := len(buf)
	if loc := citationHoldRe.FindStringIndex(buf); loc != nil && len(buf)-loc[0] <= maxCitationHold {
		cut = loc[0]
	}
	s.pending = buf[cut:]
	return StripCitationMarkers(buf[:cut])
}

// Flush returns the held-back tail, markers removed, and resets the stream.
func (s *CitationMarkerStream) Flush() string {
	out := StripCitationMarkers(s.pending)
	s.pending = ""
	return out
}

// CitationFilter redacts the frames of one response for a caller without
// seeCitations — the web chat's SSE frames and JSON body, and the public
// API's, which share their keys. A nil *CitationFilter is "citations
// visible": every method passes its input through unchanged, so callers
// never branch. Safe for concurrent use (post-response frames are emitted
// from worker goroutines).
type CitationFilter struct {
	mu        sync.Mutex
	content   CitationMarkerStream
	reasoning CitationMarkerStream
}

// NewCitationFilter returns a filter that strips source attribution.
func NewCitationFilter() *CitationFilter { return &CitationFilter{} }

// Frames returns the frames to write in place of the streamed frame data:
// none, one, or — when held-back answer text has to go out first — two.
// Streamed answer and reasoning text ({"content": …} / {"reasoning": …})
// pass through a marker stream; every other frame first flushes it, so the
// text keeps its place in the stream. A frame of a shape the filter does
// not know is dropped (fail closed).
func (f *CitationFilter) Frames(data any) []any {
	if f == nil {
		return []any{data}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if m, ok := data.(map[string]string); ok && len(m) == 1 {
		if s, ok := m["content"]; ok {
			return textFrame("content", f.content.Feed(s))
		}
		if s, ok := m["reasoning"]; ok {
			return textFrame("reasoning", f.reasoning.Feed(s))
		}
	}
	out := f.flushLocked()
	switch v := data.(type) {
	case map[string]string:
		// error / aiMessageId: plain status frames, no attribution.
		out = append(out, v)
	case map[string]any:
		if r := redactCitationFields(v); len(r) > 0 {
			out = append(out, r)
		}
	}
	return out
}

// Flush returns the frames still held back; written before the stream's
// terminator.
func (f *CitationFilter) Flush() []any {
	if f == nil {
		return nil
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.flushLocked()
}

// Payload redacts a whole (non-streaming) response body.
func (f *CitationFilter) Payload(m map[string]any) map[string]any {
	if f == nil {
		return m
	}
	return redactCitationFields(m)
}

func (f *CitationFilter) flushLocked() []any {
	var out []any
	out = append(out, textFrame("reasoning", f.reasoning.Flush())...)
	out = append(out, textFrame("content", f.content.Flush())...)
	return out
}

func textFrame(key, s string) []any {
	if s == "" {
		return nil
	}
	return []any{map[string]string{key: s}}
}

// redactCitationFields returns a copy of one response object with every
// source-attributing key removed or emptied. The keys are the chat wire
// format's (web SSE frames, the web and public-API JSON bodies):
//
//   - sources: kept as an empty list, so a client still recognises the
//     opening frame (it carries chatId / userMessageId too)
//   - conflicts: removed ("absent means nothing to report")
//   - verification: see redactVerification
//   - agentTrajectory: retrieved-chunk previews removed, markers stripped
//   - structuredTable: provenance columns removed (redactStructuredTable)
//   - comparisonFindings: the cited KB file ids and passage removed
//   - args / preview: the answer-tool trace's call arguments and result
//     preview (a kb_search result is numbered chunks with file names)
//   - answer / content / reasoning / refinedAnswer / followUpQuestions:
//     citation markers stripped
//
// A value of an unexpected type under one of these keys is dropped.
func redactCitationFields(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		switch k {
		case "sources":
			out[k] = []ChatSource{}
		case "conflicts", "args", "preview":
			// dropped
		case "verification":
			if r, ok := redactVerificationValue(v); ok {
				out[k] = r
			}
		case "agentTrajectory":
			switch e := v.(type) {
			case TrajectoryEvent:
				out[k] = redactTrajectory(e)
			case *TrajectoryEvent:
				if e != nil {
					out[k] = redactTrajectory(*e)
				}
			}
		case "structuredTable":
			if t, ok := v.(*StructuredTable); ok {
				out[k] = redactStructuredTable(t)
			}
		case "comparisonFindings":
			if fs, ok := v.([]Finding); ok {
				out[k] = redactFindings(fs)
			}
		case "answer", "content", "reasoning", "refinedAnswer":
			switch s := v.(type) {
			case string:
				out[k] = StripCitationMarkers(s)
			case nil:
				out[k] = nil
			}
		case "followUpQuestions":
			if qs, ok := v.([]string); ok {
				out[k] = stripMarkersAll(qs)
			}
		default:
			out[k] = v
		}
	}
	return out
}

func redactVerificationValue(v any) (any, bool) {
	switch mv := v.(type) {
	case nil:
		return nil, true
	case *MessageVerification:
		return redactVerification(mv), true
	case MessageVerification:
		return redactVerification(&mv), true
	}
	return nil, false
}

// redactVerification keeps the verdicts a reader can act on (verified,
// score, refine status, the flagged claims' text) and drops what points
// into the sources: the per-citation entries (incl. their quote spans into
// a source's text), the cited source number of a flagged claim, and the
// Self-RAG per-source relevance list.
func redactVerification(v *MessageVerification) *MessageVerification {
	if v == nil {
		return nil
	}
	out := &MessageVerification{
		Verified: v.Verified,
		Score:    v.Score,
		Issues:   stripMarkersAll(v.Issues),
		Refine:   v.Refine,
	}
	if v.Factuality != nil {
		out.Factuality = &FactualityVerification{FlaggedClaims: redactFlaggedClaims(v.Factuality.FlaggedClaims)}
	}
	if v.SelfRAG != nil {
		out.SelfRAG = &SelfRAGVerification{
			Relevance:     []ChunkRelevanceStatus{},
			FlaggedClaims: redactFlaggedClaims(v.SelfRAG.FlaggedClaims),
			Usefulness: UsefulnessStatus{
				Verdict: v.SelfRAG.Usefulness.Verdict,
				Reason:  StripCitationMarkers(v.SelfRAG.Usefulness.Reason),
			},
		}
	}
	return out
}

func redactFlaggedClaims(in []FlaggedClaimStatus) []FlaggedClaimStatus {
	if in == nil {
		return nil
	}
	out := make([]FlaggedClaimStatus, len(in))
	for i, c := range in {
		out[i] = FlaggedClaimStatus{ClaimText: StripCitationMarkers(c.ClaimText), Reason: c.Reason}
	}
	return out
}

func redactTrajectory(e TrajectoryEvent) TrajectoryEvent {
	e.Chunks = nil
	e.RefinedText = StripCitationMarkers(e.RefinedText)
	if e.Diff != nil {
		diff := make([]DiffChunk, len(e.Diff))
		for i, d := range e.Diff {
			diff[i] = DiffChunk{Kind: d.Kind, Text: StripCitationMarkers(d.Text)}
		}
		e.Diff = diff
	}
	return e
}

// corpusTableProvenanceKeys are TableRow's reserved provenance keys
// (corpus_table_types.go): the source file's id and name and its citation
// index.
var corpusTableProvenanceKeys = []string{"_file_id", "_file_name", "_source_idx"}

// redactStructuredTable drops a corpus table's provenance: the reserved row
// keys and every column computed from the source file name.
func redactStructuredTable(t *StructuredTable) *StructuredTable {
	if t == nil {
		return nil
	}
	drop := map[string]bool{}
	for _, k := range corpusTableProvenanceKeys {
		drop[k] = true
	}
	cols := make([]TableColumn, 0, len(t.Columns))
	for _, c := range t.Columns {
		if c.DeriveFrom == "filename" {
			drop[c.Key] = true
			continue
		}
		cols = append(cols, c)
	}
	rows := make([]TableRow, len(t.Rows))
	for i, r := range t.Rows {
		nr := make(TableRow, len(r))
		for k, v := range r {
			if !drop[k] {
				nr[k] = v
			}
		}
		rows[i] = nr
	}
	return &StructuredTable{Columns: cols, Rows: rows, Truncated: t.Truncated, TotalFiles: t.TotalFiles}
}

func redactFindings(in []Finding) []Finding {
	out := make([]Finding, len(in))
	for i, f := range in {
		f.CitedFileIDs = []string{}
		f.CitedQuote = ""
		out[i] = f
	}
	return out
}

func stripMarkersAll(in []string) []string {
	if in == nil {
		return nil
	}
	out := make([]string, len(in))
	for i, s := range in {
		out[i] = StripCitationMarkers(s)
	}
	return out
}

// RedactMessagesForReader strips source attribution from stored messages
// before they are returned to a reader without seeCitations. The rows are
// modified in place; what is stored is untouched. Only AI messages carry
// attribution — a user's own question is returned as typed.
func RedactMessagesForReader(msgs []MessageRow) {
	for i := range msgs {
		m := &msgs[i]
		if m.Role != "ai" {
			continue
		}
		m.Content = StripCitationMarkers(m.Content)
		if m.Reasoning != nil {
			r := StripCitationMarkers(*m.Reasoning)
			m.Reasoning = &r
		}
		if len(m.Sources) > 0 && string(m.Sources) != "null" {
			m.Sources = json.RawMessage("[]")
		}
		m.Verification = redactVerification(m.Verification)
		m.Conflicts = nil
		m.StructuredTable = redactStructuredTable(m.StructuredTable)
	}
}

// citationFilterKey carries the request's *CitationFilter. writeSSE and
// writeSSEDone read it, so every frame of a KB chat turn — whichever
// orchestrator, early-open turn or post-response task writes it — passes
// the one filter.
type citationFilterKey struct{}

func withCitationFilter(ctx context.Context, f *CitationFilter) context.Context {
	return context.WithValue(ctx, citationFilterKey{}, f)
}

func citationFilterFrom(ctx context.Context) *CitationFilter {
	f, _ := ctx.Value(citationFilterKey{}).(*CitationFilter)
	return f
}

// citationsVisible reports whether user may see citations on kbID. The
// request's own access result answers when it is for this KB (the route's
// RequireKBRole resolved it); otherwise — a chat's stored messages, or a
// turn the KB router moved to another KB — the capability is resolved
// through the same ladder (kbaccess.ResolveCapabilities). Fails closed: no
// way to resolve, or an error, hides citations.
func (h *Handler) citationsVisible(ctx context.Context, kbID string, user *auth.Claims) bool {
	if a := kbaccess.AccessFromContext(ctx); a != nil && a.KB != nil && a.KB.ID == kbID {
		return a.Capabilities().SeeCitations
	}
	if h.kbAccess == nil || user == nil {
		return false
	}
	caps, err := kbaccess.ResolveCapabilities(ctx, h.kbAccess, kbID, user.ID, user.Role)
	if err != nil {
		logctx.From(ctx).Warn("chat: resolve citation visibility; hiding citations", "kb_id", kbID, "error", err)
		return false
	}
	return caps.SeeCitations
}

// withCitationVisibility attaches a CitationFilter to ctx when user may not
// see citations on kbID.
func (h *Handler) withCitationVisibility(ctx context.Context, kbID string, user *auth.Claims) context.Context {
	if h.citationsVisible(ctx, kbID, user) {
		return ctx
	}
	return withCitationFilter(ctx, NewCitationFilter())
}
