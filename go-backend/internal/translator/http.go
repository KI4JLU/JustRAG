package translator

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/chat"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/translatorlang"
)

// textBodyMaxBytes bounds a text request. The limit that counts is the decoded
// one, TextMax runes (validateSegments); this only keeps the read bounded. A
// character outside the Basic Multilingual Plane can arrive JSON-escaped as a
// surrogate pair, two \uXXXX escapes of six bytes each, so a rune takes up to
// twelve bytes on the wire (four decoded in UTF-8), plus the JSON framing, the
// sentence separators and the glossary ids. It stays under the server's global
// 1 MiB request cap.
const textBodyMaxBytes = 12*TextMax + (1 << 16)

// decodeJSONBody reads a JSON body of at most limit bytes into v. It reports
// false after writing the error: 413 for a body over the limit, 400 for one
// that does not decode.
func decodeJSONBody(w http.ResponseWriter, r *http.Request, limit int64, v any) bool {
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit)).Decode(v)
	if err == nil {
		return true
	}
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusRequestEntityTooLarge, "request body too large")
		return false
	}
	httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, "invalid request body")
	return false
}

// Handler serves the text routes and the extension's configuration.
type Handler struct {
	svc       *Service
	completer Completer
	reader    chat.SiteConfigReader
}

// NewHandler creates a Handler. reader supplies the site_config switches.
func NewHandler(svc *Service, completer Completer, reader chat.SiteConfigReader) *Handler {
	return &Handler{svc: svc, completer: completer, reader: reader}
}

// Enabled reports whether the extension is switched on (translator_enabled,
// off by default).
func (h *Handler) Enabled(ctx context.Context) bool {
	return chat.ReadBool(ctx, h.reader, KeyEnabled, false)
}

// DefaultTarget returns the configured default target language, falling back
// to the built-in default when the stored value is not a language.
func (h *Handler) DefaultTarget(ctx context.Context) string {
	if v := chat.ReadString(ctx, h.reader, KeyDefaultTarget); translatorlang.Valid(v) {
		return v
	}
	return translatorlang.DefaultTarget
}

// RequireEnabled refuses with 403 and code translator_disabled while the
// extension is off. The configuration route is the one exception: the UI
// reads it to learn that.
func (h *Handler) RequireEnabled(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !h.Enabled(r.Context()) {
			httputil.WriteCodedErrorCtx(r.Context(), w, http.StatusForbidden, "translator_disabled", "The translation is not enabled")
			return
		}
		next.ServeHTTP(w, r)
	})
}

type limits struct {
	TextMax                 int `json:"textMax"`
	SegmentsMax             int `json:"segmentsMax"`
	DetectSampleMax         int `json:"detectSampleMax"`
	SuggestTextMax          int `json:"suggestTextMax"`
	GlossariesPerRequestMax int `json:"glossariesPerRequestMax"`
	GlossaryImportMaxBytes  int `json:"glossaryImportMaxBytes"`
	GlossaryEntriesMax      int `json:"glossaryEntriesMax"`
	GlossaryTermMaxRunes    int `json:"glossaryTermMaxRunes"`
}

type configResponse struct {
	Enabled               bool                      `json:"enabled"`
	DefaultTargetLanguage string                    `json:"defaultTargetLanguage"`
	Languages             []translatorlang.Language `json:"languages"`
	GlossaryLanguages     []string                  `json:"glossaryLanguages"`
	// Model names the model the calls run on right now; ModelSource says
	// whether that is the Fast Tier model ("fastTier") or, with none set, the
	// provider's default chat model ("default"). Both are empty when no model
	// can be resolved.
	Model       string `json:"model"`
	ModelSource string `json:"modelSource"`
	Limits      limits `json:"limits"`
}

// Config handles GET /api/translator/config.
func (h *Handler) Config(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	model, source := h.completer.Model(ctx)
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, configResponse{
		Enabled:               h.Enabled(ctx),
		DefaultTargetLanguage: h.DefaultTarget(ctx),
		Languages:             translatorlang.All(),
		GlossaryLanguages:     translatorlang.GlossaryLanguages(),
		Model:                 model,
		ModelSource:           source,
		Limits: limits{
			TextMax: TextMax, SegmentsMax: SegmentsMax, DetectSampleMax: DetectSampleMax,
			SuggestTextMax: SuggestTextMax, GlossariesPerRequestMax: GlossariesPerRequestMax,
			GlossaryImportMaxBytes: GlossaryImportMaxBytes,
		},
	})
}

// handle decodes the body into a request, runs call and writes its answer or
// the matching error: 400 for a refused request; for a model failure 504 when it
// did not answer in time, 503 when no provider can be used, else 502.
func handle[Req, Res any](h *Handler, w http.ResponseWriter, r *http.Request, call func(ctx context.Context, userID string, req Req) (Res, error)) {
	ctx := r.Context()
	user := auth.UserFromContext(ctx)
	if user == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	var req Req
	if !decodeJSONBody(w, r, textBodyMaxBytes, &req) {
		return
	}
	res, err := call(ctx, user.ID, req)
	if err != nil && ctx.Err() != nil {
		// The client left (a new request replaced this one, or the page closed):
		// nobody reads an answer, and it is no failure of the model.
		w.WriteHeader(statusClientClosedRequest)
		return
	}
	switch {
	case errors.Is(err, ErrInvalid):
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, trimInvalid(err))
	case errors.Is(err, ErrModel):
		// The client gets the cause as a code it can word for the user; the
		// operator gets the failure class and the provider's status. Never the
		// error text: a provider's error body may echo the submitted text and
		// the glossary terms.
		class, status := modelFailureClass(err)
		logctx.From(ctx).Warn("translator model call failed", "failure", class, "upstream_status", status)
		switch {
		case errors.Is(err, ErrModelTimeout):
			httputil.WriteCodedErrorCtx(ctx, w, http.StatusGatewayTimeout, "translator_model_timeout", "The model did not answer in time")
		case errors.Is(err, ErrModelUnavailable):
			httputil.WriteCodedErrorCtx(ctx, w, http.StatusServiceUnavailable, "translator_model_unavailable", "No model is available")
		default:
			httputil.WriteCodedErrorCtx(ctx, w, http.StatusBadGateway, "translator_model_failed", "The model could not answer")
		}
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, err)
	default:
		httputil.WriteJSONCtx(ctx, w, http.StatusOK, res)
	}
}

// trimInvalid drops the sentinel prefix from a validation error's message.
func trimInvalid(err error) string {
	msg := err.Error()
	const prefix = "translator: invalid request: "
	if len(msg) >= len(prefix) && msg[:len(prefix)] == prefix {
		return msg[len(prefix):]
	}
	return msg
}

// Translate handles POST /api/translator/translate.
func (h *Handler) Translate(w http.ResponseWriter, r *http.Request) {
	handle(h, w, r, h.svc.Translate)
}

// Rephrase handles POST /api/translator/rephrase.
func (h *Handler) Rephrase(w http.ResponseWriter, r *http.Request) {
	handle(h, w, r, h.svc.Rephrase)
}

// Detect handles POST /api/translator/detect.
func (h *Handler) Detect(w http.ResponseWriter, r *http.Request) {
	handle(h, w, r, func(ctx context.Context, _ string, req DetectRequest) (DetectResponse, error) {
		return h.svc.Detect(ctx, req)
	})
}

// Suggest handles POST /api/translator/suggest.
func (h *Handler) Suggest(w http.ResponseWriter, r *http.Request) {
	handle(h, w, r, func(ctx context.Context, _ string, req SuggestRequest) (SuggestResponse, error) {
		return h.svc.Suggest(ctx, req)
	})
}
