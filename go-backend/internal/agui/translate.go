// Package agui speaks the AG-UI protocol (https://docs.ag-ui.com) on top of
// ADK runs: it turns an AG-UI RunAgentInput into an ADK message and the ADK
// event stream into AG-UI events. The community Go SDK provides the event
// types and SSE encoding; it is wrapped here so it stays replaceable.
package agui

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/ag-ui-protocol/ag-ui/sdks/community/go/pkg/core/events"
	"github.com/ag-ui-protocol/ag-ui/sdks/community/go/pkg/core/types"
	"github.com/google/uuid"
	"google.golang.org/adk/v2/session"
	"google.golang.org/adk/v2/tool/toolconfirmation"
	"google.golang.org/adk/v2/workflow"
	"google.golang.org/genai"
)

// Emit sends one AG-UI event to the client.
type Emit func(events.Event) error

// Translator converts one ADK run's events into AG-UI events. Not safe for
// concurrent use; one per run.
type Translator struct {
	threadID, runID string
	emit            Emit

	textID      string // open TEXT_MESSAGE, "" if none
	reasoningID string // open REASONING message, "" if none
	streamed    bool   // partial text was streamed for the current message
	step        string // current workflow node
	interrupts  []types.Interrupt
	// lastOutput is the latest workflow node output; like ADK's console, only
	// the run's final output is shown, and only when the run did not pause.
	lastOutput string
}

// NewTranslator starts a run: it emits RUN_STARTED.
func NewTranslator(threadID, runID string, emit Emit) (*Translator, error) {
	t := &Translator{threadID: threadID, runID: runID, emit: emit}
	return t, emit(events.NewRunStartedEvent(threadID, runID))
}

// Event translates one ADK event.
func (t *Translator) Event(ev *session.Event) error {
	if ev == nil {
		return nil
	}
	if err := t.stepFor(ev); err != nil {
		return err
	}
	if ev.RequestedInput != nil {
		t.interrupts = append(t.interrupts, inputInterrupt(ev.RequestedInput))
	}
	if ev.Output != nil {
		// Node output is data; an emitting node mirrors a string output into a
		// role-less Content, which must not reach the user as chat text.
		if s, ok := ev.Output.(string); ok && s != "" {
			t.lastOutput = s
		}
		return nil
	}
	if ev.Content == nil {
		return nil
	}
	for _, p := range ev.Content.Parts {
		if p == nil {
			continue
		}
		var err error
		switch {
		case p.Thought && p.Text != "":
			if ev.Partial {
				err = t.reasoning(p.Text)
			}
		case p.Text != "":
			err = t.text(p.Text, ev.Partial)
		case p.FunctionCall != nil && !ev.Partial:
			err = t.call(p.FunctionCall)
		case p.FunctionResponse != nil && !ev.Partial:
			err = t.result(p.FunctionResponse)
		}
		if err != nil {
			return err
		}
	}
	if !ev.Partial {
		// A complete model event closes whatever was streaming.
		return t.closeAll()
	}
	return nil
}

// Finish ends the run: success, or interrupt when the run paused.
func (t *Translator) Finish() error {
	if err := t.closeAll(); err != nil {
		return err
	}
	if err := t.endStep(); err != nil {
		return err
	}
	opt := events.WithSuccessOutcome()
	if len(t.interrupts) > 0 {
		opt = events.WithInterruptOutcome(t.interrupts)
	} else if t.lastOutput != "" {
		if err := t.wholeText(t.lastOutput); err != nil {
			return err
		}
	}
	return t.emit(events.NewRunFinishedEventWithOptions(t.threadID, t.runID, opt))
}

// Fail ends the run with RUN_ERROR.
func (t *Translator) Fail(err error) error {
	_ = t.closeAll()
	return t.emit(events.NewRunErrorEvent(err.Error()))
}

func (t *Translator) stepFor(ev *session.Event) error {
	if ev.NodeInfo == nil || ev.NodeInfo.Path == "" || ev.NodeInfo.Path == t.step {
		return nil
	}
	if err := t.endStep(); err != nil {
		return err
	}
	t.step = ev.NodeInfo.Path
	return t.emit(events.NewStepStartedEvent(t.step))
}

func (t *Translator) endStep() error {
	if t.step == "" {
		return nil
	}
	s := t.step
	t.step = ""
	return t.emit(events.NewStepFinishedEvent(s))
}

func (t *Translator) reasoning(delta string) error {
	if t.reasoningID == "" {
		t.reasoningID = uuid.NewString()
		if err := t.emit(events.NewReasoningStartEvent(t.reasoningID)); err != nil {
			return err
		}
		if err := t.emit(events.NewReasoningMessageStartEvent(t.reasoningID, "reasoning")); err != nil {
			return err
		}
	}
	return t.emit(events.NewReasoningMessageContentEvent(t.reasoningID, delta))
}

func (t *Translator) closeReasoning() error {
	if t.reasoningID == "" {
		return nil
	}
	id := t.reasoningID
	t.reasoningID = ""
	if err := t.emit(events.NewReasoningMessageEndEvent(id)); err != nil {
		return err
	}
	return t.emit(events.NewReasoningEndEvent(id))
}

// text handles a text part. Partials stream; the final aggregated event
// repeats the whole text, which is only emitted if nothing was streamed.
func (t *Translator) text(s string, partial bool) error {
	if !partial && t.streamed {
		return nil
	}
	if err := t.closeReasoning(); err != nil {
		return err
	}
	if t.textID == "" {
		t.textID = uuid.NewString()
		if err := t.emit(events.NewTextMessageStartEvent(t.textID, events.WithRole("assistant"))); err != nil {
			return err
		}
	}
	if partial {
		t.streamed = true
	}
	return t.emit(events.NewTextMessageContentEvent(t.textID, s))
}

func (t *Translator) wholeText(s string) error {
	if err := t.text(s, false); err != nil {
		return err
	}
	return t.closeText()
}

func (t *Translator) closeText() error {
	t.streamed = false
	if t.textID == "" {
		return nil
	}
	id := t.textID
	t.textID = ""
	return t.emit(events.NewTextMessageEndEvent(id))
}

func (t *Translator) closeAll() error {
	if err := t.closeReasoning(); err != nil {
		return err
	}
	return t.closeText()
}

func (t *Translator) call(fc *genai.FunctionCall) error {
	if err := t.closeAll(); err != nil {
		return err
	}
	switch fc.Name {
	case toolconfirmation.FunctionCallName:
		// ADK asks for approval before running a tool: an AG-UI interrupt.
		in := types.Interrupt{ID: fc.ID, Reason: "tool_approval", Metadata: types.Metadata{"request": fc.Args}}
		if orig, ok := fc.Args["originalFunctionCall"].(map[string]any); ok {
			if id, ok := orig["id"].(string); ok {
				in.ToolCallID = id
			}
			if name, ok := orig["name"].(string); ok {
				in.Message = fmt.Sprintf("Approve calling %s?", name)
			}
		}
		t.interrupts = append(t.interrupts, in)
		return nil
	case workflow.WorkflowInputFunctionCallName:
		return nil // surfaced via RequestedInput on the same event
	}
	args, err := json.Marshal(fc.Args)
	if err != nil {
		return err
	}
	if err := t.emit(events.NewToolCallStartEvent(fc.ID, fc.Name)); err != nil {
		return err
	}
	if err := t.emit(events.NewToolCallArgsEvent(fc.ID, string(args))); err != nil {
		return err
	}
	return t.emit(events.NewToolCallEndEvent(fc.ID))
}

func (t *Translator) result(fr *genai.FunctionResponse) error {
	if fr.Name == toolconfirmation.FunctionCallName || fr.Name == workflow.WorkflowInputFunctionCallName {
		return nil
	}
	body, err := json.Marshal(fr.Response)
	if err != nil {
		return err
	}
	return t.emit(events.NewToolCallResultEvent(uuid.NewString(), fr.ID, string(body)))
}

func inputInterrupt(r *session.RequestInput) types.Interrupt {
	in := types.Interrupt{ID: r.InterruptID, Reason: "input_required", Message: r.Message}
	if p, ok := r.Payload.(map[string]any); ok {
		if reason, ok := p["reason"].(string); ok && reason != "" {
			in.Reason = reason
		}
		in.Metadata = types.Metadata(p)
	}
	return in
}

// ErrNoInput is returned when a RunAgentInput carries neither a resume nor a
// new user message.
var ErrNoInput = errors.New("agui: run input has no user message and no resume")

// InterruptKind tells Input how to answer an interrupt id.
type InterruptKind func(ctx context.Context, interruptID string) (functionName string, err error)

// Input converts an AG-UI RunAgentInput into the ADK message for the run.
//
// Client-sent history is NOT trusted: only the newest user message is taken;
// earlier turns come from our own store. A client could otherwise forge
// assistant or tool messages into the model's context.
func Input(ctx context.Context, in *types.RunAgentInput, kind InterruptKind) (*genai.Content, error) {
	if len(in.Resume) > 0 {
		parts := make([]*genai.Part, 0, len(in.Resume))
		for _, r := range in.Resume {
			name, err := kind(ctx, r.InterruptID)
			if err != nil {
				return nil, err
			}
			resolved := r.Status == types.ResumeStatusResolved
			var resp map[string]any
			switch name {
			case toolconfirmation.FunctionCallName:
				approved := resolved
				if p, ok := r.Payload.(map[string]any); ok {
					if a, ok := p["approved"].(bool); ok {
						approved = approved && a
					}
				}
				resp = map[string]any{"confirmed": approved}
			case workflow.WorkflowInputFunctionCallName:
				if !resolved {
					return nil, fmt.Errorf("agui: cancelling input interrupt %q not supported yet", r.InterruptID)
				}
				resp = map[string]any{"payload": r.Payload}
			default:
				return nil, fmt.Errorf("agui: interrupt %q is not open", r.InterruptID)
			}
			parts = append(parts, &genai.Part{FunctionResponse: &genai.FunctionResponse{ID: r.InterruptID, Name: name, Response: resp}})
		}
		return &genai.Content{Role: genai.RoleUser, Parts: parts}, nil
	}
	for i := len(in.Messages) - 1; i >= 0; i-- {
		m := in.Messages[i]
		if m.Role != types.RoleUser {
			continue
		}
		if s := messageText(m.Content); strings.TrimSpace(s) != "" {
			return genai.NewContentFromText(s, genai.RoleUser), nil
		}
	}
	return nil, ErrNoInput
}

func messageText(c any) string {
	switch v := c.(type) {
	case string:
		return v
	case []any:
		var b strings.Builder
		for _, p := range v {
			if m, ok := p.(map[string]any); ok && m["type"] == "text" {
				if s, ok := m["text"].(string); ok {
					b.WriteString(s)
				}
			}
		}
		return b.String()
	}
	return ""
}

// OpenInterrupts returns a lookup over a session's events: an interrupt is
// open if its request call has no answering response yet.
func OpenInterrupts(sess session.Session) InterruptKind {
	calls := map[string]string{}
	for ev := range sess.Events().All() {
		if ev.Content == nil {
			continue
		}
		for _, p := range ev.Content.Parts {
			switch {
			case p.FunctionCall != nil && (p.FunctionCall.Name == toolconfirmation.FunctionCallName || p.FunctionCall.Name == workflow.WorkflowInputFunctionCallName):
				calls[p.FunctionCall.ID] = p.FunctionCall.Name
			case p.FunctionResponse != nil:
				delete(calls, p.FunctionResponse.ID)
			}
		}
	}
	return func(_ context.Context, id string) (string, error) {
		if n, ok := calls[id]; ok {
			return n, nil
		}
		return "", fmt.Errorf("agui: interrupt %q is not open", id)
	}
}
