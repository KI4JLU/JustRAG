package app

import "testing"

// TestFileTabularIsOnKbSourcePreviewChain pins the mount point for the
// spreadsheet source preview: the "Tabellen" file-detail endpoint (the table
// list behind the sheet tabs) and its rows endpoint (the table contents).
// Both are the spreadsheet source preview, the in-KB twin of
// GET /api/files/{id}/preview, so both sit on kbSourcePreviewChain — KB view
// plus the previewSources capability — rather than plain kbViewChain.
// GetFileTabular's own fileBelongsToKB guard still rejects a fileId that
// belongs to a different KB. Reads routes.go's actual registration via the
// routeChains helper in advanced_routes_test.go, so moving either route to a
// different chain in routes.go turns this test red.
func TestFileTabularIsOnKbSourcePreviewChain(t *testing.T) {
	chains := routeChains(t)
	for _, pattern := range []string{
		"GET /api/kb/{id}/files/{fileId}/tabular",
		"GET /api/kb/{id}/files/{fileId}/tabular/rows",
	} {
		got, ok := chains[pattern]
		if !ok {
			t.Fatalf("%s is not registered in routes.go", pattern)
		}
		if got != "kbSourcePreviewChain" {
			t.Errorf("%s is on rc.%s, want rc.kbSourcePreviewChain", pattern, got)
		}
	}
}
