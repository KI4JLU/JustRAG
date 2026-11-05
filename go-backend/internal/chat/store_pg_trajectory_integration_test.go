//go:build integration

// Integration test for messages.trajectory (migration 0102): the steps a turn
// streamed are stored with the AI message, rewritten once after the
// post-response tasks, read back by both message reads and copied by a branch.
// Skipped when DB_* env is unset; reuses conflictTestPool / seedChat.

package chat

import (
	"context"
	"reflect"
	"testing"
)

func TestPGStore_TrajectoryRoundTrip(t *testing.T) {
	pool := conflictTestPool(t)
	store := NewStore(pool)
	ctx := context.Background()
	chatID := seedChat(t, pool, "trajectory")

	rule := 0
	steps := []TrajectoryEvent{
		{Stage: "orchestrator_policy", Decision: "plan_execute", PolicyRule: &rule},
		{Stage: "plan", Queries: []string{"Frist", "Antrag"}},
		{Stage: "iterate", Step: 1, Findings: 3, Chunks: []TrajChunkRef{{Idx: 1, FileName: "po.pdf", Score: 0.8}}},
		{Stage: trajectoryStageReasoning},
		{Stage: "answer", Decision: "plan_execute_complete"},
	}

	// Oracle: the list AddMessage was given comes back unchanged — order,
	// the pointer field (rule 0 must survive omitempty) and the chunk refs.
	msg, err := store.AddMessage(ctx, AddMessageParams{ChatID: chatID, Role: "ai", Content: "answer", Trajectory: steps})
	if err != nil {
		t.Fatalf("AddMessage: %v", err)
	}
	if !reflect.DeepEqual(msg.Trajectory, steps) {
		t.Fatalf("AddMessage RETURNING trajectory:\n got %+v\nwant %+v", msg.Trajectory, steps)
	}
	rows, err := store.GetChatMessages(ctx, chatID)
	if err != nil {
		t.Fatalf("GetChatMessages: %v", err)
	}
	if len(rows) != 1 || !reflect.DeepEqual(rows[0].Trajectory, steps) {
		t.Fatalf("GetChatMessages trajectory:\n got %+v\nwant %+v", rows, steps)
	}

	// The late write replaces the list (refine steps appended).
	late := append(append([]TrajectoryEvent{}, steps...), TrajectoryEvent{Stage: "refine_complete", Mode: "surgical", ClaimsBefore: 2, ClaimsAfter: 0})
	if err := store.UpdateMessageTrajectory(ctx, msg.ID, late); err != nil {
		t.Fatalf("UpdateMessageTrajectory: %v", err)
	}
	anc, err := store.GetMessageAncestors(ctx, msg.ID, chatID)
	if err != nil {
		t.Fatalf("GetMessageAncestors: %v", err)
	}
	if len(anc) != 1 || !reflect.DeepEqual(anc[0].Trajectory, late) {
		t.Fatalf("GetMessageAncestors trajectory after update:\n got %+v\nwant %+v", anc, late)
	}

	// A branch copies the steps with the message.
	var ownerID string
	if err := pool.QueryRow(ctx, `SELECT user_id::text FROM chats WHERE id = $1::uuid`, chatID).Scan(&ownerID); err != nil {
		t.Fatalf("read chat owner: %v", err)
	}
	br, err := store.BranchChat(ctx, chatID, msg.ID, ownerID)
	if err != nil {
		t.Fatalf("BranchChat: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM chats WHERE id = $1::uuid`, br.ID) }) //nolint:errcheck
	copied, err := store.GetChatMessages(ctx, br.ID)
	if err != nil {
		t.Fatalf("GetChatMessages(branch): %v", err)
	}
	if len(copied) != 1 || !reflect.DeepEqual(copied[0].Trajectory, late) {
		t.Fatalf("branch trajectory:\n got %+v\nwant %+v", copied, late)
	}

	// An empty list stores SQL NULL, read back as no steps.
	if err := store.UpdateMessageTrajectory(ctx, msg.ID, nil); err != nil {
		t.Fatalf("UpdateMessageTrajectory(nil): %v", err)
	}
	var isNull bool
	if err := pool.QueryRow(ctx, `SELECT trajectory IS NULL FROM messages WHERE id = $1::uuid`, msg.ID).Scan(&isNull); err != nil {
		t.Fatalf("read trajectory: %v", err)
	}
	if !isNull {
		t.Error("an empty step list must store SQL NULL")
	}
}
