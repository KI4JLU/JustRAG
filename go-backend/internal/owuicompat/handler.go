package owuicompat

import (
	"context"
	"net/http"
	"time"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/chat"
	"github.com/justrag/go-backend/internal/files"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/kb"
	"github.com/justrag/go-backend/internal/uploadcheck"
	"github.com/justrag/go-backend/internal/usage"
	"github.com/justrag/go-backend/internal/userfiles"
)

// ModelID is the single model this surface advertises. The plugin needs a
// value for its config; the request's model field is ignored (spec §4.5-3).
const ModelID = "justrag"

// EnabledKey is the global site_config flag gating the whole surface.
const EnabledKey = "owui_compat_enabled"

type Library interface {
	Ingest(ctx context.Context, ownerID string, up *uploadcheck.Upload) (*userfiles.UserFile, bool, error)
}

type KBAdder interface {
	AddLibraryFiles(ctx context.Context, userID, kbID string, isGlobal bool, userFileIDs []string) ([]files.AddResult, error)
}

type KBCreator interface {
	CreateKnowledgeBase(ctx context.Context, name string, description *string, userID string, systemPrompt *string) (*kb.KBRow, error)
}

type Deleter interface {
	DeleteFiles(ctx context.Context, fileIDs []string) error
	DeleteUserFile(ctx context.Context, ownerID, userFileID string) error
	DeleteKB(ctx context.Context, kbID string) error
}

type ConfigReader interface {
	GetSiteConfigValue(ctx context.Context, key string) (*string, error)
}

// Deps are the handler's collaborators. Usage and Guard may be nil.
type Deps struct {
	Store    Store
	Library  Library
	Adder    KBAdder
	Creator  KBCreator
	Deleter  Deleter
	Config   ConfigReader
	Answerer Answerer
	Guard    chat.SiteConfigReader
	Usage    usage.Recorder
}

type Handler struct{ d Deps }

func NewHandler(d Deps) *Handler { return &Handler{d: d} }

type detailBody struct {
	Detail string `json:"detail"`
}

// writeDetail writes an Open WebUI-style error body. msg is shown to
// students by the plugin, so it must never carry internals.
func writeDetail(ctx context.Context, w http.ResponseWriter, status int, msg string) {
	httputil.WriteJSONCtx(ctx, w, status, detailBody{Detail: msg})
}

func (h *Handler) enabled(ctx context.Context) bool {
	if h.d.Config == nil {
		return false
	}
	v, err := h.d.Config.GetSiteConfigValue(ctx, EnabledKey)
	return err == nil && v != nil && *v == "true"
}

// Gate answers 404 while the flag is off and 401 without an authenticated
// user. It runs inside apikeyauth.Authenticate in production.
func (h *Handler) Gate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !h.enabled(r.Context()) {
			writeDetail(r.Context(), w, http.StatusNotFound, "Not Found")
			return
		}
		if auth.UserFromContext(r.Context()) == nil {
			writeDetail(r.Context(), w, http.StatusUnauthorized, "Not authenticated")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func ownerID(r *http.Request) (string, bool) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		return "", false
	}
	return u.ID, true
}

type modelObject struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	OwnedBy string `json:"owned_by"`
}

// Models handles GET /owui/api/models. The plugin only renders the JSON.
func (h *Handler) Models(w http.ResponseWriter, r *http.Request) {
	httputil.WriteJSONCtx(r.Context(), w, http.StatusOK, map[string]any{
		"data": []modelObject{{ID: ModelID, Name: "JustRAG", Object: "model", Created: time.Now().Unix(), OwnedBy: "justrag"}},
	})
}
