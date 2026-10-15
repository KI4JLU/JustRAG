package kb

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/store"
	"github.com/justrag/go-backend/internal/tabular"
)

// GetFileTabular handles GET /api/kb/{id}/files/{fileId}/tabular — the
// "Tabellen" file-detail panel: the persisted spreadsheet ingest report
// (files.parse_report) plus the tabular_catalog projection for the file,
// joined into tabular.FileTabularDTO.
//
// The route sits on kbViewChain, which only proves the caller holds `view`
// on {id} — not that {fileId} belongs to that KB. fileBelongsToKB is the
// guard: a file that exists but belongs to a different KB 404s exactly like
// an unknown file id, so this endpoint cannot be used to probe another KB's
// tabular data by fileId alone. A non-spreadsheet file (no parse_report, no
// catalog rows) is a normal 200 with `{"report":null,"tables":[]}`, not a
// 404 — the panel needs to render an empty state for it, not an error page.
func (h *Handler) GetFileTabular(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusUnauthorized, "authentication required")
		return
	}

	kbID := r.PathValue("id")
	fileID := r.PathValue("fileId")
	if kbID == "" || fileID == "" {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, "missing id")
		return
	}

	belongs, err := h.fileBelongsToKB(r.Context(), kbID, fileID)
	if err != nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusInternalServerError, "failed to look up file")
		return
	}
	if !belongs {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusNotFound, "file not found")
		return
	}

	reportJSON, err := h.store.GetFileParseReport(r.Context(), fileID)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusInternalServerError, "failed to load parse report")
		return
	}

	var report *tabular.ParseReport
	if len(reportJSON) > 0 {
		report = &tabular.ParseReport{}
		if err := json.Unmarshal(reportJSON, report); err != nil {
			httputil.WriteErrorCtx(r.Context(), w, http.StatusInternalServerError, "failed to decode parse report")
			return
		}
	}

	entries, err := h.store.ListTabularCatalogByFile(r.Context(), fileID)
	if err != nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusInternalServerError, "failed to load tabular catalog")
		return
	}

	httputil.WriteJSONCtx(r.Context(), w, http.StatusOK, tabular.BuildFileTabularDTO(report, entries))
}

// fileBelongsToKB reports whether fileID exists and is owned by kbID.
func (h *Handler) fileBelongsToKB(ctx context.Context, kbID, fileID string) (bool, error) {
	file, err := h.store.GetFileByID(ctx, fileID)
	if err != nil {
		return false, err
	}
	if file == nil {
		return false, nil
	}
	return file.KbID == kbID, nil
}

// Preview bounds for GetFileTabularRows.
const (
	previewDefaultLimit = 100
	previewMaxLimit     = 500
	previewMaxSearch    = 200 // runes
)

// TabularRowDTO is one row of the preview: its _rowid (the ingest order, not
// the Excel row — empty and derived rows are skipped at ingest), whether it
// is an empty template row, and each cell's SQL text (null for NULL).
type TabularRowDTO struct {
	ID    int64     `json:"id"`
	Empty bool      `json:"empty"`
	Cells []*string `json:"cells"`
}

// TabularRowsDTO is one page of a materialized spreadsheet table for the
// source preview. matched counts the rows passing search and the empty-row
// filter; empty_rows and empty_columns are whole-table stats, sent with the
// first page (offset 0) only.
type TabularRowsDTO struct {
	TableName    string          `json:"table_name"`
	SheetName    string          `json:"sheet_name"`
	Columns      []string        `json:"columns"`
	Rows         []TabularRowDTO `json:"rows"`
	RowCount     int64           `json:"row_count"`
	Matched      int64           `json:"matched"`
	EmptyRows    *int64          `json:"empty_rows,omitempty"`
	EmptyColumns []string        `json:"empty_columns,omitempty"`
	Offset       int             `json:"offset"`
	Limit        int             `json:"limit"`
}

// GetFileTabularRows handles GET /api/kb/{id}/files/{fileId}/tabular/rows —
// one page of a file's materialized table for the source preview:
//
//	table       one of the file's tabular_catalog table names (else 404)
//	offset      ≥ 0, default 0
//	limit       1–500, default 100
//	q           search, ≤ 200 runes, case-insensitive substring over all columns
//	sort        a catalog column name (else 400); dir = asc (default) | desc
//	show_empty  true includes empty template rows (default: filtered out)
//
// Same kbViewChain and fileBelongsToKB guard as GetFileTabular. Search, sort
// and the empty-row filter run in SQL (tabular.Catalog.PreviewRows), so the
// preview behaves the same at any table size.
func (h *Handler) GetFileTabularRows(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if auth.UserFromContext(ctx) == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}

	kbUUID, kbErr := uuid.Parse(r.PathValue("id"))
	fileUUID, fileErr := uuid.Parse(r.PathValue("fileId"))
	if kbErr != nil || fileErr != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "invalid id")
		return
	}
	kbID, fileID := kbUUID.String(), fileUUID.String()

	q := r.URL.Query()
	table := q.Get("table")
	if table == "" {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "missing table")
		return
	}
	pq := tabular.PreviewQuery{Search: strings.TrimSpace(q.Get("q")), SortColumn: q.Get("sort")}
	var ok bool
	if pq.Offset, ok = queryInt(q.Get("offset"), 0, 0, -1); !ok {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "invalid offset")
		return
	}
	if pq.Limit, ok = queryInt(q.Get("limit"), previewDefaultLimit, 1, previewMaxLimit); !ok {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "invalid limit")
		return
	}
	if utf8.RuneCountInString(pq.Search) > previewMaxSearch {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "search too long")
		return
	}
	switch q.Get("dir") {
	case "", "asc":
	case "desc":
		pq.SortDesc = true
	default:
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "invalid dir")
		return
	}
	switch q.Get("show_empty") {
	case "", "false":
	case "true":
		pq.ShowEmpty = true
	default:
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "invalid show_empty")
		return
	}
	pq.WithStats = pq.Offset == 0

	belongs, err := h.fileBelongsToKB(ctx, kbID, fileID)
	if err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusInternalServerError, "failed to look up file")
		return
	}
	if !belongs {
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "file not found")
		return
	}

	entries, err := h.store.ListTabularCatalogByFile(ctx, fileID)
	if err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusInternalServerError, "failed to load tabular catalog")
		return
	}
	var entry *tabular.CatalogEntry
	for i := range entries {
		if entries[i].TableName == table {
			entry = &entries[i]
			break
		}
	}
	if entry == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "table not found")
		return
	}
	if pq.SortColumn != "" && !slices.ContainsFunc(entry.Columns, func(c tabular.ColumnSpec) bool { return c.Name == pq.SortColumn }) {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "invalid sort column")
		return
	}

	page, err := h.store.PreviewTabularRows(ctx, *entry, pq)
	if err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusInternalServerError, "failed to read table")
		return
	}
	rows := make([]TabularRowDTO, len(page.Rows))
	for i, row := range page.Rows {
		rows[i] = TabularRowDTO{ID: row.ID, Empty: row.Empty, Cells: row.Cells}
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, TabularRowsDTO{
		TableName:    entry.TableName,
		SheetName:    entry.SheetName,
		Columns:      page.Columns,
		Rows:         rows,
		RowCount:     entry.RowCount,
		Matched:      page.Matched,
		EmptyRows:    page.EmptyRows,
		EmptyColumns: page.EmptyColumns,
		Offset:       pq.Offset,
		Limit:        pq.Limit,
	})
}

// queryInt parses an optional non-negative query integer: empty → def; it
// must lie in [lo, hi] (hi < 0 = unbounded).
func queryInt(raw string, def, lo, hi int) (int, bool) {
	if raw == "" {
		return def, true
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < lo || (hi >= 0 && n > hi) {
		return 0, false
	}
	return n, true
}
