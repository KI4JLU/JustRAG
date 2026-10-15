package owuicompat

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/chat"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/observability"
	"github.com/justrag/go-backend/internal/openaicompat"
	"github.com/justrag/go-backend/internal/usage"
)

const (
	maxChatBodyBytes = 4 << 20
	answerLang       = "de"
	guardSurface     = "owui_compat"
	msgStreamFailed  = "Die Antwort konnte nicht vollständig erzeugt werden. Bitte erneut versuchen."
)

type fileRef struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type chatRequest struct {
	Messages        []openaicompat.ChatMessage `json:"messages"`
	Stream          bool                       `json:"stream"`
	Temperature     *float64                   `json:"temperature"`
	ReasoningEffort string                     `json:"reasoning_effort"`
	Think           *bool                      `json:"think"`
	Options         struct {
		Think *bool `json:"think"`
	} `json:"options"`
	Files []fileRef `json:"files"`
}

// reasoningEffort maps the plugin's reasoning knobs onto ai's effort string
// ("" = no reasoning). An explicit think:false wins over everything.
func reasoningEffort(req chatRequest) string {
	think := req.Think
	if think == nil {
		think = req.Options.Think
	}
	if think != nil && !*think {
		return ""
	}
	switch req.ReasoningEffort {
	case "low", "medium", "high":
		return req.ReasoningEffort
	}
	if think != nil && *think {
		return "medium"
	}
	return ""
}

func collectionID(req chatRequest) string {
	for _, f := range req.Files {
		if f.Type == "collection" && f.ID != "" {
			return f.ID
		}
	}
	return ""
}

func newCompletionID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return "chatcmpl-" + hex.EncodeToString(b)
}

type delta struct {
	Role             string `json:"role,omitempty"`
	Content          string `json:"content,omitempty"`
	ReasoningContent string `json:"reasoning_content,omitempty"`
}

type chunkChoice struct {
	Index        int     `json:"index"`
	Delta        delta   `json:"delta"`
	FinishReason *string `json:"finish_reason"`
}

type chunk struct {
	ID      string        `json:"id"`
	Object  string        `json:"object"`
	Created int64         `json:"created"`
	Model   string        `json:"model"`
	Choices []chunkChoice `json:"choices"`
}

func writeData(w http.ResponseWriter, v any) {
	b, _ := json.Marshal(v)
	httputil.RearmSSEWriteDeadline(w)
	fmt.Fprintf(w, "data: %s\n\n", b)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

// writeRawDetail writes an error as a bare JSON line: the plugin parses raw
// lines for {"detail":…} and ignores data: {"error":…} (spec §4.5-8).
func writeRawDetail(w http.ResponseWriter, msg string) {
	b, _ := json.Marshal(detailBody{Detail: msg})
	httputil.RearmSSEWriteDeadline(w)
	fmt.Fprintf(w, "%s\n\n", b)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

func writeDone(w http.ResponseWriter) {
	httputil.RearmSSEWriteDeadline(w)
	fmt.Fprint(w, "data: [DONE]\n\n")
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

// ChatCompletions handles POST /owui/api/chat/completions. With a
// files[{type:"collection"}] entry it answers from that KB and opens the
// stream with Open WebUI's sources frame; without one it is a plain LLM call
// (chat objects without resources, chat-title generation).
func (h *Handler) ChatCompletions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	owner, _ := ownerID(r)
	ctx = logctx.WithUser(ctx, owner)

	var req chatRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, maxChatBodyBytes)).Decode(&req); err != nil {
		writeDetail(ctx, w, http.StatusBadRequest, "Ungültige Anfrage.")
		return
	}
	systemParts, history, lastUser := openaicompat.SplitMessages(req.Messages)
	if strings.TrimSpace(lastUser) == "" {
		writeDetail(ctx, w, http.StatusBadRequest, "Die Anfrage enthält keine Nutzernachricht.")
		return
	}
	systemPrefix := strings.Join(systemParts, "\n\n")

	kbID := collectionID(req)
	systemPrompt := systemPrefix
	var sources []chat.ChatSource
	if kbID != "" {
		ok, err := h.d.Store.OwnsKnowledge(ctx, owner, kbID)
		if err != nil {
			logctx.From(ctx).Error("owuicompat: owns knowledge", "error", err)
			writeDetail(ctx, w, http.StatusInternalServerError, "Interner Fehler.")
			return
		}
		if !ok {
			writeDetail(ctx, w, http.StatusNotFound, "Sammlung nicht gefunden.")
			return
		}
		ctx = logctx.WithKB(ctx, kbID)
	}

	if h.d.Usage != nil {
		h.d.Usage.Record(ctx, usage.Event{KbID: kbID, UserID: owner, APIKeyID: auth.APIKeyIDFromContext(ctx), Surface: usage.SurfaceOWUICompat})
	}

	if kbID != "" {
		prep, err := h.d.Answerer.Prepare(ctx, kbID, lastUser, systemPrefix, history)
		if err != nil {
			logctx.From(ctx).Error("owuicompat: prepare context", "error", err)
			observability.RecordOWUIRequest("chat", "error")
			writeDetail(ctx, w, http.StatusInternalServerError, "Die Antwort konnte nicht vorbereitet werden.")
			return
		}
		systemPrompt, sources = prep.SystemPrompt, prep.Sources
	}

	answerHistory := openaicompat.CapAnswerHistory(history)
	id, created := newCompletionID(), time.Now().Unix()

	if !req.Stream {
		text, err := h.d.Answerer.Generate(ctx, kbID, answerHistory, lastUser, systemPrompt, reasoningEffort(req) != "")
		if err != nil || strings.TrimSpace(text) == "" {
			logctx.From(ctx).Error("owuicompat: generate", "error", err)
			observability.RecordOWUIRequest("chat", "error")
			writeDetail(ctx, w, http.StatusInternalServerError, msgStreamFailed)
			return
		}
		if guarded, appended := chat.GuardAnswerText(ctx, h.d.Guard, text, answerLang, guardSurface); appended != "" {
			text = guarded
		}
		observability.RecordOWUIRequest("chat", "ok")
		httputil.WriteJSONCtx(ctx, w, http.StatusOK, map[string]any{
			"id": id, "object": "chat.completion", "created": created, "model": ModelID,
			"choices": []map[string]any{{"index": 0, "message": map[string]string{"role": "assistant", "content": text}, "finish_reason": "stop"}},
		})
		return
	}

	h.stream(ctx, w, kbID, answerHistory, lastUser, systemPrompt, req, id, created, sources)
}

func (h *Handler) stream(ctx context.Context, w http.ResponseWriter, kbID string, history []ai.ChatHistoryEntry,
	prompt, systemPrompt string, req chatRequest, id string, created int64, sources []chat.ChatSource) {
	httputil.EnableSSE(w)

	if len(sources) > 0 {
		fileIDs := make([]string, 0, len(sources))
		for _, s := range sources {
			fileIDs = append(fileIDs, s.FileID)
		}
		handles, err := h.d.Store.HandlesForFiles(ctx, kbID, fileIDs)
		if err != nil {
			logctx.From(ctx).Warn("owuicompat: resolve citation handles", "error", err)
			handles = nil
		}
		writeData(w, buildSourcesFrame(kbID, sources, handles))
	}

	temp := ai.DefaultAnswerTemperature
	if req.Temperature != nil && *req.Temperature > 0 {
		temp = *req.Temperature
	}
	genCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	tracker := chat.NewRunTracker(chat.ChatAnswerDegenerateRunLimit(ctx, h.d.Guard))
	events, err := h.d.Answerer.Stream(genCtx, kbID, history, prompt, systemPrompt, reasoningEffort(req), temp)
	if err != nil {
		logctx.From(ctx).Error("owuicompat: start stream", "error", err)
		observability.RecordOWUIRequest("chat", "error")
		writeRawDetail(w, msgStreamFailed)
		writeDone(w)
		return
	}
	send := func(d delta, finish *string) {
		writeData(w, chunk{ID: id, Object: "chat.completion.chunk", Created: created, Model: ModelID,
			Choices: []chunkChoice{{Index: 0, Delta: d, FinishReason: finish}}})
	}
	send(delta{Role: "assistant"}, nil)

	var full strings.Builder
	sent := 0
	var streamErr error
	for ev := range events {
		if ev.Done {
			streamErr = ev.Err
			break
		}
		if ev.Reasoning != "" {
			send(delta{ReasoningContent: ev.Reasoning}, nil)
		}
		if ev.Content == "" {
			continue
		}
		full.WriteString(ev.Content)
		if tracker.Feed(ev.Content) {
			cancel()
			break
		}
		send(delta{Content: ev.Content}, nil)
		sent = full.Len()
	}
	if tracker.Tripped() {
		text := full.String()
		if _, appended := chat.GuardStreamedAnswer(text, text[:sent], tracker.Limit(), answerLang, guardSurface); appended != "" {
			send(delta{Content: appended}, nil)
		}
	} else if streamErr != nil {
		logctx.From(ctx).Error("owuicompat: stream aborted", "error", streamErr)
		observability.RecordOWUIRequest("chat", "error")
		writeRawDetail(w, msgStreamFailed)
		writeDone(w)
		return
	}
	stop := "stop"
	send(delta{}, &stop)
	observability.RecordOWUIRequest("chat", "ok")
	writeDone(w)
}
