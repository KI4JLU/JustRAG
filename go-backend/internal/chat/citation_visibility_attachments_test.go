package chat

import (
	"encoding/json"
	"strings"
	"testing"
)

// Oracle: the rule of the attachment exception — kept numbers stay, others
// go, a mixed marker keeps only its kept numbers.
func TestStripCitationMarkersExcept(t *testing.T) {
	keep := map[int]bool{5: true, 6: true}
	cases := map[string]string{
		"KB [1] and doc [5].":     "KB and doc [5].",
		"Both [1, 5].":            "Both [5].",
		"Docs [5, 6].":            "Docs [5, 6].",
		"Only KB [1, 2] here.":    "Only KB here.",
		"No marker [0] and text.": "No marker [0] and text.",
	}
	for in, want := range cases {
		if got := stripCitationMarkersExcept(in, keep); got != want {
			t.Errorf("%q → %q, want %q", in, got, want)
		}
	}
	if got := StripCitationMarkers("doc [5]."); got != "doc." {
		t.Errorf("StripCitationMarkers keeps nothing: got %q", got)
	}
}

// Oracle: a reader without seeCitations keeps the sources frame entries of
// their own attachments (userFileId) and their markers in the streamed
// answer, also when a marker is split across chunks; KB entries and markers
// go.
func TestCitationFilter_KeepsOwnAttachments(t *testing.T) {
	f := NewCitationFilter()
	opening := f.Frames(map[string]any{
		"sources": []ChatSource{
			{Index: 1, FileName: "kb.pdf", FileID: "f1", Content: "kb"},
			{Index: 2, FileName: "mine.pdf", UserFileID: "u1", Content: "doc"},
		},
		"chatId": "c",
	})
	src := opening[0].(map[string]any)["sources"].([]ChatSource)
	if len(src) != 1 || src[0].UserFileID != "u1" {
		t.Fatalf("sources frame %+v, want only the attachment", src)
	}
	var text strings.Builder
	for _, chunk := range []string{"KB says [1", "] and my doc [", "2]; both [1, 2]."} {
		for _, fr := range f.Frames(map[string]string{"content": chunk}) {
			text.WriteString(fr.(map[string]string)["content"])
		}
	}
	for _, fr := range f.Flush() {
		text.WriteString(fr.(map[string]string)["content"])
	}
	if got, want := text.String(), "KB says and my doc [2]; both [2]."; got != want {
		t.Fatalf("streamed %q, want %q", got, want)
	}
}

// Oracle: the non-streaming body follows the same rule, verification
// entries included.
func TestCitationFilter_PayloadKeepsOwnAttachments(t *testing.T) {
	out := NewCitationFilter().Payload(map[string]any{
		"answer":       "a [1] b [2]",
		"sources":      []ChatSource{{Index: 1, FileID: "f"}, {Index: 2, UserFileID: "u"}},
		"verification": &MessageVerification{Citations: []CitationStatus{{N: 1}, {N: 2}}},
	})
	if out["answer"] != "a b [2]" {
		t.Errorf("answer %q", out["answer"])
	}
	v := out["verification"].(*MessageVerification)
	if len(v.Citations) != 1 || v.Citations[0].N != 2 {
		t.Errorf("verification citations %+v, want only N=2", v.Citations)
	}
}

// Oracle: stored history follows the same rule; a message without
// attachments is redacted exactly as before (empty sources, no markers).
func TestRedactMessagesForReader_KeepsOwnAttachments(t *testing.T) {
	withDoc, _ := json.Marshal([]ChatSource{{Index: 1, FileID: "f"}, {Index: 2, UserFileID: "u", FileName: "mine.pdf"}})
	kbOnly, _ := json.Marshal([]ChatSource{{Index: 1, FileID: "f"}})
	msgs := []MessageRow{
		{Role: "ai", Content: "x [1] y [2]", Sources: withDoc},
		{Role: "ai", Content: "z [1]", Sources: kbOnly},
	}
	RedactMessagesForReader(msgs)
	var got []ChatSource
	_ = json.Unmarshal(msgs[0].Sources, &got)
	if msgs[0].Content != "x y [2]" || len(got) != 1 || got[0].UserFileID != "u" {
		t.Errorf("with attachment: %q / %s", msgs[0].Content, msgs[0].Sources)
	}
	if msgs[1].Content != "z" || string(msgs[1].Sources) != "[]" {
		t.Errorf("KB only: %q / %s", msgs[1].Content, msgs[1].Sources)
	}
}
