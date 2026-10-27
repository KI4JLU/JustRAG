package chat

import (
	"encoding/json"
	"strings"

	"github.com/ag-ui-protocol/ag-ui/sdks/community/go/pkg/core/events"

	"github.com/justrag/go-backend/internal/agui"
)

// newAgentChatCitationFilter is the agent chat's wire redaction for a reader
// without seeCitations (citation_visibility.go has the rules). Per run:
//
//   - CUSTOM justrag.sources.v1: an empty source list
//   - CUSTOM justrag.tool_chunks.v1: the tool call id with no chunks
//   - TOOL_CALL_RESULT: only its "error" key is kept, except for the
//     memory_* tools (the user's own memory, never KB content) — a kb_search
//     result is the retrieved chunks, numbered and named, and a tool this
//     filter does not know is treated the same way (fail closed)
//   - TEXT_MESSAGE_CONTENT / REASONING_MESSAGE_CONTENT: citation markers
//     stripped across deltas; a delta that is held back entirely is not
//     sent (AG-UI rejects an empty delta), and the held tail goes out right
//     before the message's END event
//
// What the run stores — the answer text, its sources — is taken from the
// Translator and the retriever, before this filter, and stays complete.
func newAgentChatCitationFilter() agui.EventFilter {
	text := map[string]*CitationMarkerStream{}
	reasoning := map[string]*CitationMarkerStream{}
	stream := func(m map[string]*CitationMarkerStream, id string) *CitationMarkerStream {
		s, ok := m[id]
		if !ok {
			s = &CitationMarkerStream{}
			m[id] = s
		}
		return s
	}
	flush := func(m map[string]*CitationMarkerStream, id string) string {
		s, ok := m[id]
		if !ok {
			return ""
		}
		delete(m, id)
		return s.Flush()
	}
	toolNames := map[string]string{}
	return func(ev events.Event) []events.Event {
		switch e := ev.(type) {
		case *events.ToolCallStartEvent:
			toolNames[e.ToolCallID] = e.ToolCallName
		case *events.TextMessageContentEvent:
			out := stream(text, e.MessageID).Feed(e.Delta)
			if out == "" {
				return nil
			}
			c := *e
			c.Delta = out
			return []events.Event{&c}
		case *events.TextMessageEndEvent:
			if rest := flush(text, e.MessageID); rest != "" {
				return []events.Event{events.NewTextMessageContentEvent(e.MessageID, rest), e}
			}
		case *events.ReasoningMessageContentEvent:
			out := stream(reasoning, e.MessageID).Feed(e.Delta)
			if out == "" {
				return nil
			}
			c := *e
			c.Delta = out
			return []events.Event{&c}
		case *events.ReasoningMessageEndEvent:
			if rest := flush(reasoning, e.MessageID); rest != "" {
				return []events.Event{events.NewReasoningMessageContentEvent(e.MessageID, rest), e}
			}
		case *events.CustomEvent:
			switch e.Name {
			case agui.SourcesEvent:
				return []events.Event{events.NewCustomEvent(e.Name, events.WithValue([]ChatSource{}))}
			case agui.ToolChunksEvent:
				value := map[string]any{"chunks": []any{}}
				if m, ok := e.Value.(map[string]any); ok {
					if id, ok := m["toolCallId"]; ok {
						value["toolCallId"] = id
					}
				}
				return []events.Event{events.NewCustomEvent(e.Name, events.WithValue(value))}
			}
		case *events.ToolCallResultEvent:
			if strings.HasPrefix(toolNames[e.ToolCallID], "memory_") {
				break
			}
			c := *e
			c.Content = toolResultErrorOnly(e.Content)
			return []events.Event{&c}
		}
		return []events.Event{ev}
	}
}

// toolResultErrorOnly reduces a TOOL_CALL_RESULT content (a JSON object:
// {"result": …, "chunks": […]} or {"error": …}) to its "error" key, so a
// failed or budget-capped call still says why; anything else becomes "{}".
func toolResultErrorOnly(content string) string {
	var m map[string]json.RawMessage
	if json.Unmarshal([]byte(content), &m) == nil {
		if e, ok := m["error"]; ok {
			b, err := json.Marshal(map[string]json.RawMessage{"error": e})
			if err == nil {
				return string(b)
			}
		}
	}
	return "{}"
}
