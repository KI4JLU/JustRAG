package chat

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ag-ui-protocol/ag-ui/sdks/community/go/pkg/core/events"

	"github.com/justrag/go-backend/internal/agui"
)

// The agent chat's wire filter, fed the events a run with a kb_search call
// and a cited answer produces. Oracle: the JSON of what reaches the client,
// searched for the file name, file id and chunk text, and the answer text
// joined from the content deltas against the hand-written stripped answer.
func TestAgentChatCitationFilter(t *testing.T) {
	filter := newAgentChatCitationFilter()
	in := []events.Event{
		events.NewToolCallStartEvent("call-1", "kb_search"),
		events.NewToolCallResultEvent("r1", "call-1", `{"result":"[1] geheim.pdf: Quelltext","chunks":[{"file_id":"file-1"}]}`),
		events.NewToolCallStartEvent("call-2", "kb_search"),
		events.NewToolCallResultEvent("r2", "call-2", `{"error":"Werkzeug-Budget erschöpft"}`),
		events.NewToolCallStartEvent("call-3", "memory_read"),
		events.NewToolCallResultEvent("r3", "call-3", `{"result":"Nutzer mag kurze Antworten"}`),
		events.NewCustomEvent(agui.ToolChunksEvent, events.WithValue(map[string]any{"toolCallId": "call-1", "chunks": []any{map[string]any{"fileName": "geheim.pdf"}}})),
		events.NewTextMessageStartEvent("m1"),
	}
	for _, d := range citingAnswerDeltas {
		in = append(in, events.NewTextMessageContentEvent("m1", d))
	}
	in = append(in,
		events.NewTextMessageEndEvent("m1"),
		events.NewCustomEvent(agui.SourcesEvent, events.WithValue([]ChatSource{{Index: 1, FileName: "geheim.pdf", FileID: "file-1", Content: "Quelltext"}})),
		events.NewCustomEvent(MessageEvent, events.WithValue(map[string]any{"aiMessageId": "a1"})),
	)
	var out []events.Event
	for _, ev := range in {
		out = append(out, filter(ev)...)
	}
	wire, _ := json.Marshal(out)
	for _, leak := range []string{"geheim", "file-1", "Quelltext"} {
		if strings.Contains(string(wire), leak) {
			t.Errorf("client receives %q: %s", leak, wire)
		}
	}
	var text strings.Builder
	endIdx, lastContent := -1, -1
	for i, ev := range out {
		switch e := ev.(type) {
		case *events.TextMessageContentEvent:
			if e.Delta == "" {
				t.Errorf("empty delta sent (AG-UI rejects it)")
			}
			text.WriteString(e.Delta)
			lastContent = i
		case *events.TextMessageEndEvent:
			endIdx = i
		}
	}
	if text.String() != citingAnswerStripped {
		t.Errorf("answer = %q, want %q", text.String(), citingAnswerStripped)
	}
	if lastContent > endIdx {
		t.Errorf("content after TEXT_MESSAGE_END")
	}
	for _, keep := range []string{`"aiMessageId":"a1"`, `"toolCallId":"call-1"`, agui.SourcesEvent, "Werkzeug-Budget erschöpft", "Nutzer mag kurze Antworten"} {
		if !strings.Contains(string(wire), keep) {
			t.Errorf("filter lost %s: %s", keep, wire)
		}
	}
}
