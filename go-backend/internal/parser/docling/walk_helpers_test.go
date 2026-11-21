package docling

import (
	"encoding/json"

	"github.com/justrag/go-backend/internal/parser"
)

// The two helpers below run the json_content walk the way Parse does, split
// into its item and structure halves so tests can check each in isolation.

// itemsFromJSONContent walks the DoclingDocument body in reading order and
// returns its text and table items with page provenance. Returns nil when
// json_content is absent, unparseable, or carries no page numbers at all
// (e.g. unpaginated formats) — the caller then treats pages as unknown.
func itemsFromJSONContent(rawJSON json.RawMessage) []DocItem {
	w := walkDoclingDocument(rawJSON, false)
	if w == nil {
		return nil
	}
	return itemsWithProvenance(w.items)
}

// structureFromJSONContent extracts the structured subset (headings, list
// groups, table grids) from json_content. Returns nil when json_content is
// absent or unparseable; a parsed document with no such content yields an
// empty, non-nil Structure.
func structureFromJSONContent(rawJSON json.RawMessage) *parser.Structure {
	w := walkDoclingDocument(rawJSON, true)
	if w == nil {
		return nil
	}
	return w.structure
}
