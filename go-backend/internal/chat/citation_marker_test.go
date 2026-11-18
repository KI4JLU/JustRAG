package chat

import (
	"reflect"
	"strings"
	"testing"
)

func TestParseMarkerBody(t *testing.T) {
	cases := []struct {
		body string
		want []int
	}{
		{"3", []int{3}},
		{"1, 2, 5", []int{1, 2, 5}},
		{"0", []int{}},
		// The page written into the marker (the shapes seen in production).
		{"5, S. 584", []int{5}},
		{"5, S. 584; 8, S. 583", []int{5, 8}},
		{"9, S. 554; 23, S. 570", []int{9, 23}},
		{"5, S. 584, 8, S. 583", []int{5, 8}},
		{"5, S. 584, 586", []int{5}},
		{"5, S. 584-586, 590", []int{5}},
		{"5, S. 12 ff.", []int{5}},
		{"1, 2, S. 7", []int{1, 2}},
		{"5 S. 584", []int{5}},
		{"5: S. 584", []int{5}},
		{"3, p. 12", []int{3}},
		{"3, pp. 12–14; 4, page 2", []int{3, 4}},
		{"2, Seite 4 und 5", []int{2}},
		{"2, Abschnitt 3.2", []int{2}},
		{"1; 2, S. 3", []int{1, 2}},
		{"999999999", []int{999999999}},
		{"1000000000", []int{}},
		{"9223372036854775808", []int{}},
		// Numbers and separators only: a matrix, not a citation.
		{"1; 2", nil},
		{"1, 2; 3, 4", nil},
		{"5, S.\u00a0584", []int{5}},
		{"5, S. 12A", []int{5}},
		{"5, S. 12 FF.", []int{5}},
		{"1,\u00a02, S. 3", []int{1, 2}},
		{"1,\u00a02", nil},
		{"0, S. 2", []int{}},
		{"12345, S. 2", nil},
		// Only the blanks of the grammar; other whitespace is no marker.
		{"5, S.\u3000584", nil},
		{"5, SEITE 3", nil},
		// No citation.
		{"2024 war ein gutes Jahr", nil},
		{"S. 584", nil},
		{"5, siehe oben", nil},
		{"1, 2; S. 3", nil},
		{"5, S.", nil},
	}
	for _, c := range cases {
		got := parseMarkerBody(c.body)
		if len(got) == 0 && len(c.want) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("parseMarkerBody(%q) = %v, want %v", c.body, got, c.want)
		}
	}
}

func TestExtractCitationSpans_PageInMarker(t *testing.T) {
	answer := "Das Feld zeigt die Nummer [5, S. 584]. Größe [2024 mm] bleibt. Siehe [5, S. 584; 8, S. 583] und [2]."
	spans := ExtractCitationSpans(answer)
	var texts []string
	var nums [][]int
	for _, s := range spans {
		texts = append(texts, answer[s.Start:s.End])
		nums = append(nums, s.Numbers)
	}
	wantTexts := []string{"[5, S. 584]", "[5, S. 584; 8, S. 583]", "[2]"}
	wantNums := [][]int{{5}, {5, 8}, {2}}
	if !reflect.DeepEqual(texts, wantTexts) || !reflect.DeepEqual(nums, wantNums) {
		t.Fatalf("spans = %q %v, want %q %v", texts, nums, wantTexts, wantNums)
	}
}

func TestValidateCitations_PageInMarker(t *testing.T) {
	sources := []ChatSource{{Index: 1, Content: "Die Seriennummer des Buchungsmediums wird über einen Beistellleser ausgelesen."}}
	got := ValidateCitations("Die Seriennummer des Buchungsmediums wird über einen Beistellleser ausgelesen [1, S. 584].", sources)
	if len(got) != 1 || got[0].N != 1 {
		t.Fatalf("ValidateCitations = %+v, want one status for source 1", got)
	}
}

func TestStripCitationMarkers_PageInMarker(t *testing.T) {
	in := "Satz [5, S. 584]. Jahr [2024 war gut] bleibt [5, S. 584; 8, S. 583]."
	if got, want := StripCitationMarkers(in), "Satz. Jahr [2024 war gut] bleibt."; got != want {
		t.Errorf("StripCitationMarkers = %q, want %q", got, want)
	}
	if got, want := stripCitationMarkersExcept(in, map[int]bool{8: true}), "Satz. Jahr [2024 war gut] bleibt [8]."; got != want {
		t.Errorf("stripCitationMarkersExcept(keep 8) = %q, want %q", got, want)
	}
}

// The stream must give the same text as the one-shot strip wherever the
// chunk boundary falls — inside the page text included.
func TestCitationMarkerStream_PageInMarker(t *testing.T) {
	in := "Satz [5, S. 584]. Jahr [2024 war gut] bleibt [5, S. 584; 8, S. 583].\nEnde [3, pp. 12–14]"
	want := StripCitationMarkers(in)
	for size := 1; size <= len(in); size++ {
		var s CitationMarkerStream
		var b strings.Builder
		for i := 0; i < len(in); i += size {
			b.WriteString(s.Feed(in[i:min(i+size, len(in))]))
		}
		b.WriteString(s.Flush())
		if got := b.String(); got != want {
			t.Fatalf("chunk size %d: %q, want %q", size, got, want)
		}
	}
}

// Bracketed text that outgrows a marker is released, not held or dropped.
func TestCitationMarkerStream_LongBracketIsNoMarker(t *testing.T) {
	in := "Vorher [1 " + strings.Repeat("wort ", 60) + "] nachher"
	var s CitationMarkerStream
	out := s.Feed(in[:len(in)-10])
	if !strings.Contains(out, "wort wort") {
		t.Fatalf("long bracketed text held back: %q", out)
	}
	out += s.Feed(in[len(in)-10:]) + s.Flush()
	if out != in {
		t.Fatalf("got %q, want input unchanged", out)
	}
}

// Escaped brackets (some models emit them) are markers too, plain or with
// page text. Oracle: the text without the marker, written by hand.
func TestStripCitationMarkers_Escaped(t *testing.T) {
	in := `Satz \[1\]. Text \[5, S. 584\]. Rest \[5, S. 584; 8, S. 583\].`
	if got, want := StripCitationMarkers(in), "Satz. Text. Rest."; got != want {
		t.Errorf("StripCitationMarkers = %q, want %q", got, want)
	}
	if got, want := stripCitationMarkersExcept(in, map[int]bool{8: true}), "Satz. Text. Rest [8]."; got != want {
		t.Errorf("stripCitationMarkersExcept(keep 8) = %q, want %q", got, want)
	}
	for size := 1; size <= len(in); size++ {
		if got, want := feedInChunks(in, size), "Satz. Text. Rest."; got != want {
			t.Fatalf("chunk size %d: %q, want %q", size, got, want)
		}
	}
}

func feedInChunks(in string, size int) string {
	var s CitationMarkerStream
	var b strings.Builder
	for i := 0; i < len(in); i += size {
		b.WriteString(s.Feed(in[i:min(i+size, len(in))]))
	}
	b.WriteString(s.Flush())
	return b.String()
}

// A marker with page text never reaches the reader, whatever comes before
// it and wherever the chunks break: after a run of blanks longer than the
// hold bound, at the body's length bound, and inside a UTF-8 sequence.
// Oracle: the one-shot strip, and that no page text survives.
func TestCitationMarkerStream_PageInMarkerNeverLeaks(t *testing.T) {
	longest := "5, S. 584" + strings.Repeat(" ", maxAnnotatedMarkerBody-10) + "\u00a0"
	if n := len([]rune(longest)); n != maxAnnotatedMarkerBody {
		t.Fatalf("fixture body is %d characters, want %d", n, maxAnnotatedMarkerBody)
	}
	wide := "5, S. 584" + strings.Repeat("\u202f", maxAnnotatedMarkerBody-9)
	cases := []string{
		"Text" + strings.Repeat(" ", maxCitationHold) + "[5, S. 584].",
		"Text" + strings.Repeat(" ", 3*maxCitationHold) + "[5, S. 584; 8, S. 583].",
		"Text [" + longest + "].",
		"Text [" + wide + "].",
		"Text [5, S.\u00a0584] und [5, S.\u202f12\u2009ff.].",
	}
	for ci, in := range cases {
		want := StripCitationMarkers(in)
		if strings.Contains(want, "584") {
			t.Fatalf("case %d: one-shot strip left the marker: %q", ci, want)
		}
		// Only a run of blanks longer than the hold bound is released as it
		// is; every other case must equal the one-shot strip exactly.
		same := func(got string) bool { return got == want }
		if strings.Contains(in, strings.Repeat(" ", maxCitationHold+1)) {
			same = func(got string) bool { return strings.ReplaceAll(got, " ", "") == strings.ReplaceAll(want, " ", "") }
		}
		for i := 0; i <= len(in); i++ {
			var s CitationMarkerStream
			if got := s.Feed(in[:i]) + s.Feed(in[i:]) + s.Flush(); !same(got) {
				t.Fatalf("case %d split at %d: %q, want %q", ci, i, got, want)
			}
		}
		if got := feedInChunks(in, 1); !same(got) {
			t.Fatalf("case %d byte by byte: %q, want %q", ci, got, want)
		}
	}
}

// An oversized number list is dropped up to the character that ends it; the
// text after it survives whole, and the same for every chunking — inside a
// UTF-8 sequence and between a backslash and what follows it included.
// Oracle: written by hand.
func TestCitationMarkerStream_DroppingEndsTheSameForEveryChunking(t *testing.T) {
	list := "[" + strings.Repeat("1,", maxCitationHold)
	cases := []struct{ tail, want string }{
		{"1ä Hallo", "ä Hallo"},
		{"1\u00a02] Rest", " Rest"}, // a no-break space is a blank of the run
		{"1] Rest", " Rest"},
		{`1\] Rest`, " Rest"},
		{`1\alpha Rest`, `\alpha Rest`},
		{`1\123] Rest`, `\123] Rest`},
		{`1\`, `\`},
	}
	for _, c := range cases {
		for i := 0; i <= len(c.tail); i++ {
			var s CitationMarkerStream
			if got := s.Feed(list) + s.Feed(c.tail[:i]) + s.Feed(c.tail[i:]) + s.Flush(); got != c.want {
				t.Fatalf("tail %q split at %d: got %q, want %q", c.tail, i, got, c.want)
			}
		}
		var s CitationMarkerStream
		got := s.Feed(list)
		for i := 0; i < len(c.tail); i++ {
			got += s.Feed(c.tail[i : i+1])
		}
		if got += s.Flush(); got != c.want {
			t.Fatalf("tail %q byte by byte: got %q, want %q", c.tail, got, c.want)
		}
	}
}

// A semicolon-separated number block is a matrix, in math or out of it.
func TestStripCitationMarkers_MatrixStays(t *testing.T) {
	in := "Die Matrix ist $[1, 2; 3, 4]$ bzw. [1; 2]."
	if got := StripCitationMarkers(in); got != in {
		t.Errorf("StripCitationMarkers = %q, want input unchanged", got)
	}
}

// The page text's own full stop ("S.") ends no sentence: a marker with page
// text gets the window of the plain one. Oracle: the plain marker's result.
func TestValidateCitations_PageInMarkerSameWindow(t *testing.T) {
	sources := []ChatSource{{Index: 1, Content: "Das rote Fahrzeug fährt langsam."}}
	plain := ValidateCitations("Es gilt Folgendes [1]. Das rote Fahrzeug fährt langsam.", sources)
	paged := ValidateCitations("Es gilt Folgendes [1, S. 12]. Das rote Fahrzeug fährt langsam.", sources)
	if len(plain) != 1 || !plain[0].Verified {
		t.Fatalf("fixture: the plain marker no longer verifies: %+v", plain)
	}
	if !reflect.DeepEqual(plain, paged) {
		t.Fatalf("page text changed the result: %+v, want %+v", paged, plain)
	}

	// The same for page text in a neighbouring marker.
	status := func(answer string) CitationStatus {
		for _, st := range ValidateCitations(answer, sources) {
			if st.N == 1 {
				return st
			}
		}
		t.Fatalf("no status for source 1 in %q", answer)
		return CitationStatus{}
	}
	plainNext := status("Einleitung. Das rote Fahrzeug fährt langsam [2]. Es gilt Folgendes [1].")
	pagedNext := status("Einleitung. Das rote Fahrzeug fährt langsam [2, S. 12]. Es gilt Folgendes [1].")
	if !plainNext.Verified || !reflect.DeepEqual(plainNext, pagedNext) {
		t.Fatalf("page text in a neighbour changed the result: %+v, want verified %+v", pagedNext, plainNext)
	}
}

// A body one character over the bound is no marker, for the one-shot strip
// and the stream alike.
func TestCitationMarker_BodyBound(t *testing.T) {
	in := "Text [5, S. 584" + strings.Repeat(" ", maxAnnotatedMarkerBody-8) + "]."
	if got := StripCitationMarkers(in); got != in {
		t.Errorf("one-shot strip changed an oversized body: %q", got)
	}
	if got := feedInChunks(in, 7); got != in {
		t.Errorf("stream changed an oversized body: %q", got)
	}
}

func TestIncompleteUTF8Tail(t *testing.T) {
	for in, want := range map[string]int{
		"": 0, "a": 0, "ä": 0, "a\xc3": 1, "a\xe3\x80": 2, "a\xf0\x9f\x98": 3, "a\xf0\x9f\x98\x80": 0, "\x80\x80": 0,
	} {
		if got := incompleteUTF8Tail(in); got != want {
			t.Errorf("incompleteUTF8Tail(%q) = %d, want %d", in, got, want)
		}
	}
}

// The page text inside a marker is no evidence: a source that happens to
// hold the same words does not verify the claim. Oracle: the plain marker's
// result.
func TestValidateCitations_PageTextIsNoEvidence(t *testing.T) {
	sources := []ChatSource{{Index: 1, Content: "Seite 123 456"}}
	plain := ValidateCitations("Der Mond besteht aus Käse [1].", sources)
	paged := ValidateCitations("Der Mond besteht aus Käse [1, Seite 123-456].", sources)
	if len(plain) != 1 || plain[0].Verified {
		t.Fatalf("fixture: the plain marker verifies: %+v", plain)
	}
	if !reflect.DeepEqual(plain, paged) {
		t.Fatalf("page text changed the result: %+v, want %+v", paged, plain)
	}
	// A marker too tight for the ", " of the plain form loses its page text too.
	tight := ValidateCitations("Der Mond besteht aus Käse ["+strings.Repeat("1;", 20)+"1 Seite 123-456].", sources)
	if !reflect.DeepEqual(plain, tight) {
		t.Fatalf("page text in a tight marker changed the result: %+v, want %+v", tight, plain)
	}
}

// Oracle: written by hand; the length never changes.
func TestWithPlainMarkers(t *testing.T) {
	in := `A [1]. B [5, S. 584; 8, S. 583]. C \[2, S. 3\] D [2024 mm]. E [1;2;3;4;5 S4].`
	want := `A [1]. B [5, 8]                . C [2]         D [2024 mm]. E [1,2,3,4,5]   .`
	got := withPlainMarkers(in, ExtractCitationSpans(in))
	if got != want || len(got) != len(in) {
		t.Fatalf("withPlainMarkers = %q (len %d), want %q (len %d)", got, len(got), want, len(want))
	}
}
