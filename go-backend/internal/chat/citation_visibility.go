package chat

import (
	"context"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"unicode"

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
//
// Exception: a source with a userFileId is a document the reader attached
// to the chat themselves (chat attachments, migration 0090). It is no KB
// source, so it, its [n] markers and its per-citation verification stay;
// only the KB attribution goes. The kept numbers come from the response's
// own sources (the opening frame, the JSON body, the stored message).

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
// real marker is far shorter ("[1, 2, 5]"; even one listing sources 1–100 is
// under 400 bytes). A longer run of blanks is released as is; a longer
// unfinished "[<digits, commas, spaces>" is dropped instead (see Feed).
const maxCitationHold = 512

// StripCitationMarkers removes every citation marker ([3], [1, 2, 5]) from
// text. Markers whose numbers are all non-positive are not citations
// (ExtractCitationSpans skips them too) and stay.
func StripCitationMarkers(text string) string {
	return stripCitationMarkersExcept(text, nil)
}

// stripCitationMarkersExcept is StripCitationMarkers that keeps the numbers
// in keep: a marker citing only kept numbers stays as it is, one citing only
// others goes, and a mixed one is rewritten to its kept numbers ("[1, 5]"
// with 5 kept becomes "[5]").
func stripCitationMarkersExcept(text string, keep map[int]bool) string {
	if !strings.Contains(text, "[") {
		return text
	}
	return citationStripRe.ReplaceAllStringFunc(text, func(m string) string {
		open := strings.IndexByte(m, '[')
		nums := parseCitationNumbers(m[open+1 : len(m)-1])
		if len(nums) == 0 {
			return m
		}
		kept := make([]string, 0, len(nums))
		for _, n := range nums {
			if keep[n] {
				kept = append(kept, strconv.Itoa(n))
			}
		}
		switch len(kept) {
		case 0:
			return ""
		case len(nums):
			return m
		default:
			return m[:open] + "[" + strings.Join(kept, ", ") + "]"
		}
	})
}

// keptCitationNumbers returns the citation numbers of the sources that stay
// visible to a reader without seeCitations: the user's own attachments.
func keptCitationNumbers(sources []ChatSource) map[int]bool {
	var keep map[int]bool
	for _, s := range sources {
		if s.UserFileID == "" || s.Index <= 0 {
			continue
		}
		if keep == nil {
			keep = make(map[int]bool)
		}
		keep[s.Index] = true
	}
	return keep
}

// ownSources returns the sources that stay visible: the user's attachments.
// Never nil, so the opening frame keeps its empty list.
func ownSources(sources []ChatSource) []ChatSource {
	out := []ChatSource{}
	for _, s := range sources {
		if s.UserFileID != "" {
			out = append(out, s)
		}
	}
	return out
}

// CitationMarkerStream strips citation markers from text that arrives in
// chunks, where a marker can be split across two chunks ("[1" + "2]"). Feed
// returns what can be sent now and holds back a tail that may still turn
// into a marker; Flush releases that tail at the end of the text. Not safe
// for concurrent use.
type CitationMarkerStream struct {
	// keep lists citation numbers that are not stripped (see
	// stripCitationMarkersExcept). nil strips every marker.
	keep    map[int]bool
	pending string
	// dropping is set while the stream discards a possible marker that
	// outgrew maxCitationHold: its prefix cannot be sent (the closing "]"
	// would make it a marker nobody can take back), so it is discarded up
	// to and including that "]", or up to the first character that ends it
	// otherwise. Fail closed: such a run is dropped even if it turns out not
	// to be a marker.
	dropping bool
}

// Feed adds a chunk and returns the text that can be sent now, markers
// removed. The result may be empty while a possible marker is held back.
func (s *CitationMarkerStream) Feed(chunk string) string {
	if s.dropping {
		i := strings.IndexFunc(chunk, func(r rune) bool {
			return !(r == ',' || (r >= '0' && r <= '9') || unicode.IsSpace(r))
		})
		if i < 0 {
			return ""
		}
		s.dropping = false
		chunk = strings.TrimPrefix(chunk[i:], "]")
	}
	buf := s.pending + chunk
	cut := len(buf)
	if loc := citationHoldRe.FindStringIndex(buf); loc != nil {
		switch {
		case len(buf)-loc[0] <= maxCitationHold:
			cut = loc[0]
		case strings.Contains(buf[loc[0]:], "["):
			// An oversized possible marker: drop it, with the blanks before
			// it (as the marker strip would), and keep dropping.
			s.pending, s.dropping = "", true
			return stripCitationMarkersExcept(buf[:loc[0]], s.keep)
		}
	}
	s.pending = buf[cut:]
	return stripCitationMarkersExcept(buf[:cut], s.keep)
}

// Flush returns the held-back tail, markers removed, and resets the stream.
func (s *CitationMarkerStream) Flush() string {
	out := stripCitationMarkersExcept(s.pending, s.keep)
	s.pending, s.dropping = "", false
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
	// keep is set from the response's sources frame: the citation numbers of
	// the reader's own attachments, which are not stripped.
	keep map[int]bool
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
		if src, ok := v["sources"].([]ChatSource); ok {
			f.keep = keptCitationNumbers(src)
			f.content.keep, f.reasoning.keep = f.keep, f.keep
		}
		if r := redactCitationFields(v, f.keep); len(r) > 0 {
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
	var keep map[int]bool
	if src, ok := m["sources"].([]ChatSource); ok {
		keep = keptCitationNumbers(src)
	}
	return redactCitationFields(m, keep)
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
//   - sources: only the reader's own attachments stay (an empty list when
//     there are none), so a client still recognises the opening frame (it
//     carries chatId / userMessageId too)
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
// A value of an unexpected type under one of these keys is dropped. Markers
// citing a number in keep stay (stripCitationMarkersExcept).
func redactCitationFields(m map[string]any, keep map[int]bool) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		switch k {
		case "sources":
			src, _ := v.([]ChatSource)
			out[k] = ownSources(src)
		case "conflicts", "args", "preview":
			// dropped
		case "verification":
			if r, ok := redactVerificationValue(v, keep); ok {
				out[k] = r
			}
		case "agentTrajectory":
			switch e := v.(type) {
			case TrajectoryEvent:
				out[k] = redactTrajectory(e, keep)
			case *TrajectoryEvent:
				if e != nil {
					out[k] = redactTrajectory(*e, keep)
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
				out[k] = stripCitationMarkersExcept(s, keep)
			case nil:
				out[k] = nil
			}
		case "followUpQuestions":
			if qs, ok := v.([]string); ok {
				out[k] = stripMarkersAll(qs, keep)
			}
		default:
			out[k] = v
		}
	}
	return out
}

func redactVerificationValue(v any, keep map[int]bool) (any, bool) {
	switch mv := v.(type) {
	case nil:
		return nil, true
	case *MessageVerification:
		return redactVerification(mv, keep), true
	case MessageVerification:
		return redactVerification(&mv, keep), true
	}
	return nil, false
}

// redactVerification keeps the verdicts a reader can act on (verified,
// score, refine status, the flagged claims' text) and drops what points
// into the KB sources: the per-citation entries (incl. their quote spans
// into a source's text) except those of kept numbers, the cited source
// number of a flagged claim, and the Self-RAG per-source relevance list.
func redactVerification(v *MessageVerification, keep map[int]bool) *MessageVerification {
	if v == nil {
		return nil
	}
	out := &MessageVerification{
		Verified: v.Verified,
		Score:    v.Score,
		Issues:   stripMarkersAll(v.Issues, keep),
		Refine:   v.Refine,
	}
	for _, c := range v.Citations {
		if keep[c.N] {
			out.Citations = append(out.Citations, c)
		}
	}
	if v.Factuality != nil {
		out.Factuality = &FactualityVerification{FlaggedClaims: redactFlaggedClaims(v.Factuality.FlaggedClaims, keep)}
	}
	if v.SelfRAG != nil {
		out.SelfRAG = &SelfRAGVerification{
			Relevance:     []ChunkRelevanceStatus{},
			FlaggedClaims: redactFlaggedClaims(v.SelfRAG.FlaggedClaims, keep),
			Usefulness: UsefulnessStatus{
				Verdict: v.SelfRAG.Usefulness.Verdict,
				Reason:  stripCitationMarkersExcept(v.SelfRAG.Usefulness.Reason, keep),
			},
		}
	}
	return out
}

func redactFlaggedClaims(in []FlaggedClaimStatus, keep map[int]bool) []FlaggedClaimStatus {
	if in == nil {
		return nil
	}
	out := make([]FlaggedClaimStatus, len(in))
	for i, c := range in {
		out[i] = FlaggedClaimStatus{ClaimText: stripCitationMarkersExcept(c.ClaimText, keep), Reason: c.Reason}
	}
	return out
}

func redactTrajectory(e TrajectoryEvent, keep map[int]bool) TrajectoryEvent {
	e.Chunks = nil
	e.RefinedText = stripCitationMarkersExcept(e.RefinedText, keep)
	if e.Diff != nil {
		e.Diff = redactRefineDiff(e.Diff, keep)
	}
	return e
}

// redactRefineDiff recomputes a refine diff over the marker-free texts. A
// word-level diff can split one marker across chunks ("Text [1, " kept,
// "3]. " removed, "2]. " added), so stripping each chunk on its own would
// leave its numbers behind. Both texts are rebuilt from the chunks — kept +
// removed is the original, kept + added the refined answer; every chunk
// ends in the word separator computeRefineDiff puts back — stripped, and
// diffed again.
func redactRefineDiff(in []DiffChunk, keep map[int]bool) []DiffChunk {
	var original, refined strings.Builder
	for _, d := range in {
		switch d.Kind {
		case "kept":
			original.WriteString(d.Text)
			refined.WriteString(d.Text)
		case "removed":
			original.WriteString(d.Text)
		case "added":
			refined.WriteString(d.Text)
		}
	}
	return computeRefineDiff(stripCitationMarkersExcept(original.String(), keep), stripCitationMarkersExcept(refined.String(), keep))
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

func stripMarkersAll(in []string, keep map[int]bool) []string {
	if in == nil {
		return nil
	}
	out := make([]string, len(in))
	for i, s := range in {
		out[i] = stripCitationMarkersExcept(s, keep)
	}
	return out
}

// RedactMessagesForReader strips source attribution from stored messages
// before they are returned to a reader without seeCitations. The rows are
// modified in place; what is stored is untouched. Only AI messages carry
// attribution — a user's own question is returned as typed. The reader's
// own attachments among the sources stay, with their markers.
func RedactMessagesForReader(msgs []MessageRow) {
	for i := range msgs {
		m := &msgs[i]
		if m.Role != "ai" {
			continue
		}
		var keep map[int]bool
		if len(m.Sources) > 0 && string(m.Sources) != "null" {
			var src []ChatSource
			own := []ChatSource{}
			if json.Unmarshal(m.Sources, &src) == nil {
				own = ownSources(src)
				keep = keptCitationNumbers(own)
			}
			raw, err := json.Marshal(own)
			if err != nil {
				raw = []byte("[]")
			}
			m.Sources = raw
		}
		m.Content = stripCitationMarkersExcept(m.Content, keep)
		if m.Reasoning != nil {
			r := stripCitationMarkersExcept(*m.Reasoning, keep)
			m.Reasoning = &r
		}
		m.Verification = redactVerification(m.Verification, keep)
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
