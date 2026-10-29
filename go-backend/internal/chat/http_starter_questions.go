package chat

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/kbbehavior"
	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/prompts"
	"github.com/justrag/go-backend/internal/promptsafety"
)

// StarterSource is what the starter questions of an empty chat are generated
// from (Store.StarterContext).
type StarterSource struct {
	KBName string
	Files  []StarterFile
}

// StarterFile is one ingested document of a KB.
type StarterFile struct {
	ID   string
	Name string
}

// FileExcerptReader reads one excerpt per file from the vector DB
// (*vector.ChunkService), preferring the table of preferredDim (the KB's
// current embedding dimension, 0 = unknown). Optional: without it the
// questions are generated from the file names alone.
type FileExcerptReader interface {
	FileExcerpts(ctx context.Context, kbID string, fileIDs []string, maxLen, preferredDim int) (map[string]string, error)
}

// StarterRoleReader is the optional store capability behind role-aware
// starter questions (PGStore): the brief of the role a new chat starts in
// (roleID, "" = the KB's active role). A store without it gets questions
// without role context.
type StarterRoleReader interface {
	StarterRole(ctx context.Context, kbID, roleID string) (kbbehavior.RoleBrief, error)
}

// WithFileExcerpts wires the excerpt reader behind the starter questions.
func WithFileExcerpts(r FileExcerptReader) HandlerOption {
	return func(h *Handler) { h.fileExcerpts = r }
}

const (
	starterQuestionCount = 6
	// starterPoolLimit documents (the newest) are read, starterDocLimit of
	// them shown to the model per call, picked at random.
	starterPoolLimit        = 40
	starterDocLimit         = 12
	starterExcerptLen       = 600
	maxStarterQuestionRunes = 120

	starterCacheMaxEntries = 512
	// Questions are generated afresh for every empty chat that opens (no
	// shared result); the cache collapses identical concurrent loads and
	// remembers a failure for starterFailureTTL.
	starterCacheTTL        = 0
	starterFailureTTL      = time.Minute
	starterGenerateTimeout = time.Minute
)

type starterQuestionsResponse struct {
	Questions []string `json:"questions"`
}

// StarterQuestions handles GET /api/kb/{id}/starter-questions?lang=de|en&roleId=:
// questions to open an empty chat with, generated afresh on every call by
// the fast-tier model (model_tier_fast, else the KB chat model) from the
// KB's name, the role the chat starts in (roleId, else the active role) and
// one excerpt each of up to starterDocLimit documents picked at random.
// Behind the KB view chain and the dedicated
// "starter_questions" rate limiter. A KB without eligible documents, a deployment without a model,
// or a failed/empty generation answers 200 with an empty list — the client
// then shows its configured suggestions only. A failure to read the KB's
// documents is a 500.
func (h *Handler) StarterQuestions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	parsed, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "knowledge base not found")
		return
	}
	kbID := parsed.String()
	lang := requestLanguage(r.URL.Query().Get("lang"))
	reply := func(q []string) {
		if q == nil {
			q = []string{}
		}
		w.Header().Set("Cache-Control", "no-cache")
		httputil.WriteJSONCtx(ctx, w, http.StatusOK, starterQuestionsResponse{Questions: q})
	}

	if h.aiResolver == nil {
		reply(nil)
		return
	}
	src, err := h.store.StarterContext(ctx, kbID, starterPoolLimit)
	if err != nil {
		logctx.From(ctx).Error("chat.starter_questions: load documents", "error", err, "kb_id", kbID)
		httputil.WriteErrorCtx(ctx, w, http.StatusInternalServerError, "failed to load starter questions")
		return
	}
	if len(src.Files) == 0 {
		reply(nil)
		return
	}

	var role prompts.StarterRole
	roleID := r.URL.Query().Get("roleId")
	if rr, ok := h.store.(StarterRoleReader); ok {
		brief, err := rr.StarterRole(ctx, kbID, roleID)
		if err != nil {
			// Questions without the role are still questions.
			logctx.From(ctx).Warn("chat.starter_questions: role", "error", err, "kb_id", kbID)
		}
		role = prompts.StarterRole{Name: brief.Name, Description: brief.Description, Prompt: brief.Prompt}
	}
	// The key names the documents read, not the pick below: a failure is
	// remembered for the KB, not for one pick.
	fingerprint := starterFingerprint(src)
	// A random pick of the documents in random order: together with the
	// sampling temperature, every empty chat gets other questions.
	rand.Shuffle(len(src.Files), func(i, j int) { src.Files[i], src.Files[j] = src.Files[j], src.Files[i] })
	if len(src.Files) > starterDocLimit {
		src.Files = src.Files[:starterDocLimit]
	}

	// The resolved model and the role are part of the key: a failure
	// remembered for one must not answer for another.
	model := ChatModelTierFast(ctx, h.siteConfigReader)
	key := kbID + "|" + lang + "|" + model + "|" + roleID + "|" + fingerprint
	questions, err := h.starterCache.get(ctx, key, func(lctx context.Context) (starterOutcome, error) {
		return h.generateStarterQuestions(lctx, kbID, lang, model, role, src)
	})
	switch {
	case err == nil, errors.Is(err, errStarterCachedFailure):
		// A cached failure was logged when it happened.
	case ctx.Err() != nil:
		return // client gone; nobody to answer
	default:
		logctx.From(ctx).Warn("chat.starter_questions: generate", "error", err, "kb_id", kbID)
	}
	reply(questions)
}

// generateStarterQuestions runs one generation: excerpts (best effort), the
// model call on model (the resolved fast tier; "" = KB chat model), then
// validation. Zero valid questions is a failure, so it is cached as one
// (briefly) rather than as an empty answer for an hour. Questions generated
// from file names alone because the excerpt read failed are marked degraded,
// so they too are cached only briefly.
func (h *Handler) generateStarterQuestions(ctx context.Context, kbID, lang, model string, role prompts.StarterRole, src StarterSource) (starterOutcome, error) {
	docs, degraded := h.starterDocs(ctx, kbID, src)
	raw, err := ai.GenerateStarterQuestions(ctx, h.aiResolver, kbID, model, src.KBName, role, docs, lang, starterQuestionCount)
	if err != nil {
		return starterOutcome{}, fmt.Errorf("starter questions: generate: %w", err)
	}
	questions := validateStarterQuestions(raw, starterQuestionCount)
	if len(questions) == 0 {
		return starterOutcome{}, fmt.Errorf("starter questions: none of %d model suggestions passed validation", len(raw))
	}
	return starterOutcome{questions: questions, degraded: degraded}, nil
}

// starterDocs reads one excerpt per document (best effort) and pairs it with
// the file name. degraded reports a failed excerpt read: the documents then
// carry their names alone.
func (h *Handler) starterDocs(ctx context.Context, kbID string, src StarterSource) (docs []prompts.StarterDoc, degraded bool) {
	var excerpts map[string]string
	if h.fileExcerpts != nil {
		preferredDim := 0
		if cfg, err := h.aiResolver.Resolve(ctx, kbID); err == nil && cfg != nil {
			preferredDim = cfg.EmbeddingDimensions
		}
		ids := make([]string, len(src.Files))
		for i, f := range src.Files {
			ids[i] = f.ID
		}
		var err error
		if excerpts, err = h.fileExcerpts.FileExcerpts(ctx, kbID, ids, starterExcerptLen, preferredDim); err != nil {
			// File names alone still give usable questions.
			degraded = true
			logctx.From(ctx).Warn("chat.starter_questions: excerpts", "error", err, "kb_id", kbID)
		}
	}
	docs = make([]prompts.StarterDoc, len(src.Files))
	for i, f := range src.Files {
		docs[i] = prompts.StarterDoc{Name: f.Name, Excerpt: excerpts[f.ID]}
	}
	return docs, degraded
}

// starterFingerprint identifies the generator's input: the KB name and the
// sorted ids of the documents it is shown. Adding, removing or replacing a
// document, or renaming the KB, yields a new cache key.
func starterFingerprint(src StarterSource) string {
	ids := make([]string, len(src.Files))
	for i, f := range src.Files {
		ids[i] = f.ID
	}
	slices.Sort(ids)
	h := sha256.New()
	h.Write([]byte(src.KBName))
	for _, id := range ids {
		h.Write([]byte{0})
		h.Write([]byte(id))
	}
	return hex.EncodeToString(h.Sum(nil)[:16])
}

// starterURLRe matches anything link-shaped: a scheme ("https://",
// "ftp://"), "www." or "mailto:".
var starterURLRe = regexp.MustCompile(`(?i)\b[a-z][a-z0-9+.-]*://|\bwww\.|\bmailto:`)

// validateStarterQuestions keeps the model suggestions that are safe to show
// as one-click chat openers, in order, at most limit: trimmed, non-empty, at
// most maxStarterQuestionRunes runes, a single line (no control or line/
// paragraph separator characters), no links, nothing the prompt-injection
// heuristic flags, and no duplicates (compared case- and
// whitespace-insensitively).
func validateStarterQuestions(raw []string, limit int) []string {
	out := make([]string, 0, limit)
	seen := make(map[string]bool, len(raw))
	for _, q := range raw {
		if len(out) == limit {
			break
		}
		q = strings.TrimSpace(q)
		switch {
		case q == "",
			utf8.RuneCountInString(q) > maxStarterQuestionRunes,
			strings.ContainsFunc(q, isLineBreakOrControl),
			starterURLRe.MatchString(q),
			promptsafety.LooksLikeInstruction(q):
			continue
		}
		norm := strings.ToLower(strings.Join(strings.Fields(q), " "))
		if seen[norm] {
			continue
		}
		seen[norm] = true
		out = append(out, q)
	}
	return out
}

func isLineBreakOrControl(r rune) bool {
	return unicode.IsControl(r) || unicode.In(r, unicode.Zl, unicode.Zp)
}
