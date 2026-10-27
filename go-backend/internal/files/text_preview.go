package files

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/parser"
	"github.com/justrag/go-backend/internal/safego"
	"github.com/justrag/go-backend/internal/uploadcheck"
)

const (
	// textPreviewTimeout bounds one extraction on the request path.
	textPreviewTimeout = 30 * time.Second
	// textPreviewConcurrency caps concurrent extractions per process; a
	// waiting request gives up with its own context.
	textPreviewConcurrency = 3
	// textPreviewMaxBytes is the largest stored file Text extracts. Office
	// archives past it are far beyond anything a preview can show.
	textPreviewMaxBytes int64 = 100 << 20
)

// textPreviewMaxExpanded bounds what a zip-based document (DOCX, PPTX, ODT,
// EPUB) expands to. The built-in parsers read whole entries into memory, so
// a small archive of huge XML would otherwise reach the web pod's memory;
// archive/zip refuses an entry that inflates past its declared size, so
// checking the declared sizes bounds the real ones. A var so a test can
// lower it.
var textPreviewMaxExpanded uint64 = 256 << 20

// textPreviewParsers are the formats a browser cannot render that the
// built-in parsers turn into text cheaply (zip + XML, or TeX markup): no OCR,
// no speech-to-text, no Docling sidecar, so the request path stays bounded.
// PDFs, spreadsheets, images, audio and plain text are previewed from the
// file itself and are not served here.
var textPreviewParsers = []parser.Parser{
	&parser.DocxParser{},
	&parser.PptxParser{},
	&parser.OdtParser{},
	&parser.EpubParser{},
	&parser.TexParser{},
}

var textPreviewSlots = make(chan struct{}, textPreviewConcurrency)

// textPreviewParser returns the parser Text uses for a stored file, or nil
// when the format is not one it extracts.
func textPreviewParser(mimeType, name string) parser.Parser {
	lower := strings.ToLower(name)
	for _, p := range textPreviewParsers {
		if p.CanParse(mimeType, lower) {
			return p
		}
	}
	return nil
}

// textPreviewResponse is the body of GET /api/files/{id}/text.
type textPreviewResponse struct {
	Text     string `json:"text"`
	Markdown bool   `json:"markdown"`
}

// Text handles GET /api/files/{id}/text: the text a document source's
// preview shows (Word, PowerPoint, ODT, EPUB, TeX), extracted on demand with
// the built-in parsers. Same gate as Download (downloadableFile). It is the
// extraction the built-in parsers produce, not necessarily the ingested text
// (a Docling ingest reads layout the built-in parsers do not). Nothing is
// cached: these formats parse in well under a second.
func (h *Handler) Text(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if auth.UserFromContext(ctx) == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "Authentication required")
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "Invalid file ID")
		return
	}
	file, ok := h.downloadableFile(w, r, id.String())
	if !ok {
		return
	}

	p := textPreviewParser(file.Type, file.Name)
	if p == nil {
		previewError(http.StatusUnsupportedMediaType, uploadcheck.CodeUnsupportedFileType,
			"No text preview for this file type").Write(ctx, w)
		return
	}

	select {
	case textPreviewSlots <- struct{}{}:
	case <-ctx.Done():
		return
	}
	// The built-in parsers do not watch a context, so the extraction runs in
	// its own goroutine and the request answers at the deadline. The slot is
	// held until the extraction really ends, so a run past the deadline still
	// counts against the concurrency cap; its work is bounded by
	// textPreviewMaxBytes and textPreviewMaxExpanded.
	pctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), textPreviewTimeout)
	defer cancel()
	type outcome struct {
		res *parser.ParseResult
		err error
	}
	done := make(chan outcome, 1)
	safego.Go(func() {
		defer func() { <-textPreviewSlots }()
		// A panicking parser (recovered by safego) still answers, as a failure.
		o := outcome{err: errors.New("text preview: extraction aborted")}
		defer func() { done <- o }()
		o.res, o.err = h.extractPreviewText(pctx, p, file)
	})

	var res *parser.ParseResult
	select {
	case o := <-done:
		res, err = o.res, o.err
	case <-pctx.Done():
		err = pctx.Err()
	case <-ctx.Done():
		return
	}
	var tooLarge *uploadcheck.Error
	switch {
	case errors.As(err, &tooLarge):
		tooLarge.Write(ctx, w)
		return
	case errors.Is(pctx.Err(), context.DeadlineExceeded):
		// Also a parse that finished just after the deadline: the answer is the timeout.
		logctx.From(ctx).Warn("files: text preview timed out", "file_id", file.ID, "timeout", textPreviewTimeout)
		previewError(http.StatusUnprocessableEntity, uploadcheck.CodeParseTimeout,
			"Reading the file took too long").Write(ctx, w)
		return
	case err != nil:
		logctx.From(ctx).Warn("files: text preview failed", "file_id", file.ID, "error", err)
		previewError(http.StatusUnprocessableEntity, uploadcheck.CodeFileUnreadable,
			"The file could not be read").Write(ctx, w)
		return
	}

	httputil.WriteJSONCtx(ctx, w, http.StatusOK, textPreviewResponse{
		Text:     previewText(res),
		Markdown: res.IsMarkdown,
	})
}

// previewError is a Text refusal in the shared {"error", "code"} shape the
// web client maps to a localized message (uploadcheck.Code*).
func previewError(status int, code, msg string) *uploadcheck.Error {
	return &uploadcheck.Error{Status: status, Code: code, Message: msg}
}

// extractPreviewText copies the stored blob to a temp file (the parsers read
// a path) and parses it. A blob past textPreviewMaxBytes is a 413
// *uploadcheck.Error.
func (h *Handler) extractPreviewText(ctx context.Context, p parser.Parser, file *FileInfo) (*parser.ParseResult, error) {
	rc, err := h.storage.ReadFileStream(ctx, *file.StoragePath)
	if err != nil {
		return nil, fmt.Errorf("read blob: %w", err)
	}
	defer rc.Close()

	tmp, err := os.CreateTemp("", "preview-*"+filepath.Ext(file.Name))
	if err != nil {
		return nil, fmt.Errorf("create temp file: %w", err)
	}
	defer os.Remove(tmp.Name())
	n, err := io.Copy(tmp, io.LimitReader(rc, textPreviewMaxBytes+1))
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return nil, fmt.Errorf("copy blob: %w", err)
	}
	if n > textPreviewMaxBytes {
		return nil, &uploadcheck.Error{
			Status: http.StatusRequestEntityTooLarge, Code: uploadcheck.CodeFileTooLarge,
			Message: "File too large for a preview", LimitBytes: textPreviewMaxBytes,
		}
	}

	if isZipDocument(p) {
		expanded, err := zipExpandedSize(tmp.Name())
		if err != nil {
			return nil, fmt.Errorf("read archive: %w", err)
		}
		if expanded > textPreviewMaxExpanded {
			return nil, &uploadcheck.Error{
				Status: http.StatusRequestEntityTooLarge, Code: uploadcheck.CodeFileTooLarge,
				Message: "File too large for a preview", LimitBytes: int64(textPreviewMaxExpanded),
			}
		}
	}

	res, err := p.Parse(ctx, parser.ParseContext{
		FilePath: tmp.Name(),
		FileName: file.Name,
		MimeType: file.Type,
		FileSize: n,
	})
	if err != nil {
		return nil, fmt.Errorf("parse %s: %w", p.Name(), err)
	}
	if res == nil {
		return nil, fmt.Errorf("parse %s: no result", p.Name())
	}
	return res, nil
}

// isZipDocument reports whether p reads a zip archive (every preview format but TeX).
func isZipDocument(p parser.Parser) bool {
	_, tex := p.(*parser.TexParser)
	return !tex
}

// zipExpandedSize is the sum of the archive's declared uncompressed sizes.
func zipExpandedSize(path string) (uint64, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return 0, err
	}
	defer zr.Close()
	var total uint64
	for _, f := range zr.File {
		total += f.UncompressedSize64
	}
	return total, nil
}

// previewText is a result's full text; a parser that fills only Pages has
// them joined in order.
func previewText(res *parser.ParseResult) string {
	if res.Text != "" || len(res.Pages) == 0 {
		return res.Text
	}
	parts := make([]string, 0, len(res.Pages))
	for _, pg := range res.Pages {
		parts = append(parts, pg.Text)
	}
	return strings.Join(parts, "\n\n")
}
