package confluence

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/hibiken/asynq"

	"github.com/justrag/go-backend/internal/jobs"
	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/syncwindow"
)

// ErrNoConnection: the user has no Confluence connection (they must create
// one in the UI first; an agent cannot handle credentials).
var ErrNoConnection = errors.New("confluence: user has no connection")

// Enqueuer is the subset of *asynq.Client the Confluence endpoints use.
type Enqueuer interface {
	Enqueue(task *asynq.Task, opts ...asynq.Option) (*asynq.TaskInfo, error)
}

// Importer creates Confluence sources and enqueues their first sync. It is
// the logic behind POST /api/kb/{id}/confluence-sources, callable without
// HTTP (the agent chat uses Import).
type Importer struct {
	store ConfluenceStore
	enq   Enqueuer // nil = no queue wired; the first sync is not enqueued
}

// NewImporter returns an Importer. A nil enq — including a nil *asynq.Client
// boxed into the interface — disables enqueueing, as in Handler.
func NewImporter(store ConfluenceStore, enq Enqueuer) *Importer {
	return &Importer{store: store, enq: nonNilEnqueuer(enq)}
}

// nonNilEnqueuer guards the nil-interface trap: a nil *asynq.Client boxed
// into Enqueuer is a non-nil interface value that would panic on Enqueue.
func nonNilEnqueuer(enq Enqueuer) Enqueuer {
	if c, ok := enq.(*asynq.Client); ok && c == nil {
		return nil
	}
	return enq
}

// Import creates a manual-schedule source for spaceKey in kbID using the
// caller's own connection and enqueues its first sync. Returns the source id.
// Like the HTTP endpoint, a failed enqueue is logged but not returned: the
// source exists and can be synced from the UI.
func (im *Importer) Import(ctx context.Context, userID, kbID, spaceKey string, rootPageID *string) (string, error) {
	if spaceKey == "" {
		return "", errors.New("confluence: spaceKey is required")
	}
	conn, err := im.store.GetConfluenceConnectionByUserID(ctx, userID)
	if err != nil {
		return "", fmt.Errorf("confluence: look up connection: %w", err)
	}
	if conn == nil {
		return "", ErrNoConnection
	}
	source, err := im.createSource(ctx, kbID, conn.ID, spaceKey, rootPageID, nil, false, syncwindow.ScheduleManual)
	if err != nil {
		return "", err
	}
	return source.ID, nil
}

// createSource persists a source and enqueues its initial sync job so the
// worker fetches pages immediately. Callers have already authorised the
// connection and validated the schedule.
func (im *Importer) createSource(ctx context.Context, kbID, connectionID, spaceKey string,
	rootPageID, rootPageTitle *string, includeAttachments bool, syncSchedule string,
) (*ConfluenceSourceRow, error) {
	source, err := im.store.CreateConfluenceSource(ctx, kbID, connectionID, spaceKey,
		rootPageID, rootPageTitle, includeAttachments, syncSchedule)
	if err != nil {
		return nil, fmt.Errorf("confluence: create source: %w", err)
	}

	if im.enq != nil {
		payload, marshalErr := json.Marshal(map[string]string{"sourceId": source.ID})
		if marshalErr == nil {
			if _, enqErr := im.enq.Enqueue(
				asynq.NewTask(jobs.TypeConfluenceSync, payload),
				asynq.Queue(jobs.QueueHeavy),
				asynq.MaxRetry(3),
				asynq.Timeout(jobs.TimeoutFor(jobs.TypeConfluenceSync)),
			); enqErr != nil {
				logctx.From(ctx).Error("failed to enqueue initial confluence sync", "sourceId", source.ID, "error", enqErr)
			}
		}
	}
	return source, nil
}
