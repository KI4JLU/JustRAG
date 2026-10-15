package kb_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/kb"
	"github.com/justrag/go-backend/internal/tabular"
)

func newTabularRequest(kbID, fileID string) *http.Request {
	req := withUser(httptest.NewRequest(http.MethodGet, "/api/kb/"+kbID+"/files/"+fileID+"/tabular", nil), testUser())
	req.SetPathValue("id", kbID)
	req.SetPathValue("fileId", fileID)
	return req
}

// TestGetFileTabular_OK pins the happy path: a file that belongs to the KB
// in the route, with a parse report and one catalog entry.
func TestGetFileTabular_OK(t *testing.T) {
	store := &mockStore{
		fileRef:     &kb.FileRef{ID: "file-1", KbID: "kb-1"},
		parseReport: json.RawMessage(`{"version":1,"materialised":true,"sheets":[{"name":"Sheet1"}]}`),
		catalogEntries: []tabular.CatalogEntry{
			{FileID: "file-1", SheetName: "Sheet1", TableName: "sheet_aa_0_0", SheetIndex: 0, RegionIndex: 0, HeaderRow: 0,
				Columns: []tabular.ColumnSpec{{Original: "A", Name: "a", Type: tabular.TypeText}}},
		},
	}
	h := kb.NewHandler(store)

	req := newTabularRequest("kb-1", "file-1")
	rr := httptest.NewRecorder()
	h.GetFileTabular(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if store.gotFileID != "file-1" {
		t.Errorf("store called with fileID %q, want %q", store.gotFileID, "file-1")
	}

	var got tabular.FileTabularDTO
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Report == nil || got.Report.Version != 1 {
		t.Errorf("expected report to decode, got %+v", got.Report)
	}
	if len(got.Tables) != 1 || got.Tables[0].TableName != "sheet_aa_0_0" {
		t.Errorf("expected 1 table sheet_aa_0_0, got %+v", got.Tables)
	}
}

// TestGetFileTabular_ForeignFile pins the cross-KB guard: a file that exists
// but belongs to a different KB than {id} in the route must 404, not 200 or
// 403 — kbViewChain already proved the caller holds view on {id}, so leaking
// existence of a file in another KB would be the bug.
func TestGetFileTabular_ForeignFile(t *testing.T) {
	store := &mockStore{
		fileRef: &kb.FileRef{ID: "file-1", KbID: "kb-OTHER"},
	}
	h := kb.NewHandler(store)

	req := newTabularRequest("kb-1", "file-1")
	rr := httptest.NewRecorder()
	h.GetFileTabular(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for a file owned by a different KB, got %d", rr.Code)
	}
}

// TestGetFileTabular_UnknownFile pins the plain not-found case: no file row
// at all also 404s, indistinguishable from the foreign-file case (both must
// look identical from the outside).
func TestGetFileTabular_UnknownFile(t *testing.T) {
	store := &mockStore{fileRef: nil}
	h := kb.NewHandler(store)

	req := newTabularRequest("kb-1", "missing-file")
	rr := httptest.NewRecorder()
	h.GetFileTabular(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for an unknown file id, got %d", rr.Code)
	}
}

// TestGetFileTabular_NonSpreadsheetFile pins the empty-state contract: a
// file with no parse_report and no catalog rows (a PDF, say) is a normal 200
// with report:null and an empty tables array, not an error.
func TestGetFileTabular_NonSpreadsheetFile(t *testing.T) {
	store := &mockStore{
		fileRef:        &kb.FileRef{ID: "file-2", KbID: "kb-1"},
		parseReport:    nil,
		catalogEntries: nil,
	}
	h := kb.NewHandler(store)

	req := newTabularRequest("kb-1", "file-2")
	rr := httptest.NewRecorder()
	h.GetFileTabular(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, `"report":null`) || !strings.Contains(body, `"tables":[]`) {
		t.Fatalf("expected report:null and an empty tables array, got %s", body)
	}
}

const (
	rowsKB   = "11111111-1111-1111-1111-111111111111"
	rowsFile = "22222222-2222-2222-2222-222222222222"
)

func newRowsRequest(kbID, fileID, query string) *http.Request {
	req := withUser(httptest.NewRequest(http.MethodGet, "/api/kb/"+kbID+"/files/"+fileID+"/tabular/rows?"+query, nil), testUser())
	req.SetPathValue("id", kbID)
	req.SetPathValue("fileId", fileID)
	return req
}

func rowsStore() *mockStore {
	return &mockStore{
		fileRef: &kb.FileRef{ID: rowsFile, KbID: rowsKB},
		catalogEntries: []tabular.CatalogEntry{
			{FileID: rowsFile, SheetName: "Info", TableName: "sheet_aa_0_0", RowCount: 2},
			{FileID: rowsFile, SheetName: "Daten", TableName: "sheet_aa_1_0", RowCount: 6,
				Columns: []tabular.ColumnSpec{{Original: "Name", Name: "name", Type: tabular.TypeText}}},
		},
	}
}

func strp(s string) *string { return &s }

// Oracle: the route contract in GetFileTabularRows' docblock — the named
// table is resolved among the file's own catalog entries, the parsed query is
// handed to the store, and stats are asked for on the first page only.
func TestGetFileTabularRows_OK(t *testing.T) {
	store := rowsStore()
	empty := int64(3)
	store.previewPage = &tabular.PreviewPage{
		Columns: []string{"name"},
		Rows:    []tabular.PreviewRow{{ID: 7, Cells: []*string{strp("a")}}, {ID: 9, Empty: true, Cells: []*string{nil}}},
		Matched: 2, EmptyRows: &empty, EmptyColumns: []string{},
	}
	rr := httptest.NewRecorder()
	kb.NewHandler(store).GetFileTabularRows(rr, newRowsRequest(rowsKB, rowsFile,
		"table=sheet_aa_1_0&offset=0&limit=50&q=%20Klinik%20&sort=name&dir=desc&show_empty=true"))

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	want := tabular.PreviewQuery{Offset: 0, Limit: 50, Search: "Klinik", SortColumn: "name", SortDesc: true, ShowEmpty: true, WithStats: true}
	if store.gotPreviewEntry.TableName != "sheet_aa_1_0" || store.gotPreviewQuery != want {
		t.Errorf("store got %q %+v, want %+v", store.gotPreviewEntry.TableName, store.gotPreviewQuery, want)
	}
	var got kb.TabularRowsDTO
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.SheetName != "Daten" || got.RowCount != 6 || got.Matched != 2 || got.EmptyRows == nil || *got.EmptyRows != 3 {
		t.Errorf("unexpected body %+v", got)
	}
	if len(got.Rows) != 2 || got.Rows[0].ID != 7 || *got.Rows[0].Cells[0] != "a" || !got.Rows[1].Empty || got.Rows[1].Cells[0] != nil {
		t.Errorf("unexpected rows %+v", got.Rows)
	}
}

func TestGetFileTabularRows_Defaults(t *testing.T) {
	store := rowsStore()
	store.previewPage = &tabular.PreviewPage{}
	rr := httptest.NewRecorder()
	kb.NewHandler(store).GetFileTabularRows(rr, newRowsRequest(rowsKB, rowsFile, "table=sheet_aa_0_0"))
	want := tabular.PreviewQuery{Limit: 100, WithStats: true}
	if rr.Code != http.StatusOK || store.gotPreviewQuery != want {
		t.Errorf("code %d query %+v, want 200 / %+v", rr.Code, store.gotPreviewQuery, want)
	}
}

// Stats are a full-table aggregate: a later page must not recompute them.
func TestGetFileTabularRows_NoStatsPastFirstPage(t *testing.T) {
	store := rowsStore()
	store.previewPage = &tabular.PreviewPage{}
	rr := httptest.NewRecorder()
	kb.NewHandler(store).GetFileTabularRows(rr, newRowsRequest(rowsKB, rowsFile, "table=sheet_aa_0_0&offset=100"))
	if rr.Code != http.StatusOK || store.gotPreviewQuery.WithStats {
		t.Errorf("code %d, WithStats %v; want 200 and false", rr.Code, store.gotPreviewQuery.WithStats)
	}
}

// A table name outside the file's catalog never reaches the store: 404.
func TestGetFileTabularRows_UnknownTable(t *testing.T) {
	store := rowsStore()
	rr := httptest.NewRecorder()
	kb.NewHandler(store).GetFileTabularRows(rr, newRowsRequest(rowsKB, rowsFile, "table=users"))
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
	if store.gotPreviewEntry.TableName != "" {
		t.Errorf("store was called for %q", store.gotPreviewEntry.TableName)
	}
}

// Cross-KB guard, as for GetFileTabular: a file of another KB is a 404.
func TestGetFileTabularRows_ForeignFile(t *testing.T) {
	store := rowsStore()
	store.fileRef = &kb.FileRef{ID: rowsFile, KbID: "33333333-3333-3333-3333-333333333333"}
	rr := httptest.NewRecorder()
	kb.NewHandler(store).GetFileTabularRows(rr, newRowsRequest(rowsKB, rowsFile, "table=sheet_aa_0_0"))
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}

func TestGetFileTabularRows_BadRequests(t *testing.T) {
	cases := map[string]struct{ kbID, query string }{
		"missing table":   {rowsKB, ""},
		"limit too high":  {rowsKB, "table=sheet_aa_0_0&limit=501"},
		"limit zero":      {rowsKB, "table=sheet_aa_0_0&limit=0"},
		"negative offset": {rowsKB, "table=sheet_aa_0_0&offset=-1"},
		"non-numeric":     {rowsKB, "table=sheet_aa_0_0&offset=x"},
		"kb id not uuid":  {"kb-1", "table=sheet_aa_0_0"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			kb.NewHandler(rowsStore()).GetFileTabularRows(rr, newRowsRequest(tc.kbID, rowsFile, tc.query))
			if rr.Code != http.StatusBadRequest {
				t.Errorf("expected 400, got %d", rr.Code)
			}
		})
	}
}
