package app

import "testing"

// TestFileTabularIsOnKbSourceDownloadChain pins the mount point for the
// spreadsheet source preview: the "Tabellen" file-detail endpoint (the table
// list behind the sheet tabs) and its rows endpoint (the table contents).
// Both show source content the way GET /api/files/{id}/download does, so
// both sit on kbSourceDownloadChain — KB view plus the downloadSources
// capability (viewer_download_sources) — rather than plain kbViewChain.
// GetFileTabular's own fileBelongsToKB guard still rejects a fileId that
// belongs to a different KB. Reads routes.go's actual registration via the
// routeChains helper in advanced_routes_test.go, so moving either route to a
// different chain in routes.go turns this test red.
func TestFileTabularIsOnKbSourceDownloadChain(t *testing.T) {
	chains := routeChains(t)
	for _, pattern := range []string{
		"GET /api/kb/{id}/files/{fileId}/tabular",
		"GET /api/kb/{id}/files/{fileId}/tabular/rows",
	} {
		got, ok := chains[pattern]
		if !ok {
			t.Fatalf("%s is not registered in routes.go", pattern)
		}
		if got != "kbSourceDownloadChain" {
			t.Errorf("%s is on rc.%s, want rc.kbSourceDownloadChain", pattern, got)
		}
	}
}
