package owuicompat

import (
	"strconv"

	"github.com/justrag/go-backend/internal/chat"
)

type sourceRef struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type sourceEntry struct {
	Source    sourceRef        `json:"source"`
	Document  []string         `json:"document"`
	Metadata  []map[string]any `json:"metadata"`
	Distances []float64        `json:"distances"`
}

type sourcesFrame struct {
	Sources []sourceEntry `json:"sources"`
}

// echoedMetadata are the upload metadata keys the plugin reads back from a
// citation (spec §2.5).
var echoedMetadata = []string{"ilias_author", "ilias_publication_date", "ilias_publication_year"}

// buildSourcesFrame renders the turn's sources as Open WebUI's `sources`
// SSE frame. One entry carries every chunk, in JustRAG's source order, so
// the plugin's flattened numbering 1..n equals the [n] markers the answer
// model writes. metadata.file_id is the upload handle — the plugin's only
// link back to the ILIAS object; a source with no handle (a file added in
// the JustRAG UI) gets "" and is shown without a link.
func buildSourcesFrame(kbID string, sources []chat.ChatSource, handles map[string]FileHandle) *sourcesFrame {
	if len(sources) == 0 {
		return nil
	}
	e := sourceEntry{
		Source:    sourceRef{Type: "collection", ID: kbID},
		Document:  make([]string, 0, len(sources)),
		Metadata:  make([]map[string]any, 0, len(sources)),
		Distances: make([]float64, 0, len(sources)),
	}
	for _, s := range sources {
		meta := map[string]any{"file_id": "", "name": s.FileName, "source": s.FileName}
		if h, ok := handles[s.FileID]; ok {
			meta["file_id"] = h.ID
			for _, k := range echoedMetadata {
				if v, ok := h.Metadata[k]; ok {
					meta[k] = v
				}
			}
		}
		if len(s.Pages) > 0 {
			meta["page"] = s.Pages[0]
			meta["page_label"] = strconv.Itoa(s.Pages[0])
		}
		e.Document = append(e.Document, s.Content)
		e.Metadata = append(e.Metadata, meta)
		e.Distances = append(e.Distances, s.Score)
	}
	return &sourcesFrame{Sources: []sourceEntry{e}}
}
