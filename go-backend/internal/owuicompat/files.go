package owuicompat

import (
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/google/uuid"

	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/observability"
	"github.com/justrag/go-backend/internal/uploadcheck"
	"github.com/justrag/go-backend/internal/userfiles"
)

// maxMetadataBytes bounds the plugin's metadata form field.
const maxMetadataBytes = 16 << 10

type fileData struct {
	Status string `json:"status"`
}

type fileMeta struct {
	Name string         `json:"name"`
	Data map[string]any `json:"data"`
}

// fileObject is the Open WebUI file shape, reduced to what the plugin and a
// human debugging it need. The plugin reads only id and data.status.
type fileObject struct {
	ID        string   `json:"id"`
	UserID    string   `json:"user_id"`
	Filename  string   `json:"filename"`
	Meta      fileMeta `json:"meta"`
	Data      fileData `json:"data"`
	CreatedAt int64    `json:"created_at"`
}

func toFileObject(h *FileHandle) fileObject {
	meta := h.Metadata
	if meta == nil {
		meta = map[string]any{}
	}
	return fileObject{ID: h.ID, UserID: h.OwnerUserID, Filename: h.Filename,
		Meta: fileMeta{Name: h.Filename, Data: meta}, Data: fileData{Status: "completed"}, CreatedAt: h.CreatedAt.Unix()}
}

// parseMetadata decodes the plugin's metadata field. Malformed metadata is
// dropped, not an error: it only feeds citation author/date display.
func parseMetadata(r *http.Request) map[string]any {
	raw := r.FormValue("metadata")
	if raw == "" || len(raw) > maxMetadataBytes {
		return map[string]any{}
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil || m == nil {
		return map[string]any{}
	}
	return m
}

// UploadFile handles POST /owui/api/v1/files/. The file lands in the
// service user's library and is reported "completed" at once (spec §4.3
// option B); the real ingest starts when it is added to a collection.
// A file JustRAG cannot ingest is recorded as unsupported, not refused,
// so the plugin's nightly cron does not retry it forever (spec §4.3).
func (h *Handler) UploadFile(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	owner, _ := ownerID(r)
	up, err := uploadcheck.Parse(w, r, nil)
	var ue *uploadcheck.Error
	switch {
	case err == nil:
		defer up.File.Close()
	case errors.As(err, &ue) && ue.Rejected:
		name := ""
		if r.MultipartForm != nil && len(r.MultipartForm.File["file"]) > 0 {
			name = filepath.Base(r.MultipartForm.File["file"][0].Filename)
		}
		if len(name) > 255 {
			name = name[:255]
		}
		fh, cerr := h.d.Store.CreateHandle(ctx, NewHandle{ID: uuid.NewString(), OwnerUserID: owner,
			Filename: name, Metadata: parseMetadata(r), Unsupported: true})
		if cerr != nil {
			logctx.From(ctx).Error("owuicompat: create unsupported handle", "error", cerr)
			observability.RecordOWUIRequest("upload", "error")
			writeDetail(ctx, w, http.StatusInternalServerError, "Die Datei konnte nicht gespeichert werden.")
			return
		}
		logctx.From(ctx).Info("owuicompat: unsupported upload recorded, not indexed",
			"handle", fh.ID, "reason", ue.Message)
		observability.RecordOWUIRequest("upload", "unsupported")
		httputil.WriteJSONCtx(ctx, w, http.StatusOK, toFileObject(fh))
		return
	case errors.As(err, &ue):
		observability.RecordOWUIRequest("upload", "error")
		writeDetail(ctx, w, ue.Status, ue.Message)
		return
	default:
		observability.RecordOWUIRequest("upload", "error")
		writeDetail(ctx, w, http.StatusInternalServerError, "Die Datei konnte nicht gespeichert werden.")
		return
	}

	row, _, err := h.d.Library.Ingest(ctx, owner, up)
	if err != nil {
		var qe *userfiles.QuotaError
		if errors.As(err, &qe) {
			observability.RecordOWUIRequest("upload", "error")
			writeDetail(ctx, w, http.StatusRequestEntityTooLarge, "Speicherkontingent erschöpft.")
			return
		}
		logctx.From(ctx).Error("owuicompat: library ingest", "error", err)
		observability.RecordOWUIRequest("upload", "error")
		writeDetail(ctx, w, http.StatusInternalServerError, "Die Datei konnte nicht gespeichert werden.")
		return
	}
	fh, err := h.d.Store.CreateHandle(ctx, NewHandle{ID: uuid.NewString(), OwnerUserID: owner,
		UserFileID: row.ID, Filename: filepath.Base(up.Header.Filename), Metadata: parseMetadata(r)})
	if err != nil {
		logctx.From(ctx).Error("owuicompat: create handle", "error", err)
		observability.RecordOWUIRequest("upload", "error")
		writeDetail(ctx, w, http.StatusInternalServerError, "Die Datei konnte nicht gespeichert werden.")
		return
	}
	observability.RecordOWUIRequest("upload", "ok")
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, toFileObject(fh))
}

// FileStatus handles GET /owui/api/v1/files/{id}. Unknown ids answer 200
// with status "failed": the plugin runs this GET before every DELETE and a
// 404 would wedge the item forever (spec §2.7-1).
func (h *Handler) FileStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	owner, _ := ownerID(r)
	id := r.PathValue("id")
	fh, err := h.d.Store.GetHandle(ctx, owner, id)
	if err != nil {
		logctx.From(ctx).Error("owuicompat: get handle", "error", err)
		observability.RecordOWUIRequest("file_status", "error")
		writeDetail(ctx, w, http.StatusInternalServerError, "Interner Fehler.")
		return
	}
	if fh == nil {
		observability.RecordOWUIRequest("file_status", "not_found")
		httputil.WriteJSONCtx(ctx, w, http.StatusOK, map[string]any{"id": id, "data": fileData{Status: "failed"}})
		return
	}
	observability.RecordOWUIRequest("file_status", "ok")
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, toFileObject(fh))
}

// ListFiles handles GET /owui/api/v1/files/ — also hit by the plugin's
// status poll for never-uploaded items (empty id, spec §2.7-2).
func (h *Handler) ListFiles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	owner, _ := ownerID(r)
	hs, err := h.d.Store.ListHandles(ctx, owner)
	if err != nil {
		logctx.From(ctx).Error("owuicompat: list handles", "error", err)
		writeDetail(ctx, w, http.StatusInternalServerError, "Interner Fehler.")
		return
	}
	out := make([]fileObject, 0, len(hs))
	for i := range hs {
		out = append(out, toFileObject(&hs[i]))
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, out)
}

// DeleteFile handles DELETE /owui/api/v1/files/{id}. The library file goes
// only with its last handle (identical bytes share one library row); KB
// copies linked only through this handle go with it.
func (h *Handler) DeleteFile(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	owner, _ := ownerID(r)
	id := r.PathValue("id")
	fh, err := h.d.Store.GetHandle(ctx, owner, id)
	if err != nil {
		logctx.From(ctx).Error("owuicompat: get handle", "error", err)
		writeDetail(ctx, w, http.StatusInternalServerError, "Interner Fehler.")
		return
	}
	if fh == nil {
		observability.RecordOWUIRequest("file_delete", "not_found")
		httputil.WriteJSONCtx(ctx, w, http.StatusOK, map[string]any{"id": id, "deleted": false})
		return
	}
	_, last, orphans, err := h.d.Store.DeleteHandle(ctx, owner, id)
	if err != nil {
		logctx.From(ctx).Error("owuicompat: delete handle", "error", err)
		observability.RecordOWUIRequest("file_delete", "error")
		writeDetail(ctx, w, http.StatusInternalServerError, "Interner Fehler.")
		return
	}
	if last && fh.UserFileID != "" {
		// Cascades to every KB copy of the library file.
		if err := h.d.Deleter.DeleteUserFile(ctx, owner, fh.UserFileID); err != nil {
			logctx.From(ctx).Error("owuicompat: delete user file", "error", err)
		}
	} else if len(orphans) > 0 {
		if err := h.d.Deleter.DeleteFiles(ctx, orphans); err != nil {
			logctx.From(ctx).Error("owuicompat: delete orphaned KB files", "error", err)
		}
	}
	observability.RecordOWUIRequest("file_delete", "ok")
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, map[string]any{"id": id, "deleted": true})
}

// FileContent handles GET /owui/api/v1/files/{id}/data/content, reachable
// only from a debug modal in the plugin. JustRAG keeps no flat text per
// library file, so it answers an empty content string (a 404 would raise an
// uncaught exception in that modal).
func (h *Handler) FileContent(w http.ResponseWriter, r *http.Request) {
	httputil.WriteJSONCtx(r.Context(), w, http.StatusOK, map[string]any{
		"id": strings.TrimSpace(r.PathValue("id")), "content": "",
	})
}
