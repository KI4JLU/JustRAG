package owuicompat

import (
	"encoding/json"
	"testing"

	"github.com/justrag/go-backend/internal/chat"
)

// pluginRef mirrors what LfAssistant stores per reference.
type pluginRef struct {
	Nr                     int
	FileID, Title, Page    string
	Content                string
	Author, PublicationDay string
	PublicationYear        int
}

// extractLikePlugin ports OpenWebuiSourceReferencesExtractionStage: flatten
// document[] in order, metadata[i] beside document[i], numbering 1..n.
func extractLikePlugin(t *testing.T, frame []byte) []pluginRef {
	t.Helper()
	var data map[string]any
	if err := json.Unmarshal(frame, &data); err != nil {
		t.Fatal(err)
	}
	var out []pluginRef
	for _, s := range data["sources"].([]any) {
		src := s.(map[string]any)
		docs, _ := src["document"].([]any)
		metas, _ := src["metadata"].([]any)
		for i, d := range docs {
			meta := map[string]any{}
			if i < len(metas) {
				meta, _ = metas[i].(map[string]any)
			}
			str := func(k string) string { v, _ := meta[k].(string); return v }
			title := str("title")
			if title == "" {
				title = str("name")
			}
			page := str("page_label")
			ref := pluginRef{Nr: len(out) + 1, FileID: str("file_id"), Title: title, Page: page, Content: d.(string),
				Author: str("ilias_author"), PublicationDay: str("ilias_publication_date")}
			if y, ok := meta["ilias_publication_year"].(float64); ok {
				ref.PublicationYear = int(y)
			}
			out = append(out, ref)
		}
	}
	return out
}

func TestSourcesFrameOrderAndMissingHandle(t *testing.T) {
	sources := []chat.ChatSource{
		{FileName: "skript.pdf", FileID: "f1", Content: "eins", Score: 0.9, Pages: []int{3, 4}},
		{FileName: "web.md", FileID: "f-ui", Content: "zwei", Score: 0.8},
		{FileName: "skript.pdf", FileID: "f1", Content: "drei", Score: 0.7, Pages: []int{7}},
	}
	handles := map[string]FileHandle{
		"f1": {ID: "h1", Filename: "owui_x_file_81.pdf", Metadata: map[string]any{
			"ilias_title": "Skript", "ilias_author": "Doe", "ilias_publication_date": "2024-01-01", "ilias_publication_year": float64(2024)}},
	}
	frame := buildSourcesFrame("kb1", sources, handles)
	b, err := json.Marshal(frame)
	if err != nil {
		t.Fatal(err)
	}
	refs := extractLikePlugin(t, b)
	if len(refs) != 3 {
		t.Fatalf("refs = %d, want 3", len(refs))
	}
	want := []struct {
		nr                    int
		fileID, content, page string
	}{
		{1, "h1", "eins", "3"}, {2, "", "zwei", ""}, {3, "h1", "drei", "7"},
	}
	for i, w := range want {
		r := refs[i]
		if r.Nr != w.nr || r.FileID != w.fileID || r.Content != w.content || r.Page != w.page {
			t.Errorf("ref %d = %+v, want %+v", i, r, w)
		}
	}
	if refs[0].Author != "Doe" || refs[0].PublicationYear != 2024 || refs[0].Title != "skript.pdf" {
		t.Errorf("ref 1 metadata = %+v", refs[0])
	}
}

func TestSourcesFrameNilWhenEmpty(t *testing.T) {
	if f := buildSourcesFrame("kb1", nil, nil); f != nil {
		t.Fatalf("frame = %+v, want nil", f)
	}
}
