package docling

// Structure extraction: the goldset `structure` field.
//
// Shapes are docling-core's, not invented, from a live docling-serve
// response (v1.10.0 document):
//   - headings are texts with label "title" (level 1) or "section_header"
//     (level = the rendered hierarchy: raw level n renders as n+1 hashes,
//     capped at 6, as in docling-core's _format_heading and fp-model's
//     render.rs; a title is always level 1),
//   - lists are groups with label "list" or "ordered_list"; nesting is
//     expressed by nested groups, not by the item's level; a numbered
//     DOCX list arrives as a "list" group whose items carry enumerated
//     true and their real markers ("1.", "2."), a nested bullet level
//     arrives as a nested "list" group with empty markers,
//   - table cells carry row_span/col_span next to their top-left offsets.

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/parser"
)

// structHeadingsDoc: a title (no level), a level-2 section header, plain
// text, and a section header without a level.
const structHeadingsDoc = `{
  "schema_name": "DoclingDocument",
  "body": {"self_ref": "#/body", "children": [
    {"$ref": "#/texts/0"},
    {"$ref": "#/texts/1"},
    {"$ref": "#/texts/2"},
    {"$ref": "#/texts/3"}
  ]},
  "texts": [
    {"self_ref": "#/texts/0", "label": "title", "content_layer": "body",
     "text": "Mein Titel", "prov": [{"page_no": 1}]},
    {"self_ref": "#/texts/1", "label": "section_header", "level": 2,
     "content_layer": "body", "text": "Unterabschnitt", "prov": [{"page_no": 1}]},
    {"self_ref": "#/texts/2", "label": "text", "content_layer": "body",
     "text": "Fliesstext.", "prov": [{"page_no": 1}]},
    {"self_ref": "#/texts/3", "label": "section_header", "content_layer": "body",
     "text": "Abschnitt ohne Level", "prov": [{"page_no": 1}]}
  ]
}`

// structNestedListDoc: one list group; the third child is a nested list
// group with two items of its own (docling's shape for nested bullets).
const structNestedListDoc = `{
  "schema_name": "DoclingDocument",
  "body": {"self_ref": "#/body", "children": [
    {"$ref": "#/groups/0"},
    {"$ref": "#/texts/5"}
  ]},
  "groups": [
    {"self_ref": "#/groups/0", "label": "list", "content_layer": "body", "children": [
      {"$ref": "#/texts/0"},
      {"$ref": "#/texts/1"},
      {"$ref": "#/groups/1"},
      {"$ref": "#/texts/2"}
    ]},
    {"self_ref": "#/groups/1", "label": "list", "content_layer": "body", "children": [
      {"$ref": "#/texts/3"},
      {"$ref": "#/texts/4"}
    ]}
  ],
  "texts": [
    {"self_ref": "#/texts/0", "label": "list_item", "content_layer": "body",
     "text": "Erster Punkt", "marker": "", "enumerated": false, "prov": []},
    {"self_ref": "#/texts/1", "label": "list_item", "content_layer": "body",
     "text": "Zweiter Punkt", "marker": "", "enumerated": false, "prov": []},
    {"self_ref": "#/texts/2", "label": "list_item", "content_layer": "body",
     "text": "Dritter Punkt", "marker": "", "enumerated": false, "prov": []},
    {"self_ref": "#/texts/3", "label": "list_item", "content_layer": "body",
     "text": "Unterpunkt A", "marker": "", "enumerated": false, "prov": []},
    {"self_ref": "#/texts/4", "label": "list_item", "content_layer": "body",
     "text": "Unterpunkt B", "marker": "", "enumerated": false, "prov": []},
    {"self_ref": "#/texts/5", "label": "text", "content_layer": "body",
     "text": "Danach.", "prov": []}
  ]
}`

// structOrderedDoc: a numbered list as docling-serve 1.10.0 delivers it for
// a DOCX with Word numbering — group label "list", items enumerated with
// their real markers.
const structOrderedDoc = `{
  "schema_name": "DoclingDocument",
  "body": {"self_ref": "#/body", "children": [{"$ref": "#/groups/0"}]},
  "groups": [
    {"self_ref": "#/groups/0", "label": "list", "content_layer": "body", "children": [
      {"$ref": "#/texts/0"},
      {"$ref": "#/texts/1"},
      {"$ref": "#/texts/2"}
    ]}
  ],
  "texts": [
    {"self_ref": "#/texts/0", "label": "list_item", "content_layer": "body",
     "text": "Alpha", "marker": "1.", "enumerated": true, "prov": []},
    {"self_ref": "#/texts/1", "label": "list_item", "content_layer": "body",
     "text": "Beta", "marker": "2.", "enumerated": true, "prov": []},
    {"self_ref": "#/texts/2", "label": "list_item", "content_layer": "body",
     "text": "Gamma", "marker": "3.", "enumerated": true, "prov": []}
  ]
}`

// structSynthesizedDoc: an "ordered_list" group whose items carry no
// markers — the markers must be synthesized from each item's position
// among the group's direct children (docling-core renders "1.", "2." …).
const structSynthesizedDoc = `{
  "schema_name": "DoclingDocument",
  "body": {"self_ref": "#/body", "children": [{"$ref": "#/groups/0"}]},
  "groups": [
    {"self_ref": "#/groups/0", "label": "ordered_list", "content_layer": "body", "children": [
      {"$ref": "#/texts/0"},
      {"$ref": "#/groups/1"},
      {"$ref": "#/texts/1"}
    ]},
    {"self_ref": "#/groups/1", "label": "list", "content_layer": "body", "children": [
      {"$ref": "#/texts/2"}
    ]}
  ],
  "texts": [
    {"self_ref": "#/texts/0", "label": "list_item", "content_layer": "body",
     "text": "Eins", "marker": "", "enumerated": false, "prov": []},
    {"self_ref": "#/texts/1", "label": "list_item", "content_layer": "body",
     "text": "Drei", "marker": "", "enumerated": false, "prov": []},
    {"self_ref": "#/texts/2", "label": "list_item", "content_layer": "body",
     "text": "Nest", "marker": "", "enumerated": false, "prov": []}
  ]
}`

// structTableDoc: a 2x3 grid with a two-column span, one empty cell, and
// cells that omit row_span/col_span (must default to 1).
const structTableDoc = `{
  "schema_name": "DoclingDocument",
  "body": {"self_ref": "#/body", "children": [{"$ref": "#/tables/0"}]},
  "tables": [
    {"self_ref": "#/tables/0", "label": "table", "content_layer": "body",
     "prov": [{"page_no": 1}],
     "data": {
       "num_rows": 2, "num_cols": 3,
       "table_cells": [
         {"text": "Querspalte", "start_row_offset_idx": 0, "start_col_offset_idx": 0,
          "row_span": 1, "col_span": 2},
         {"text": "B", "start_row_offset_idx": 0, "start_col_offset_idx": 2},
         {"text": "", "start_row_offset_idx": 1, "start_col_offset_idx": 0},
         {"text": "C", "start_row_offset_idx": 1, "start_col_offset_idx": 1,
          "row_span": 1, "col_span": 1},
         {"text": "", "start_row_offset_idx": 1, "start_col_offset_idx": 2}
       ]
     }}
  ]
}`

// structFurnitureDoc: a heading and a list group on the furniture layer
// (running headers) — neither may reach the structure.
const structFurnitureDoc = `{
  "schema_name": "DoclingDocument",
  "body": {"self_ref": "#/body", "children": [
    {"$ref": "#/texts/0"},
    {"$ref": "#/groups/0"}
  ]},
  "groups": [
    {"self_ref": "#/groups/0", "label": "list", "content_layer": "furniture", "children": [
      {"$ref": "#/texts/1"}
    ]}
  ],
  "texts": [
    {"self_ref": "#/texts/0", "label": "section_header", "content_layer": "furniture",
     "text": "Laufkopf", "prov": [{"page_no": 1}]},
    {"self_ref": "#/texts/1", "label": "list_item", "content_layer": "furniture",
     "text": "Seitenzahl", "marker": "", "enumerated": false, "prov": [{"page_no": 1}]}
  ]
}`

// structPlainDoc: body text only — the structure is present but empty.
const structPlainDoc = `{
  "schema_name": "DoclingDocument",
  "body": {"self_ref": "#/body", "children": [{"$ref": "#/texts/0"}]},
  "texts": [
    {"self_ref": "#/texts/0", "label": "text", "content_layer": "body",
     "text": "Nur Fliesstext.", "prov": [{"page_no": 1}]}
  ]
}`

func TestStructureFromJSONContent(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		want    *parser.Structure
		wantNil bool
	}{
		{
			name: "headings in reading order with levels",
			raw:  structHeadingsDoc,
			want: &parser.Structure{
				Headings: []parser.StructHeading{
					{Text: "Mein Titel", Level: 1},
					{Text: "Unterabschnitt", Level: 3},
					{Text: "Abschnitt ohne Level", Level: 1},
				},
				Lists:  []parser.StructList{},
				Tables: []parser.StructTable{},
			},
		},
		{
			name: "nested list groups flatten with nesting level",
			raw:  structNestedListDoc,
			want: &parser.Structure{
				Headings: []parser.StructHeading{},
				Lists: []parser.StructList{{
					Ordered: false,
					Items: []parser.StructListItem{
						{Marker: "-", Text: "Erster Punkt", Level: 0},
						{Marker: "-", Text: "Zweiter Punkt", Level: 0},
						{Marker: "-", Text: "Unterpunkt A", Level: 1},
						{Marker: "-", Text: "Unterpunkt B", Level: 1},
						{Marker: "-", Text: "Dritter Punkt", Level: 0},
					},
				}},
				Tables: []parser.StructTable{},
			},
		},
		{
			name: "enumerated items keep their markers and the list is ordered",
			raw:  structOrderedDoc,
			want: &parser.Structure{
				Headings: []parser.StructHeading{},
				Lists: []parser.StructList{{
					Ordered: true,
					Items: []parser.StructListItem{
						{Marker: "1.", Text: "Alpha", Level: 0},
						{Marker: "2.", Text: "Beta", Level: 0},
						{Marker: "3.", Text: "Gamma", Level: 0},
					},
				}},
				Tables: []parser.StructTable{},
			},
		},
		{
			name: "ordered_list label without markers synthesizes numbering",
			raw:  structSynthesizedDoc,
			want: &parser.Structure{
				Headings: []parser.StructHeading{},
				Lists: []parser.StructList{{
					Ordered: true,
					Items: []parser.StructListItem{
						{Marker: "1.", Text: "Eins", Level: 0},
						{Marker: "-", Text: "Nest", Level: 1},
						// slot 3: the nested group occupied slot 2
						{Marker: "3.", Text: "Drei", Level: 0},
					},
				}},
				Tables: []parser.StructTable{},
			},
		},
		{
			name: "table cells keep spans and empty cells",
			raw:  structTableDoc,
			want: &parser.Structure{
				Headings: []parser.StructHeading{},
				Lists:    []parser.StructList{},
				Tables: []parser.StructTable{{
					NumRows: 2,
					NumCols: 3,
					Cells: []parser.StructCell{
						{Row: 0, Col: 0, RowSpan: 1, ColSpan: 2, Text: "Querspalte"},
						{Row: 0, Col: 2, RowSpan: 1, ColSpan: 1, Text: "B"},
						{Row: 1, Col: 0, RowSpan: 1, ColSpan: 1, Text: ""},
						{Row: 1, Col: 1, RowSpan: 1, ColSpan: 1, Text: "C"},
						{Row: 1, Col: 2, RowSpan: 1, ColSpan: 1, Text: ""},
					},
				}},
			},
		},
		{
			name:    "furniture layer is excluded",
			raw:     structFurnitureDoc,
			want:    &parser.Structure{Headings: []parser.StructHeading{}, Lists: []parser.StructList{}, Tables: []parser.StructTable{}},
			wantNil: false,
		},
		{
			name: "plain document yields an empty structure",
			raw:  structPlainDoc,
			want: &parser.Structure{Headings: []parser.StructHeading{}, Lists: []parser.StructList{}, Tables: []parser.StructTable{}},
		},
		{name: "absent json_content is nil", raw: "", wantNil: true},
		{name: "unparseable json_content is nil", raw: `{oops`, wantNil: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := structureFromJSONContent(json.RawMessage(tc.raw))
			if tc.wantNil {
				if got != nil {
					t.Fatalf("want nil, got %+v", got)
				}
				return
			}
			if got == nil {
				t.Fatalf("want %+v, got nil", tc.want)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("structure differs:\n got  %+v\n want %+v", got, tc.want)
			}
		})
	}
}

// The walk must keep emitting the same page items as before the structure
// was added: the nested-list doc above has no page numbers at all, so
// items stay nil there, while the headings doc (page 1) must still yield
// its four texts.
func TestWalkKeepsItemBehavior(t *testing.T) {
	if items := itemsFromJSONContent([]byte(structHeadingsDoc)); len(items) != 4 {
		t.Fatalf("want 4 items, got %d: %+v", len(items), items)
	}
	if items := itemsFromJSONContent([]byte(structNestedListDoc)); items != nil {
		t.Fatalf("unpaginated doc must yield nil items, got %+v", items)
	}
}

func TestClient_Convert_StructureIsPopulated(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"document": map[string]any{
				"md_content":   "# Mein Titel\n",
				"json_content": json.RawMessage(structHeadingsDoc),
			},
		})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, 10*time.Second)
	res, err := c.Convert(context.Background(), "x.pdf", strings.NewReader("x"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := &parser.Structure{
		Headings: []parser.StructHeading{
			{Text: "Mein Titel", Level: 1},
			{Text: "Unterabschnitt", Level: 3},
			{Text: "Abschnitt ohne Level", Level: 1},
		},
		Lists:  []parser.StructList{},
		Tables: []parser.StructTable{},
	}
	if !reflect.DeepEqual(res.Structure, want) {
		t.Fatalf("structure mismatch:\n got  %+v\n want %+v", res.Structure, want)
	}
}

// A response without json_content carries no structure, like it carries no
// items.
func TestClient_Convert_NoJSONContentMeansNoStructure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"document": map[string]any{
				"md_content":   "nur Text\n",
				"text_content": "nur Text\n",
			},
		})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, 10*time.Second)
	res, err := c.Convert(context.Background(), "x.pdf", strings.NewReader("x"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Structure != nil {
		t.Fatalf("want nil structure without json_content, got %+v", res.Structure)
	}
}

// ConvertAndMap must carry the structure onto the ParseResult, so the
// factory chain (and with it the goldset parsedump) can reach it.
func TestConvertAndMap_StructureIsCarriedOnParseResult(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"document": map[string]any{
				"md_content":   "# Mein Titel\n\nFliesstext.\n",
				"json_content": json.RawMessage(structHeadingsDoc),
			},
		})
	}))
	defer srv.Close()

	path := filepath.Join(t.TempDir(), "x.docx")
	if err := os.WriteFile(path, []byte("stub"), 0o600); err != nil {
		t.Fatal(err)
	}
	c := NewClient(srv.URL, 10*time.Second)
	res, err := ConvertAndMap(context.Background(), c, parser.ParseContext{
		FilePath: path,
		FileName: "x.docx",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Structure == nil || len(res.Structure.Headings) != 3 {
		t.Fatalf("want 3 headings on the ParseResult, got %+v", res.Structure)
	}
}
