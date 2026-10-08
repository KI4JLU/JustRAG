package chat

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/parser"
)

func libCfg(fulltext, longctx string) *fakeSiteConfigReader {
	v := map[string]*string{}
	if fulltext != "" {
		v["chat_library_fulltext_max_tokens"] = strPtr(fulltext)
	}
	if longctx != "" {
		v["chat_longcontext_max_tokens"] = strPtr(longctx)
	}
	return &fakeSiteConfigReader{values: v}
}

func twoFiles() []LibraryFile {
	return []LibraryFile{
		{UserFileID: "uf-1", Name: "a.pdf", Parsed: &parser.ParseResult{
			Text:  "alpha one alpha two",
			Pages: []parser.PageText{{PageNumber: 1, Text: "alpha one"}, {PageNumber: 2, Text: "alpha two"}},
		}},
		{UserFileID: "uf-2", Name: "b.txt", Parsed: &parser.ParseResult{Text: "beta text"}},
	}
}

func TestBuildLibraryContext_FullText(t *testing.T) {
	cc, err := buildLibraryContextWith(context.Background(), nil, nil, libCfg("", ""),
		LibraryContextParams{Files: twoFiles(), Query: "q", Language: "en"})
	if err != nil {
		t.Fatal(err)
	}
	if len(cc.Sources) != 3 {
		t.Fatalf("sources = %d, want 3", len(cc.Sources))
	}
	wantIDs := []string{"uf-1", "uf-1", "uf-2"}
	for i, s := range cc.Sources {
		if s.Index != i+1 || s.UserFileID != wantIDs[i] || s.FileID != "" {
			t.Errorf("source %d = %+v", i, s)
		}
	}
	if len(cc.Sources[0].Pages) != 1 || cc.Sources[0].Pages[0] != 1 || cc.Sources[1].Pages[0] != 2 {
		t.Errorf("pages: %v %v", cc.Sources[0].Pages, cc.Sources[1].Pages)
	}
	for _, want := range []string{"[1] [Source: a.pdf, p. 1]", "[2] [Source: a.pdf, p. 2]", "[3] [Source: b.txt", "alpha two", "beta text", "CONTEXT:"} {
		if !strings.Contains(cc.SystemPrompt, want) {
			t.Errorf("system prompt missing %q", want)
		}
	}
	for _, c := range cc.FinalChunks {
		if c.FileID != "" || c.ID != "" {
			t.Errorf("chunk leaks ids: %+v", c)
		}
	}
	b, _ := json.Marshal(cc.Sources[0])
	if !strings.Contains(string(b), `"userFileId":"uf-1"`) {
		t.Errorf("json: %s", b)
	}
}

func bigText(words int) string { return strings.Repeat("lorem ipsum dolor ", words) }

func TestBuildLibraryContext_MapReduce(t *testing.T) {
	files := []LibraryFile{{UserFileID: "uf-1", Name: "big.txt", Parsed: &parser.ParseResult{Text: bigText(1500)}}}
	var calls atomic.Int32
	extract := func(_ context.Context, _ *ai.ConfigResolver, _, _, kbID, _, _ string) ([]ai.LongContextFinding, error) {
		calls.Add(1)
		if kbID != "" {
			t.Errorf("kbID = %q", kbID)
		}
		return []ai.LongContextFinding{{SourceIdx: 1, Claim: "FINDING-CLAIM", Quote: "lorem"}}, nil
	}
	cc, err := buildLibraryContextWith(context.Background(), nil, extract, libCfg("4000", "100000"),
		LibraryContextParams{Files: files, Query: "q", Language: "en"})
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() == 0 {
		t.Fatal("extractor not called: map_reduce path not taken")
	}
	if !strings.Contains(cc.SystemPrompt, "FINDING-CLAIM") || !strings.Contains(cc.SystemPrompt, "FINDINGS") {
		t.Errorf("findings missing from prompt")
	}
	if len(cc.Sources) < 2 {
		t.Fatalf("want split chunks as sources, got %d", len(cc.Sources))
	}
	for _, s := range cc.Sources {
		if s.UserFileID != "uf-1" || s.FileID != "" {
			t.Errorf("source = %+v", s)
		}
	}
}

func TestBuildLibraryContext_TooLarge(t *testing.T) {
	files := []LibraryFile{{UserFileID: "uf-1", Name: "big.txt", Parsed: &parser.ParseResult{Text: bigText(4000)}}}
	_, err := buildLibraryContextWith(context.Background(), nil, nil, libCfg("4000", "10000"),
		LibraryContextParams{Files: files, Query: "q", Language: "en"})
	var tl *ErrLibraryTooLarge
	if !errors.As(err, &tl) {
		t.Fatalf("err = %v", err)
	}
	if tl.Max != 10000 || tl.Tokens <= 10000 {
		t.Errorf("tl = %+v", tl)
	}
	want := "selected files are too large for one chat turn ("
	if !strings.HasPrefix(tl.Error(), want) || !strings.HasSuffix(tl.Error(), ", maximum 10000)") {
		t.Errorf("msg = %q", tl.Error())
	}
}

func TestBuildLibraryContext_SplitsOversizedPage(t *testing.T) {
	files := []LibraryFile{{UserFileID: "uf-1", Name: "p.pdf", Parsed: &parser.ParseResult{
		Pages: []parser.PageText{{PageNumber: 7, Text: bigText(1500)}},
	}}}
	cc, err := buildLibraryContextWith(context.Background(), nil, nil, libCfg("100000", ""),
		LibraryContextParams{Files: files, Query: "q", Language: "en"})
	if err != nil {
		t.Fatal(err)
	}
	if len(cc.Sources) < 2 {
		t.Fatalf("sources = %d, want split", len(cc.Sources))
	}
	for _, s := range cc.Sources {
		if len(s.Pages) != 1 || s.Pages[0] != 7 {
			t.Errorf("pages = %v", s.Pages)
		}
	}
}

func TestBuildLibraryContext_Empty(t *testing.T) {
	_, err := buildLibraryContextWith(context.Background(), nil, nil, libCfg("", ""),
		LibraryContextParams{Files: []LibraryFile{{UserFileID: "x", Name: "e", Parsed: &parser.ParseResult{}}}})
	if err == nil {
		t.Fatal("want error for no text")
	}
}

func TestChatLibraryFulltextMaxTokens(t *testing.T) {
	ctx := context.Background()
	cases := map[string]int{"": 60000, "abc": 60000, "3999": 60000, "4000": 4000, " 200000 ": 200000, "200001": 60000}
	for in, want := range cases {
		r := &fakeSiteConfigReader{values: map[string]*string{"chat_library_fulltext_max_tokens": strPtr(in)}}
		if got := ChatLibraryFulltextMaxTokens(ctx, r); got != want {
			t.Errorf("%q = %d, want %d", in, got, want)
		}
	}
	if got := ChatLibraryFulltextMaxTokens(ctx, nil); got != 60000 {
		t.Errorf("nil = %d", got)
	}
}
