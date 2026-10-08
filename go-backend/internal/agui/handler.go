package agui

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/ag-ui-protocol/ag-ui/sdks/community/go/pkg/core/events"
	"github.com/ag-ui-protocol/ag-ui/sdks/community/go/pkg/core/types"
	"github.com/ag-ui-protocol/ag-ui/sdks/community/go/pkg/encoding/sse"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"google.golang.org/adk/v2/agent"
	"google.golang.org/adk/v2/runner"
	"google.golang.org/adk/v2/session"
	"google.golang.org/genai"

	"github.com/justrag/go-backend/internal/adkbridge"
)

// ScopeFunc refusals: ErrUnauthorized answers 401, ErrForbidden 403.
var (
	ErrUnauthorized = errors.New("agui: unauthenticated")
	ErrForbidden    = errors.New("agui: forbidden")
)

// ScopeFunc resolves the run scope from the authenticated request. It
// returns ErrUnauthorized (401) or ErrForbidden (403) to refuse the request.
type ScopeFunc func(r *http.Request) (adkbridge.Scope, error)

// Config wires one AG-UI endpoint to one ADK agent.
type Config struct {
	AppName  string
	Runner   *runner.Runner
	Sessions session.Service
	Runs     *adkbridge.RunStore
	Scope    ScopeFunc
}

type handler struct{ cfg Config }

// NewHandler returns the AG-UI endpoint (POST, RunAgentInput → SSE).
//
// Status codes before the stream starts: 400 bad body / no input / resume
// without thread / resume naming an interrupt that is not open while one is;
// 401/403 from ScopeFunc; 404 resume on a thread with no open interrupt for
// this user; 409 interrupt_expired, interrupt_mismatch, or a new message on a
// thread with an open interrupt. Otherwise 200 SSE. Error text from the
// model provider or the database never reaches the client.
func NewHandler(cfg Config) http.Handler { return &handler{cfg: cfg} }

func httpError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	sc, err := h.cfg.Scope(r)
	switch {
	case errors.Is(err, ErrUnauthorized):
		httpError(w, http.StatusUnauthorized, "unauthenticated")
		return
	case errors.Is(err, ErrForbidden):
		httpError(w, http.StatusForbidden, "forbidden")
		return
	case err != nil:
		slog.ErrorContext(r.Context(), "agui: resolve scope", "app", h.cfg.AppName, "error", err)
		httpError(w, http.StatusInternalServerError, "internal_error")
		return
	case sc.UserID == "":
		// Fail closed: every run, thread and claim is keyed by the user.
		httpError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var in types.RunAgentInput
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in); err != nil {
		httpError(w, http.StatusBadRequest, "bad_request")
		return
	}
	ctx := adkbridge.WithScope(r.Context(), sc)

	resuming := len(in.Resume) > 0
	var msg *genai.Content
	if resuming {
		var ref *refusal
		if msg, ref = h.resumeInput(ctx, sc.UserID, &in); ref != nil {
			httpError(w, ref.code, ref.msg)
			return
		}
	} else {
		if in.ThreadID != "" {
			open, err := h.cfg.Runs.HasOpen(ctx, h.cfg.AppName, sc.UserID, in.ThreadID)
			if err != nil {
				slog.ErrorContext(ctx, "agui: check open interrupt", "app", h.cfg.AppName, "error", err)
				httpError(w, http.StatusInternalServerError, "internal_error")
				return
			}
			if open {
				httpError(w, http.StatusConflict, "thread_has_open_interrupt")
				return
			}
		}
		if msg, err = Input(ctx, &in, nil); err != nil {
			httpError(w, http.StatusBadRequest, "no_input")
			return
		}
	}
	if in.ThreadID == "" {
		in.ThreadID = uuid.NewString()
	}
	// Canonical form only: uuid.Parse accepts spellings ("urn:uuid:…",
	// braces) that Postgres rejects.
	if u, err := uuid.Parse(in.RunID); err != nil {
		in.RunID = uuid.NewString()
	} else {
		in.RunID = u.String()
	}
	// The new run row is written BEFORE a resume claims the paused run, so
	// no failure after the claim can lose the user's approval.
	if err := h.start(ctx, &in, sc); err != nil {
		slog.ErrorContext(ctx, "agui: start run", "app", h.cfg.AppName, "thread_id", in.ThreadID,
			"resume", resuming, "error", err)
		httpError(w, http.StatusInternalServerError, "internal_error")
		return
	}
	if resuming {
		if ref := h.claim(ctx, sc.UserID, &in); ref != nil {
			if err := h.cfg.Runs.Finish(context.WithoutCancel(ctx), in.RunID, adkbridge.RunFailed, "resume refused"); err != nil {
				slog.ErrorContext(ctx, "agui: finish refused resume", "app", h.cfg.AppName, "run_id", in.RunID, "error", err)
			}
			httpError(w, ref.code, ref.msg)
			return
		}
	}
	h.stream(ctx, w, &in, sc.UserID, msg)
}

// refusal is an HTTP error answered before the stream starts.
type refusal struct {
	code int
	msg  string
}

var errInternal = &refusal{http.StatusInternalServerError, "internal_error"}

// resumeInput turns the resume into the ADK message from the user's own
// session. It runs before any row is written or claimed, so a malformed
// resume cannot consume a real interrupt.
func (h *handler) resumeInput(ctx context.Context, userID string, in *types.RunAgentInput) (*genai.Content, *refusal) {
	if in.ThreadID == "" {
		return nil, &refusal{http.StatusBadRequest, "resume_requires_thread"}
	}
	kind := InterruptKind(func(context.Context, string) (string, error) {
		return "", errors.New("agui: no open interrupts")
	})
	got, err := h.cfg.Sessions.Get(ctx, &session.GetRequest{AppName: h.cfg.AppName, UserID: userID, SessionID: in.ThreadID})
	switch {
	case err == nil:
		kind = OpenInterrupts(got.Session)
	case errors.Is(err, session.ErrNotFound):
		// Another user's thread is indistinguishable from a missing one.
	default:
		slog.ErrorContext(ctx, "agui: load session", "app", h.cfg.AppName, "error", err)
		return nil, errInternal
	}
	msg, err := Input(ctx, in, kind)
	if err != nil {
		// The resume does not match the session. Whether that is a 404 or a
		// 400 depends on whether this user has anything to resume at all.
		open, herr := h.cfg.Runs.HasOpen(ctx, h.cfg.AppName, userID, in.ThreadID)
		if herr != nil {
			slog.ErrorContext(ctx, "agui: check open interrupt", "app", h.cfg.AppName, "error", herr)
			return nil, errInternal
		}
		if open {
			return nil, &refusal{http.StatusBadRequest, "bad_resume"}
		}
		return nil, &refusal{http.StatusNotFound, "no_open_interrupt"}
	}
	return msg, nil
}

// claim takes the thread's paused run for userID, exactly once.
func (h *handler) claim(ctx context.Context, userID string, in *types.RunAgentInput) *refusal {
	ids := make([]string, 0, len(in.Resume))
	for _, e := range in.Resume {
		ids = append(ids, e.InterruptID)
	}
	_, err := h.cfg.Runs.ClaimResume(ctx, h.cfg.AppName, userID, in.ThreadID, ids)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, adkbridge.ErrNoOpenInterrupt):
		return &refusal{http.StatusNotFound, "no_open_interrupt"}
	case errors.Is(err, adkbridge.ErrInterruptExpired):
		return &refusal{http.StatusConflict, "interrupt_expired"}
	case errors.Is(err, adkbridge.ErrInterruptMismatch):
		return &refusal{http.StatusConflict, "interrupt_mismatch"}
	default:
		slog.ErrorContext(ctx, "agui: claim resume", "app", h.cfg.AppName, "error", err)
		return errInternal
	}
}

// start records the new run. A client-chosen run id that already exists
// (any user's) is replaced by a fresh one; RUN_STARTED reports the id used.
func (h *handler) start(ctx context.Context, in *types.RunAgentInput, sc adkbridge.Scope) error {
	run := adkbridge.Run{ID: in.RunID, ThreadID: in.ThreadID, AppName: h.cfg.AppName, UserID: sc.UserID, KBID: sc.KBID}
	err := h.cfg.Runs.Start(ctx, run)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "agent_runs_pkey" {
		run.ID = uuid.NewString()
		if err = h.cfg.Runs.Start(ctx, run); err == nil {
			in.RunID = run.ID
		}
	}
	return err
}

// stream runs the agent and writes AG-UI events. The run row reaches exactly
// one end state — completed, interrupted, failed or cancelled — on every
// path, through a context that survives a client disconnect.
func (h *handler) stream(ctx context.Context, w http.ResponseWriter, in *types.RunAgentInput, userID string, msg *genai.Content) {
	bg := context.WithoutCancel(ctx)
	log := slog.With("app", h.cfg.AppName, "run_id", in.RunID, "thread_id", in.ThreadID)
	settled := false
	finish := func(st adkbridge.RunStatus, detail string) {
		settled = true
		if err := h.cfg.Runs.Finish(bg, in.RunID, st, detail); err != nil {
			log.ErrorContext(bg, "agui: finish run", "status", st, "error", err)
		}
	}
	defer func() {
		// A panic (re-raised to net/http after this) must not leave the row running.
		if !settled {
			finish(adkbridge.RunFailed, "handler aborted")
		}
	}()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	enc := sse.NewSSEWriter()
	emit := func(ev events.Event) error { return enc.WriteEvent(ctx, w, ev) }

	tr, err := NewTranslator(in.ThreadID, in.RunID, emit)
	if err != nil {
		finish(adkbridge.RunCancelled, "")
		return
	}
	for ev, err := range h.cfg.Runner.Run(ctx, userID, in.ThreadID, msg, agent.RunConfig{StreamingMode: agent.StreamingModeSSE}) {
		if ctx.Err() != nil {
			finish(adkbridge.RunCancelled, "")
			return
		}
		if err != nil {
			// Provider / storage detail stays in the log and the run row.
			log.ErrorContext(ctx, "agui: run failed", "error", err)
			_ = tr.Fail(errors.New("run failed"))
			finish(adkbridge.RunFailed, err.Error())
			return
		}
		if err := tr.Event(ev); err != nil {
			// Writing to the client failed: it is gone.
			finish(adkbridge.RunCancelled, "")
			return
		}
	}
	if ctx.Err() != nil {
		finish(adkbridge.RunCancelled, "")
		return
	}
	if pending := tr.Interrupts(); len(pending) > 0 {
		open := make([]adkbridge.OpenInterrupt, 0, len(pending))
		for _, i := range pending {
			open = append(open, adkbridge.OpenInterrupt{ID: i.ID, Reason: i.Reason, ToolCallID: i.ToolCallID})
		}
		// Taken before the row is written, so the advertised expiry is never
		// later than the stored one.
		expires := time.Now().Add(h.cfg.Runs.TTL())
		if err := h.cfg.Runs.Interrupt(bg, in.RunID, open); err != nil {
			// Typically ErrThreadHasOpenInterrupt (a concurrent run paused the
			// thread first). Announcing an interrupt nobody can resume would
			// strand the client, so the run fails instead.
			log.ErrorContext(bg, "agui: record interrupt", "error", err)
			_ = tr.Fail(errors.New("run failed"))
			finish(adkbridge.RunFailed, "record interrupt: "+err.Error())
			return
		}
		settled = true
		tr.SetInterruptExpiry(expires)
	} else {
		finish(adkbridge.RunCompleted, "")
	}
	_ = tr.Finish()
}
