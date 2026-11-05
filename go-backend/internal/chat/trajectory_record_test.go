package chat

import (
	"context"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
)

// The recorder keeps agentTrajectory frames in wire order, marks the first
// reasoning frame once, and ignores every other frame. Oracle: the list of
// events written, with the marker at the position of the first reasoning
// frame.
func TestTrajectoryRecorder_ObserveOrder(t *testing.T) {
	r := &trajectoryRecorder{}
	plan := TrajectoryEvent{Stage: "plan", Queries: []string{"a", "b"}}
	hop := TrajectoryEvent{Stage: "hop", Step: 1, Findings: 2}
	answer := TrajectoryEvent{Stage: "answer"}

	r.observe(map[string]any{"agentTrajectory": plan})
	r.observe(map[string]any{"agenticHop": map[string]any{"step": 1}}) // legacy shape: ignored
	r.observe(map[string]any{"agentTrajectory": &hop})                 // pointer form
	r.observe(map[string]any{"sources": []ChatSource{}})               // not a step
	r.observe(map[string]any{"agentTrajectory": answer})
	r.observe(map[string]string{"reasoning": "Ich prüfe"})
	r.observe(map[string]string{"reasoning": " die Frist."}) // second chunk: no second marker
	r.observe(map[string]string{"content": "Antwort"})
	r.observe(map[string]any{"agentTrajectory": (*TrajectoryEvent)(nil)})

	want := []TrajectoryEvent{plan, hop, answer, {Stage: trajectoryStageReasoning}}
	if got := r.stored(); !reflect.DeepEqual(got, want) {
		t.Fatalf("stored:\n got %+v\nwant %+v", got, want)
	}
	if r.count() != 4 {
		t.Errorf("count = %d, want 4", r.count())
	}
}

// Only the reasoning marker, or nothing: nothing worth storing.
func TestTrajectoryRecorder_StoredNilWithoutSteps(t *testing.T) {
	r := &trajectoryRecorder{}
	if r.stored() != nil {
		t.Error("empty recorder must store nil")
	}
	r.observe(map[string]string{"reasoning": "x"})
	if r.stored() != nil {
		t.Error("a lone reasoning marker must store nil")
	}
	var nilRec *trajectoryRecorder
	nilRec.observe(map[string]any{"agentTrajectory": TrajectoryEvent{Stage: "plan"}})
	if nilRec.stored() != nil || nilRec.count() != 0 {
		t.Error("nil recorder must be a no-op")
	}
}

// The refined answer text is not stored twice (content holds it); the diff
// stays. The recorder's own events are not mutated by stored().
func TestTrajectoryRecorder_StoredDropsRefinedText(t *testing.T) {
	r := &trajectoryRecorder{}
	refine := TrajectoryEvent{Stage: "refine_complete", RefinedText: "full answer", Diff: []DiffChunk{{Kind: "added", Text: "neu "}}}
	r.observe(map[string]any{"agentTrajectory": refine})
	got := r.stored()
	if got[0].RefinedText != "" || len(got[0].Diff) != 1 {
		t.Fatalf("stored refine = %+v, want no refined_text and the diff kept", got[0])
	}
	if r.events[0].RefinedText != "full answer" {
		t.Error("stored() must not mutate the recorded event")
	}
}

func TestTrajectoryRecorder_StoredCapped(t *testing.T) {
	r := &trajectoryRecorder{}
	for i := range maxStoredTrajectoryEvents + 5 {
		r.observe(map[string]any{"agentTrajectory": TrajectoryEvent{Stage: "hop", Step: i + 1}})
	}
	got := r.stored()
	if len(got) != maxStoredTrajectoryEvents || got[0].Step != 1 {
		t.Fatalf("stored %d events (first step %d), want the first %d", len(got), got[0].Step, maxStoredTrajectoryEvents)
	}
}

func TestTrajectoryRecorder_Concurrent(t *testing.T) {
	r := &trajectoryRecorder{}
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			for range 50 {
				r.observe(map[string]any{"agentTrajectory": TrajectoryEvent{Stage: "hop"}})
				r.observe(map[string]string{"reasoning": "x"})
			}
		})
	}
	wg.Wait()
	if r.count() != 8*50+1 {
		t.Fatalf("count = %d, want %d (every hop plus one marker)", r.count(), 8*50+1)
	}
}

// writeSSE feeds the turn's recorder with the frame as written by the
// orchestrator — before the CitationFilter redacts it for a reader without
// seeCitations — while the wire still carries the redacted frame.
func TestWriteSSE_RecordsBeforeCitationFilter(t *testing.T) {
	ctx := withCitationFilter(withTrajectoryRecorder(context.Background()), NewCitationFilter())
	w := httptest.NewRecorder()
	evt := TrajectoryEvent{Stage: "hop", Step: 1, Chunks: []TrajChunkRef{{Idx: 1, FileName: "geheim.pdf"}}}
	writeSSE(ctx, w, map[string]any{"agentTrajectory": evt})

	got := trajectoryRecorderFrom(ctx).stored()
	if len(got) != 1 || len(got[0].Chunks) != 1 || got[0].Chunks[0].FileName != "geheim.pdf" {
		t.Fatalf("recorded %+v, want the unredacted event", got)
	}
	if strings.Contains(w.Body.String(), "geheim.pdf") {
		t.Errorf("the wire frame must stay redacted: %s", w.Body.String())
	}
}

// A reader without seeCitations gets the stored steps without the chunk
// previews (file names), tool-call arguments and the search text taken from
// them, and with markers stripped from the refine diff; the question a
// retrieval step names is the reader's own and stays.
func TestRedactMessagesForReader_Trajectory(t *testing.T) {
	msgs := []MessageRow{{
		Role:    "ai",
		Content: "x [1]",
		Trajectory: []TrajectoryEvent{
			{Stage: "hop", Chunks: []TrajChunkRef{{Idx: 1, FileName: "po.pdf"}}},
			{Stage: "refine_complete", Diff: []DiffChunk{{Kind: "kept", Text: "Satz "}, {Kind: "added", Text: "[1]. "}}},
			{Stage: "decision", Decision: "agent_tool_call", Reason: "chunk_read", Args: `{"file_id":"geheim"}`, Query: "geheim.pdf"},
			{Stage: retrievalStage, Step: 1, Query: "Wie hoch ist die Gebühr?"},
		},
	}}
	RedactMessagesForReader(msgs)
	tr := msgs[0].Trajectory
	if tr[0].Chunks != nil {
		t.Errorf("chunk previews must be removed: %+v", tr[0].Chunks)
	}
	if tr[2].Args != "" || tr[2].Query != "" || tr[2].Reason != "chunk_read" {
		t.Errorf("tool-call arguments and query must be removed, the tool kept: %+v", tr[2])
	}
	if tr[3].Query != "Wie hoch ist die Gebühr?" {
		t.Errorf("the retrieval step's question must stay: %+v", tr[3])
	}
	for _, d := range tr[1].Diff {
		if strings.Contains(d.Text, "[1]") {
			t.Errorf("refine diff still carries a marker: %+v", tr[1].Diff)
		}
	}
}

// Steps written after AddMessage (the refine of the post-response tasks)
// are stored by one late write; without new steps nothing is written.
func TestPersistLateTrajectory(t *testing.T) {
	store := newMockStore()
	store.messages = []MessageRow{{ID: "ai-1", Role: "ai"}}
	h := &Handler{store: store}
	ctx := withTrajectoryRecorder(context.Background())
	rec := trajectoryRecorderFrom(ctx)
	rec.observe(map[string]any{"agentTrajectory": TrajectoryEvent{Stage: "answer"}})
	saved := rec.count()

	h.persistLateTrajectory(ctx, "ai-1", saved)
	if store.messages[0].Trajectory != nil {
		t.Fatalf("no new steps: nothing may be written, got %+v", store.messages[0].Trajectory)
	}

	rec.observe(map[string]any{"agentTrajectory": TrajectoryEvent{Stage: "refine_complete", RefinedText: "neu"}})
	h.persistLateTrajectory(ctx, "ai-1", saved)
	got := store.messages[0].Trajectory
	if len(got) != 2 || got[1].Stage != "refine_complete" || got[1].RefinedText != "" {
		t.Fatalf("late write = %+v, want answer + refine_complete without refined_text", got)
	}
}
