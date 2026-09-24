package chat

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/prompts"
)

// StarterContextStore is the optional store capability behind the starter
// questions (PGStore has it; test stores without it get an empty list).
type StarterContextStore interface {
	StarterContext(ctx context.Context, kbID string, limit int) (kbName string, files []StarterFile, fingerprint string, err error)
}

// StarterFile is one ingested document of a KB.
type StarterFile struct {
	ID   string
	Name string
}

// FileExcerptReader reads one excerpt per file from the vector DB
// (*vector.ChunkService). Optional: without it the questions are generated
// from the file names alone.
type FileExcerptReader interface {
	FileExcerpts(ctx context.Context, kbID string, fileIDs []string, maxLen int) (map[string]string, error)
}

// WithFileExcerpts wires the excerpt reader behind the starter questions.
func WithFileExcerpts(r FileExcerptReader) HandlerOption {
	return func(h *Handler) { h.fileExcerpts = r }
}

const (
	starterQuestionCount = 6
	starterDocLimit      = 12
	starterExcerptLen    = 600
	starterCacheTTL      = time.Hour
)

type starterEntry struct {
	questions []string
	expires   time.Time
}

// starterCache keeps generated questions per KB, language and content
// fingerprint, so opening empty chats does not cost a model call each time.
var starterCache = struct {
	sync.Mutex
	m map[string]starterEntry
}{m: map[string]starterEntry{}}

type starterQuestionsResponse struct {
	Questions []string `json:"questions"`
}

// StarterQuestions handles GET /api/kb/{id}/starter-questions?lang=de|en:
// questions to open an empty chat with, generated from the KB's documents
// by the same model call as the follow-up questions. A KB without ingested
// documents, or a failed generation, answers with an empty list — the client
// then shows its configured suggestions only.
func (h *Handler) StarterQuestions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	kbID := r.PathValue("id")
	lang := "en"
	if r.URL.Query().Get("lang") == "de" {
		lang = "de"
	}
	reply := func(q []string) {
		if q == nil {
			q = []string{}
		}
		w.Header().Set("Cache-Control", "no-cache")
		httputil.WriteJSONCtx(ctx, w, http.StatusOK, starterQuestionsResponse{Questions: q})
	}

	src, ok := h.store.(StarterContextStore)
	if !ok || h.aiResolver == nil {
		reply(nil)
		return
	}
	name, files, fingerprint, err := src.StarterContext(ctx, kbID, starterDocLimit)
	if err != nil {
		logctx.From(ctx).Warn("chat.starter_questions: context", "error", err, "kb_id", kbID)
		reply(nil)
		return
	}
	if len(files) == 0 {
		reply(nil)
		return
	}

	key := kbID + "|" + lang + "|" + fingerprint
	starterCache.Lock()
	if e, hit := starterCache.m[key]; hit && time.Now().Before(e.expires) {
		starterCache.Unlock()
		reply(e.questions)
		return
	}
	starterCache.Unlock()

	var excerpts map[string]string
	if h.fileExcerpts != nil {
		ids := make([]string, len(files))
		for i, f := range files {
			ids[i] = f.ID
		}
		if excerpts, err = h.fileExcerpts.FileExcerpts(ctx, kbID, ids, starterExcerptLen); err != nil {
			logctx.From(ctx).Warn("chat.starter_questions: excerpts", "error", err, "kb_id", kbID)
		}
	}
	docs := make([]prompts.StarterDoc, len(files))
	for i, f := range files {
		docs[i] = prompts.StarterDoc{Name: f.Name, Excerpt: excerpts[f.ID]}
	}

	questions, err := ai.GenerateStarterQuestions(ctx, h.aiResolver, name, docs, kbID, lang, starterQuestionCount)
	if err != nil {
		logctx.From(ctx).Warn("chat.starter_questions: generate", "error", err, "kb_id", kbID)
		reply(nil)
		return
	}
	cleaned := questions[:0]
	for _, q := range questions {
		if q = strings.TrimSpace(q); q != "" {
			cleaned = append(cleaned, q)
		}
	}
	if len(cleaned) > 0 {
		starterCache.Lock()
		starterCache.m[key] = starterEntry{questions: cleaned, expires: time.Now().Add(starterCacheTTL)}
		starterCache.Unlock()
	}
	reply(cleaned)
}
