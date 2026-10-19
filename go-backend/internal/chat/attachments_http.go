package chat

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/uploadcheck"
	"github.com/justrag/go-backend/internal/userfiles"
)

// AttachmentIngester stores an upload as a user file of a given scope.
// Satisfied by *userfiles.Ingester.
type AttachmentIngester interface {
	IngestScoped(ctx context.Context, ownerID string, up *uploadcheck.Upload, scope string) (*userfiles.UserFile, bool, error)
}

// UserFileDeleter removes a chat attachment with its blob and caches, but
// only if nothing references it any more; the check and the delete share one
// transaction (a zero staleBefore skips the age check). Satisfied by
// *cascade.Deleter.
type UserFileDeleter interface {
	DeleteChatAttachment(ctx context.Context, ownerID, userFileID string, staleBefore time.Time) (bool, error)
}

// WithChatAttachments wires chat attachments (migration 0090). They also
// read files and text through the library chat wiring (WithLibraryChat).
func WithChatAttachments(store AttachmentStore, ingester AttachmentIngester, deleter UserFileDeleter, limits uploadcheck.Limits) HandlerOption {
	return func(h *Handler) {
		h.attachmentFiles = store
		h.attachIngester = ingester
		h.attachDeleter = deleter
		h.attachLimits = limits
	}
}

func (h *Handler) chatAttachmentsWired() bool {
	return h.attachmentFiles != nil && h.attachIngester != nil && h.attachDeleter != nil &&
		h.attachLimits != nil && h.libraryFiles != nil && h.libraryText != nil && h.aiResolver != nil
}

// attachmentCleanupTimeout bounds the detached delete of a rejected or
// orphaned attachment.
const attachmentCleanupTimeout = 30 * time.Second

// chatAttachmentResponse is the 201 body of an upload.
type chatAttachmentResponse struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Mime   string `json:"mime"`
	Size   int64  `json:"size"`
	Tokens int    `json:"tokens"`
}

// UploadChatAttachment handles POST /api/kb/{id}/chat/attachments: one
// multipart "file", stored as a chat-scoped user file (or the caller's
// existing file with the same bytes), parsed and counted now, so a file the
// chat cannot use is refused before the message is sent. KB-scoped because
// the token budget is the KB answer model's; nothing KB-bound is stored.
// Auth + KB view are enforced by the route chain.
func (h *Handler) UploadChatAttachment(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.UserFromContext(ctx)
	if user == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	if !h.chatAttachmentsWired() {
		httputil.WriteErrorCtx(ctx, w, http.StatusServiceUnavailable, "chat attachments are not available")
		return
	}
	parsed, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "knowledge base not found")
		return
	}
	kbID := parsed.String()
	ctx = logctx.Attach(logctx.WithUser(logctx.WithKB(ctx, kbID), user.ID))

	up, err := uploadcheck.Parse(w, r, h.attachLimits)
	if err != nil {
		var ue *uploadcheck.Error
		if errors.As(err, &ue) {
			httputil.WriteErrorCtx(ctx, w, ue.Status, ue.Message)
			return
		}
		httputil.WriteInternalErrorCtx(ctx, w, err)
		return
	}
	defer up.File.Close()

	uf, created, err := h.attachIngester.IngestScoped(ctx, user.ID, up, userfiles.ScopeChat)
	if err != nil {
		var qe *userfiles.QuotaError
		if errors.As(err, &qe) {
			userfiles.WriteQuotaExceeded(ctx, w, qe)
			return
		}
		logctx.From(ctx).Error("chat.attachments: store upload", "error", err)
		httputil.WriteInternalErrorCtx(ctx, w, err)
		return
	}
	// A refusal below removes a file this request created; a dedup hit is
	// the user's existing file and stays.
	rollback := func() {
		if created {
			h.deleteAttachmentFile(ctx, user.ID, uf.ID)
		}
	}

	text, err := h.attachmentText(ctx, uf)
	if err != nil {
		rollback()
		status, msg := attachmentTextError(err, uf.Name)
		if status == http.StatusInternalServerError {
			logctx.From(ctx).Error("chat.attachments: read text", "error", err, "user_file_id", uf.ID)
		}
		httputil.WriteErrorCtx(ctx, w, status, msg)
		return
	}
	lim, err := h.resolveAttachmentLimits(ctx, kbID)
	if err != nil {
		rollback()
		logctx.From(ctx).Error("chat.attachments: resolve limits", "error", err)
		httputil.WriteInternalErrorCtx(ctx, w, err)
		return
	}
	tokens := h.attachTokens.count(ctx, lim, uf.ID, text)
	if tokens > lim.budget {
		rollback()
		writeTooLargeForContext(ctx, w, tokens, lim.budget)
		return
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusCreated, chatAttachmentResponse{
		ID: uf.ID, Name: uf.Name, Mime: uf.Mime, Size: uf.Size, Tokens: tokens,
	})
}

// attachmentTextError maps a text-read failure to the upload / send status.
func attachmentTextError(err error, name string) (int, string) {
	switch {
	case errors.Is(err, ErrUnparseable):
		return http.StatusUnsupportedMediaType, "unsupported file type"
	case errors.Is(err, ErrLibraryParseTimeout):
		return http.StatusUnprocessableEntity, fmt.Sprintf("the file %q took too long to read", name)
	case errors.Is(err, errAttachmentText):
		return http.StatusUnprocessableEntity, "the file contained no extractable text"
	default:
		return http.StatusInternalServerError, "failed to read the file"
	}
}

// writeTooLargeForContext answers 422 too_large_for_context: the documents
// would not fit the answer model's attachment budget.
func writeTooLargeForContext(ctx context.Context, w http.ResponseWriter, tokens, limit int) {
	httputil.WriteJSONCtx(ctx, w, http.StatusUnprocessableEntity, map[string]any{
		"error":  "too_large_for_context",
		"tokens": tokens,
		"limit":  limit,
	})
}

// deleteAttachmentFile removes a chat attachment that nothing references,
// detached from the request so a client disconnect cannot leave it behind.
// A file that was sent, added to a KB or promoted to the library in the
// meantime stays. Best effort: the userfiles pending sweep removes what this
// misses.
func (h *Handler) deleteAttachmentFile(ctx context.Context, ownerID, userFileID string) {
	dctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), attachmentCleanupTimeout)
	defer cancel()
	if _, err := h.attachDeleter.DeleteChatAttachment(dctx, ownerID, userFileID, time.Time{}); err != nil {
		logctx.From(ctx).Warn("chat.attachments: delete attachment (best effort)", "user_file_id", userFileID, "error", err)
	}
}

// turnAttachmentError is a send refusal decided by validateTurnAttachments.
type turnAttachmentError struct {
	status int
	msg    string
	// tokens/limit are set for too_large_for_context.
	tokens, limit int
}

func (e *turnAttachmentError) write(ctx context.Context, w http.ResponseWriter) {
	if e.limit > 0 {
		writeTooLargeForContext(ctx, w, e.tokens, e.limit)
		return
	}
	httputil.WriteErrorCtx(ctx, w, e.status, e.msg)
}

// validateTurnAttachments checks a send's attachmentIds before anything is
// written (no chat, no usage row): count, combination with other turn kinds,
// ownership, readable text and the budget of the new documents. Returns the
// resolved attachments and the turn's limits (zero when there are none).
func (h *Handler) validateTurnAttachments(ctx context.Context, body sendMessageRequest, userID, kbID string) ([]newAttachment, *attachmentLimits, *turnAttachmentError) {
	if len(body.AttachmentIDs) == 0 {
		return nil, nil, nil
	}
	if !h.chatAttachmentsWired() {
		return nil, nil, &turnAttachmentError{status: http.StatusServiceUnavailable, msg: "chat attachments are not available"}
	}
	if max := ChatAttachmentsMaxPerMessage(ctx, h.siteConfigReader); len(body.AttachmentIDs) > max {
		return nil, nil, &turnAttachmentError{status: http.StatusBadRequest, msg: fmt.Sprintf("at most %d attachments per message", max)}
	}
	// A fresh comparison run answers from its own orchestrator, which reads
	// no chat attachments. A comparison follow-up (attachmentId without
	// modes) is fine: it only adds the comparison block to the system prompt.
	if len(body.ComparisonModes) > 0 {
		return nil, nil, &turnAttachmentError{status: http.StatusBadRequest, msg: "attachmentIds cannot be combined with a document comparison run"}
	}
	if body.RegenerateOfMessageID != "" {
		return nil, nil, &turnAttachmentError{status: http.StatusBadRequest, msg: "a regenerated answer keeps its question's attachments"}
	}

	lim, err := h.resolveAttachmentLimits(ctx, kbID)
	if err != nil {
		logctx.From(ctx).Error("chat.attachments: resolve limits", "error", err)
		return nil, nil, &turnAttachmentError{status: http.StatusInternalServerError, msg: "failed to read the attachments"}
	}
	seen := make(map[string]bool, len(body.AttachmentIDs))
	out := make([]newAttachment, 0, len(body.AttachmentIDs))
	total := 0
	for _, raw := range body.AttachmentIDs {
		parsed, err := uuid.Parse(raw)
		if err != nil {
			return nil, nil, &turnAttachmentError{status: http.StatusNotFound, msg: "attachment not found"}
		}
		id := parsed.String()
		if seen[id] {
			continue
		}
		seen[id] = true
		uf, err := h.libraryFiles.Get(ctx, userID, id)
		if errors.Is(err, userfiles.ErrNotFound) {
			return nil, nil, &turnAttachmentError{status: http.StatusNotFound, msg: "attachment not found"}
		}
		if err != nil {
			logctx.From(ctx).Error("chat.attachments: get file", "error", err, "user_file_id", id)
			return nil, nil, &turnAttachmentError{status: http.StatusInternalServerError, msg: "failed to read the attachments"}
		}
		text, err := h.attachmentText(ctx, uf)
		if err != nil {
			status, msg := attachmentTextError(err, uf.Name)
			if status == http.StatusInternalServerError {
				logctx.From(ctx).Error("chat.attachments: read text", "error", err, "user_file_id", id)
			}
			return nil, nil, &turnAttachmentError{status: status, msg: msg}
		}
		tokens := h.attachTokens.count(ctx, lim, uf.ID, text)
		total += tokens
		out = append(out, newAttachment{file: uf, text: text, tokens: tokens})
	}
	if total > lim.budget {
		return nil, nil, &turnAttachmentError{status: http.StatusUnprocessableEntity, tokens: total, limit: lim.budget}
	}
	return out, &lim, nil
}

// prepareTurnDocuments builds the turn's documents from the conversation and
// the validated new attachments. The conversation's attachment links are
// read first; lim is resolved (a model, maybe a provider lookup) only when
// documents exist and the send did not resolve it already. Fail-soft: a
// store or model error leaves the turn without the earlier documents
// (logged); the new attachments were already checked.
func (h *Handler) prepareTurnDocuments(ctx context.Context, kbID, lang string, lim *attachmentLimits, convRows []MessageRow, extraMessageIDs []string, news []newAttachment) *turnDocuments {
	if h.attachmentFiles == nil || h.libraryText == nil {
		return nil
	}
	earlier, err := h.conversationAttachments(ctx, convRows, extraMessageIDs)
	if err != nil {
		logctx.From(ctx).Warn("chat.attachments: load earlier attachments; turn proceeds without them", "error", err)
		earlier = nil
	}
	if len(earlier) == 0 && len(news) == 0 {
		return nil
	}
	if lim == nil {
		resolved, err := h.resolveAttachmentLimits(ctx, kbID)
		if err != nil {
			logctx.From(ctx).Warn("chat.attachments: resolve limits; turn proceeds without documents", "error", err)
			return nil
		}
		lim = &resolved
	}
	return h.buildTurnDocuments(ctx, lang, *lim, earlier, news)
}

// conversationAttachments returns the attachments of the user messages in
// convRows (in conversation order), then those of extraMessageIDs (a
// regenerated question).
func (h *Handler) conversationAttachments(ctx context.Context, convRows []MessageRow, extraMessageIDs []string) ([]attachedFile, error) {
	var msgIDs []string
	for _, r := range convRows {
		if r.Role == "user" {
			msgIDs = append(msgIDs, r.ID)
		}
	}
	msgIDs = append(msgIDs, extraMessageIDs...)
	if len(msgIDs) == 0 {
		return nil, nil
	}
	return h.attachmentFiles.MessageAttachments(ctx, msgIDs)
}

// cleanupChatAttachments deletes the chat-scoped files the deleted chat
// referenced that nothing else references any more. refs were collected
// before the chat went. Best effort; the pending sweep catches the rest.
func (h *Handler) cleanupChatAttachments(ctx context.Context, refs []userFileRef) {
	if len(refs) == 0 || h.attachmentFiles == nil || h.attachDeleter == nil {
		return
	}
	for _, ref := range refs {
		h.deleteAttachmentFile(ctx, ref.OwnerID, ref.ID)
	}
}

// fillMessageAttachments sets Attachments on the user messages of rows with
// one batched query. Fail-soft: an error leaves the history without chips.
func (h *Handler) fillMessageAttachments(ctx context.Context, rows []MessageRow) {
	if h.attachmentFiles == nil || len(rows) == 0 {
		return
	}
	ids := make([]string, 0, len(rows))
	byID := make(map[string]int, len(rows))
	for i, r := range rows {
		if r.Role == "user" {
			ids = append(ids, r.ID)
			byID[r.ID] = i
		}
	}
	if len(ids) == 0 {
		return
	}
	atts, err := h.attachmentFiles.MessageAttachments(ctx, ids)
	if err != nil {
		logctx.From(ctx).Warn("chat.attachments: load message attachments", "error", err)
		return
	}
	for _, a := range atts {
		i, ok := byID[a.MessageID]
		if !ok {
			continue
		}
		rows[i].Attachments = append(rows[i].Attachments, MessageAttachment{
			UserFileID: a.File.ID, Name: a.File.Name, Mime: a.File.Mime, Size: a.File.Size,
		})
	}
}
