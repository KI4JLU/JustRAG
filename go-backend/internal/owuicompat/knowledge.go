package owuicompat

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/justrag/go-backend/internal/files"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/observability"
)

const maxJSONBody = 64 << 10

type knowledgeObject struct {
	ID          string           `json:"id"`
	Name        string           `json:"name,omitempty"`
	Description string           `json:"description"`
	Files       []map[string]any `json:"files"`
}

type createKnowledgeRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type fileIDRequest struct {
	FileID string `json:"file_id"`
}

func decodeJSON(r *http.Request, v any) error {
	return json.NewDecoder(io.LimitReader(r.Body, maxJSONBody)).Decode(v)
}

// CreateKnowledge handles POST /owui/api/v1/knowledge/create: a private KB
// owned by the service user, registered as an Open WebUI collection.
func (h *Handler) CreateKnowledge(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	owner, _ := ownerID(r)
	var body createKnowledgeRequest
	if err := decodeJSON(r, &body); err != nil {
		writeDetail(ctx, w, http.StatusBadRequest, "Ungültige Anfrage.")
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = "ILIAS"
	}
	if utf8.RuneCountInString(name) > 255 {
		name = string([]rune(name)[:255])
	}
	desc := body.Description
	if utf8.RuneCountInString(desc) > 2000 {
		desc = string([]rune(desc)[:2000])
	}
	row, err := h.d.Creator.CreateKnowledgeBase(ctx, name, &desc, owner, nil)
	if err != nil {
		logctx.From(ctx).Error("owuicompat: create KB", "error", err)
		observability.RecordOWUIRequest("knowledge_create", "error")
		writeDetail(ctx, w, http.StatusInternalServerError, "Die Sammlung konnte nicht angelegt werden.")
		return
	}
	if err := h.d.Store.RegisterKnowledge(ctx, row.ID, owner); err != nil {
		logctx.From(ctx).Error("owuicompat: register knowledge", "kbId", row.ID, "error", err)
		_ = h.d.Deleter.DeleteKB(ctx, row.ID)
		observability.RecordOWUIRequest("knowledge_create", "error")
		writeDetail(ctx, w, http.StatusInternalServerError, "Die Sammlung konnte nicht angelegt werden.")
		return
	}
	observability.RecordOWUIRequest("knowledge_create", "ok")
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, knowledgeObject{ID: row.ID, Name: row.Name, Description: desc, Files: []map[string]any{}})
}

// knowledgeFor resolves {id} to a collection the caller owns, or writes 404.
func (h *Handler) knowledgeFor(w http.ResponseWriter, r *http.Request, owner string) (string, bool) {
	kbID := r.PathValue("id")
	ok, err := h.d.Store.OwnsKnowledge(r.Context(), owner, kbID)
	if err != nil {
		logctx.From(r.Context()).Error("owuicompat: owns knowledge", "error", err)
		writeDetail(r.Context(), w, http.StatusInternalServerError, "Interner Fehler.")
		return "", false
	}
	if !ok {
		writeDetail(r.Context(), w, http.StatusNotFound, "Sammlung nicht gefunden.")
		return "", false
	}
	return kbID, true
}

// AddToKnowledge handles POST /owui/api/v1/knowledge/{id}/file/add. It
// starts the ingest (or an index copy) via the library's from-library path.
// Every outcome is a 2xx JSON object (the plugin throws on >= 400): success
// carries "id", a soft failure (KB full, file gone) carries no "id", so the
// plugin retries in its next run.
func (h *Handler) AddToKnowledge(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	owner, _ := ownerID(r)
	kbID, ok := h.knowledgeFor(w, r, owner)
	if !ok {
		return
	}
	var body fileIDRequest
	if err := decodeJSON(r, &body); err != nil {
		writeDetail(ctx, w, http.StatusBadRequest, "Ungültige Anfrage.")
		return
	}
	fh, err := h.d.Store.GetHandle(ctx, owner, body.FileID)
	if err != nil {
		logctx.From(ctx).Error("owuicompat: get handle", "error", err)
		writeDetail(ctx, w, http.StatusInternalServerError, "Interner Fehler.")
		return
	}
	soft := func(reason string) {
		logctx.From(ctx).Warn("owuicompat: add to knowledge not done", "kbId", kbID, "handle", body.FileID, "reason", reason)
		observability.RecordOWUIRequest("knowledge_add", "error")
		httputil.WriteJSONCtx(ctx, w, http.StatusOK, map[string]any{"detail": "Datei konnte nicht hinzugefügt werden (" + reason + ")."})
	}
	if fh == nil {
		soft("file_not_found")
		return
	}
	fileID := ""
	if !fh.Unsupported && fh.UserFileID != "" {
		res, err := h.d.Adder.AddLibraryFiles(ctx, owner, kbID, false, []string{fh.UserFileID})
		if err != nil {
			logctx.From(ctx).Error("owuicompat: add library file", "error", err)
			soft("internal")
			return
		}
		if len(res) != 1 || res[0].Status == files.AddStatusError {
			reason := "unknown"
			if len(res) == 1 {
				reason = res[0].Error
			}
			soft(reason)
			return
		}
		fileID = res[0].FileID
		if fileID == "" { // duplicate: the KB already holds this library file
			if fileID, err = h.d.Store.KBFileForUserFile(ctx, kbID, fh.UserFileID); err != nil {
				logctx.From(ctx).Error("owuicompat: lookup KB file", "error", err)
				soft("internal")
				return
			}
		}
	}
	if err := h.d.Store.LinkFile(ctx, kbID, fh.ID, fileID); err != nil {
		logctx.From(ctx).Error("owuicompat: link file", "error", err)
		soft("internal")
		return
	}
	outcome := "ok"
	if fh.Unsupported {
		outcome = "unsupported"
	}
	observability.RecordOWUIRequest("knowledge_add", outcome)
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, knowledgeObject{ID: kbID, Files: []map[string]any{{"id": fh.ID}}})
}

// RemoveFromKnowledge handles POST /owui/api/v1/knowledge/{id}/file/remove.
// The plugin always sends delete_file=false; the library file stays. The
// KB's indexed copy goes unless another handle in the KB still maps to it.
func (h *Handler) RemoveFromKnowledge(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	owner, _ := ownerID(r)
	kbID, ok := h.knowledgeFor(w, r, owner)
	if !ok {
		return
	}
	var body fileIDRequest
	if err := decodeJSON(r, &body); err != nil {
		writeDetail(ctx, w, http.StatusBadRequest, "Ungültige Anfrage.")
		return
	}
	orphan, err := h.d.Store.UnlinkPlan(ctx, kbID, body.FileID)
	if err != nil {
		logctx.From(ctx).Error("owuicompat: unlink plan", "error", err)
		observability.RecordOWUIRequest("knowledge_remove", "error")
		writeDetail(ctx, w, http.StatusInternalServerError, "Interner Fehler.")
		return
	}
	// Delete the indexed copy first; the link is the retry anchor.
	if orphan != "" {
		if err := h.d.Deleter.DeleteFiles(ctx, []string{orphan}); err != nil {
			logctx.From(ctx).Error("owuicompat: delete KB file failed, link kept",
				"kb", kbID, "handle", body.FileID, "fileId", orphan, "error", err)
			observability.RecordOWUIRequest("knowledge_remove", "error")
			writeDetail(ctx, w, http.StatusInternalServerError, "Die Datei konnte nicht vollständig entfernt werden. Bitte später erneut versuchen.")
			return
		}
	}
	if _, err := h.d.Store.UnlinkFile(ctx, kbID, body.FileID); err != nil {
		logctx.From(ctx).Error("owuicompat: unlink", "error", err)
		observability.RecordOWUIRequest("knowledge_remove", "error")
		writeDetail(ctx, w, http.StatusInternalServerError, "Interner Fehler.")
		return
	}
	observability.RecordOWUIRequest("knowledge_remove", "ok")
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, knowledgeObject{ID: kbID, Files: []map[string]any{}})
}

// DeleteKnowledge handles DELETE /owui/api/v1/knowledge/{id}/delete. The
// plugin never calls it today (spec §2.3); implemented for completeness.
func (h *Handler) DeleteKnowledge(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	owner, _ := ownerID(r)
	kbID, ok := h.knowledgeFor(w, r, owner)
	if !ok {
		return
	}
	if err := h.d.Deleter.DeleteKB(ctx, kbID); err != nil {
		logctx.From(ctx).Error("owuicompat: delete KB", "error", err)
		writeDetail(ctx, w, http.StatusInternalServerError, "Interner Fehler.")
		return
	}
	observability.RecordOWUIRequest("knowledge_delete", "ok")
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, map[string]any{"id": kbID, "deleted": true})
}
