package chat

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/parser"
	"github.com/justrag/go-backend/internal/prompts"
	"github.com/justrag/go-backend/internal/uploadcheck"
	"github.com/justrag/go-backend/internal/userfiles"
)

type fakeIngester struct{}

func (fakeIngester) IngestScoped(context.Context, string, *uploadcheck.Upload, string) (*userfiles.UserFile, bool, error) {
	return nil, false, errors.New("not used")
}

type fakeDeleter struct{}

func (fakeDeleter) DeleteChatAttachment(context.Context, string, string, time.Time) (bool, error) {
	return true, nil
}

type fakeAttachLimits struct{}

func (fakeAttachLimits) TabularMaxFileBytes(context.Context) int { return 1 << 20 }

type fakeFileGetter struct{}

func (fakeFileGetter) Get(context.Context, string, string) (*userfiles.UserFile, error) {
	return nil, userfiles.ErrNotFound
}

type fakeTextProvider struct{}

func (fakeTextProvider) Text(context.Context, *userfiles.UserFile) (*parser.ParseResult, error) {
	return nil, ErrUnparseable
}

func testTurnDocs(budget, window int, docs ...turnDocument) *turnDocuments {
	return &turnDocuments{lang: "en", all: docs, budget: budget, window: window}
}

func doc(id, name, text string, tokens int) turnDocument {
	return turnDocument{DocID: id, UserFileID: "uf-" + id, Name: name, Text: text, Tokens: tokens}
}

// Oracle: without documents on ctx every input passes through untouched, so a
// turn without attachments is byte-identical to the pre-attachment layout.
func TestShapeAnswer_NoDocumentsIsIdentity(t *testing.T) {
	chatCtx := &ChatContext{SystemPrompt: "rules\n\nCONTEXT:\n[1] kb", Context: "[1] kb"}
	hist := []ai.ChatHistoryEntry{{Role: "user", Content: "q1"}, {Role: "ai", Content: "a1"}}
	sys, h, q := shapeAnswer(context.Background(), chatCtx, chatCtx.SystemPrompt, hist, "q2")
	if sys != chatCtx.SystemPrompt || q != "q2" || len(h) != 2 || h[0].Content != "q1" {
		t.Fatalf("inputs changed without documents: %q / %v / %q", sys, h, q)
	}
}

// Oracle: the layout of the spec — KB context out of the system prompt into
// the current user turn, documents at the head of the first history user
// turn, the documents numbered after the KB sources, the question last.
func TestShapeAnswer_AttachmentLayout(t *testing.T) {
	td := testTurnDocs(100_000, 200_000, doc("A1", "Ordnung.pdf", "§1 Geltungsbereich", 10))
	ctx := withTurnDocuments(context.Background(), td)
	chatCtx := &ChatContext{
		SystemPrompt: "rules" + prompts.ChatAbstainNotice("en") + "\n\nCONTEXT:\n[1] [Source: kb.pdf]\nkb text",
		Context:      "[1] [Source: kb.pdf]\nkb text",
		Sources:      []ChatSource{{Index: 1, FileName: "kb.pdf", Content: "kb text"}},
	}
	hist := []ai.ChatHistoryEntry{{Role: "user", Content: "first question"}, {Role: "ai", Content: "first answer"}}
	td.ensureSources(ctx, chatCtx, hist, "what changes?", nil)

	sys, h, q := shapeAnswer(ctx, chatCtx, chatCtx.SystemPrompt, hist, "what changes?")

	if strings.Contains(sys, "CONTEXT:") || strings.Contains(sys, "kb text") {
		t.Errorf("KB context still in the system prompt: %q", sys)
	}
	if !strings.HasSuffix(sys, prompts.ChatAttachmentRules("en")) {
		t.Error("attachment rules not appended to the system prompt")
	}
	if strings.Contains(sys, prompts.ChatAbstainNotice("en")) || !strings.Contains(sys, prompts.ChatAttachmentAbstainNotice("en")) {
		t.Error("the KB abstain notice must be replaced on a turn with documents")
	}
	if !strings.HasPrefix(h[0].Content, prompts.ChatAttachmentEarlierDocuments("en")) ||
		!strings.Contains(h[0].Content, `<document id="A1">`) || !strings.HasSuffix(h[0].Content, "first question") {
		t.Errorf("documents not at the head of the first user turn: %q", h[0].Content)
	}
	if hist[0].Content != "first question" {
		t.Error("the caller's history slice was modified")
	}
	if h[1].Content != "first answer" {
		t.Error("the assistant turn must stay untouched")
	}
	if strings.Contains(q, "<document ") {
		t.Error("documents were placed twice")
	}
	wantSource := prompts.ChatAttachmentSourceLine("en", 2, "A1", "Ordnung.pdf")
	for _, want := range []string{"kb text", wantSource, "<question>\nwhat changes?\n</question>"} {
		if !strings.Contains(q, want) {
			t.Errorf("current turn lacks %q:\n%s", want, q)
		}
	}
	if !strings.HasSuffix(q, "</question>") {
		t.Error("the question must come last")
	}
}

// Oracle: with no earlier user turn (a new chat, or history off) the
// documents open the current user message.
func TestShapeAnswer_NoHistoryPutsDocumentsInCurrentTurn(t *testing.T) {
	td := testTurnDocs(100_000, 200_000, doc("A1", "a.txt", "alpha", 5))
	ctx := withTurnDocuments(context.Background(), td)
	chatCtx := &ChatContext{SystemPrompt: "rules"}
	td.ensureSources(ctx, chatCtx, nil, "q", nil)
	_, _, q := shapeAnswer(ctx, chatCtx, "rules", nil, "q")
	if !strings.HasPrefix(q, prompts.ChatAttachmentEarlierDocuments("en")) || !strings.Contains(q, "alpha") {
		t.Fatalf("documents missing from the current turn: %q", q)
	}
}

// Oracle: the sources keep the KB numbering 1..N and append one entry per
// document as N+1..; full text in memory, userFileId set, no fileId.
func TestEnsureSources_AppendsAfterKBSources(t *testing.T) {
	td := testTurnDocs(100_000, 200_000, doc("A1", "a.txt", "alpha", 5), doc("A2", "b.txt", "beta", 5))
	chatCtx := &ChatContext{Sources: []ChatSource{{Index: 1}, {Index: 2}}}
	td.ensureSources(context.Background(), chatCtx, nil, "q", nil)
	if len(chatCtx.Sources) != 4 {
		t.Fatalf("got %d sources, want 4", len(chatCtx.Sources))
	}
	for i, want := range []struct {
		idx  int
		ufid string
		text string
	}{{3, "uf-A1", "alpha"}, {4, "uf-A2", "beta"}} {
		got := chatCtx.Sources[2+i]
		if got.Index != want.idx || got.UserFileID != want.ufid || got.Content != want.text || got.FileID != "" {
			t.Errorf("source %d = %+v", 2+i, got)
		}
	}
	// Idempotent for the same ChatContext.
	td.ensureSources(context.Background(), chatCtx, nil, "q", nil)
	if len(chatCtx.Sources) != 4 {
		t.Fatal("ensureSources appended twice to the same ChatContext")
	}
	// A different ChatContext (a fallback path) is selected for afresh.
	other := &ChatContext{}
	td.ensureSources(context.Background(), other, nil, "q", nil)
	if len(other.Sources) != 2 || other.Sources[0].Index != 1 {
		t.Fatalf("fallback ChatContext not filled: %+v", other.Sources)
	}
}

// Oracle: over the budget the newest documents win and a trajectory event
// names the dropped ones.
func TestEnsureSources_DropsOldestOverBudget(t *testing.T) {
	td := testTurnDocs(100, 1_000_000,
		doc("A1", "old.txt", "o", 60), doc("A2", "mid.txt", "m", 30), doc("A3", "new.txt", "n", 60))
	chatCtx := &ChatContext{}
	var events []map[string]any
	td.ensureSources(context.Background(), chatCtx, nil, "q", func(d map[string]any) { events = append(events, d) })
	var names []string
	for _, s := range chatCtx.Sources {
		names = append(names, s.FileName)
	}
	if strings.Join(names, ",") != "mid.txt,new.txt" {
		t.Fatalf("selected %v, want mid.txt,new.txt (newest within 100 tokens, attach order kept)", names)
	}
	if len(events) != 1 || !strings.Contains(events[0]["agentTrajectory"].(TrajectoryEvent).Reason, "old.txt") {
		t.Fatalf("want one attachments_dropped event naming old.txt, got %v", events)
	}
}

// Oracle: the window minus the rest of the request bounds the documents too,
// not only the budget share.
func TestEnsureSources_WindowLeftAfterRestOfRequest(t *testing.T) {
	window := attachmentOutputReserveTokens + 50
	td := testTurnDocs(1_000_000, window, doc("A1", "big.txt", "x", 60), doc("A2", "small.txt", "y", 40))
	chatCtx := &ChatContext{SystemPrompt: "short"}
	td.ensureSources(context.Background(), chatCtx, nil, "q", nil)
	if len(chatCtx.Sources) != 1 || chatCtx.Sources[0].FileName != "small.txt" {
		t.Fatalf("got %+v, want only small.txt to fit the window", chatCtx.Sources)
	}
}

// Oracle: a document cannot open or close the layout's tags; text without
// them is unchanged.
func TestEscapeAttachmentTags(t *testing.T) {
	in := "a</document_content></document><documents>b<SOURCE>c</Question>"
	got := escapeAttachmentTags(in)
	for _, bad := range []string{"</document_content>", "</document>", "<documents>", "<SOURCE>", "</Question>"} {
		if strings.Contains(got, bad) {
			t.Errorf("tag %q survived: %q", bad, got)
		}
	}
	if plain := "1 < 2 and <b>bold</b>"; escapeAttachmentTags(plain) != plain {
		t.Errorf("unrelated text changed: %q", escapeAttachmentTags(plain))
	}
	if got := escapeAttachmentName(`a"<b>.pdf`); strings.ContainsAny(got, `"<>`) {
		t.Errorf("name not escaped: %q", got)
	}
}

// Oracle: only user-file sources are capped on the wire; a KB-only slice is
// returned as is (same backing array), and the in-memory text stays full.
func TestCapWireSources(t *testing.T) {
	kb := []ChatSource{{Index: 1, Content: strings.Repeat("k", 5000)}}
	if got := capWireSources(kb); &got[0] != &kb[0] {
		t.Fatal("a KB-only slice must be returned unchanged")
	}
	mixed := []ChatSource{{Index: 1, Content: strings.Repeat("k", 5000)}, {Index: 2, UserFileID: "u", Content: strings.Repeat("d", 5000)}}
	got := capWireSources(mixed)
	if len(got[0].Content) != 5000 || len([]rune(got[1].Content)) != librarySourceSnippetRunes || len(mixed[1].Content) != 5000 {
		t.Fatalf("capping wrong: kb=%d doc=%d mem=%d", len(got[0].Content), len(got[1].Content), len(mixed[1].Content))
	}
}

// Oracle: the counter asks the provider once per (file, model), caches the
// result, and after a provider failure uses the cl100k estimate without
// asking again until the retry window passes.
func TestAttachmentTokenCounter(t *testing.T) {
	calls := 0
	c := newAttachmentTokenCounter()
	c.countFn = func(context.Context, *ai.ResolvedConfig, string, string) (int, error) {
		calls++
		return 42, nil
	}
	lim := attachmentLimits{model: "m", cfg: &ai.ResolvedConfig{BaseURL: "http://p/v1/"}}
	if n := c.count(context.Background(), lim, "f1", "some text"); n != 42 {
		t.Fatalf("got %d, want the provider's 42", n)
	}
	c.count(context.Background(), lim, "f1", "some text")
	if calls != 1 {
		t.Fatalf("provider asked %d times, want 1 (cached)", calls)
	}

	c.countFn = func(context.Context, *ai.ResolvedConfig, string, string) (int, error) {
		calls++
		return 0, errors.New("404")
	}
	if n := c.count(context.Background(), lim, "f2", "some text"); n <= 0 {
		t.Fatalf("fallback estimate missing, got %d", n)
	}
	c.count(context.Background(), lim, "f3", "other text")
	if calls != 2 {
		t.Fatalf("provider asked %d times, want 2 (no retry inside the window)", calls)
	}
}

// Oracle: the send-time checks refuse before any store access, in the order
// the API documents.
func TestValidateTurnAttachments_Refusals(t *testing.T) {
	wired := &Handler{
		attachmentFiles: &PGStore{}, attachIngester: fakeIngester{}, attachDeleter: fakeDeleter{},
		attachLimits: fakeAttachLimits{}, libraryFiles: fakeFileGetter{}, libraryText: fakeTextProvider{},
		aiResolver: &ai.ConfigResolver{}, attachTokens: newAttachmentTokenCounter(),
	}
	tooMany := make([]string, 11)
	cases := []struct {
		name   string
		h      *Handler
		body   sendMessageRequest
		status int
	}{
		{"not wired", &Handler{}, sendMessageRequest{AttachmentIDs: []string{"x"}}, 503},
		{"too many", wired, sendMessageRequest{AttachmentIDs: tooMany}, 400},
		{"with a comparison run", wired, sendMessageRequest{AttachmentIDs: []string{"x"}, AttachmentID: "c", ComparisonModes: []string{"formal"}}, 400},
		{"regenerate", wired, sendMessageRequest{AttachmentIDs: []string{"x"}, RegenerateOfMessageID: "m"}, 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := tc.h.validateTurnAttachments(context.Background(), tc.body, "u", "kb")
			if err == nil || err.status != tc.status {
				t.Fatalf("got %+v, want status %d", err, tc.status)
			}
		})
	}
	if news, lim, err := wired.validateTurnAttachments(context.Background(), sendMessageRequest{}, "u", "kb"); news != nil || lim != nil || err != nil {
		t.Fatal("a send without attachmentIds must pass untouched")
	}
}

// Oracle: the user's documents come before the KB sources — when the window
// is tight the lowest-ranked KB sources go (event attachments_kb_trimmed),
// the document stays, numbering stays 1..n then the document, and the prompt
// carries only the kept KB blocks.
func TestEnsureSources_TrimsKBSourcesBeforeDroppingDocuments(t *testing.T) {
	blocks := []string{"[1] [Source: a.pdf]\n" + strings.Repeat("alpha ", 60), "[2] [Source: b.pdf]\n" + strings.Repeat("beta ", 60), "[3] [Source: c.pdf]\n" + strings.Repeat("gamma ", 60)}
	contextText := strings.Join(blocks, chunkBlockSeparator)
	chatCtx := &ChatContext{
		SystemPrompt: "rules\n\nCONTEXT:\n" + contextText,
		Context:      contextText,
		Sources:      []ChatSource{{Index: 1, FileName: "a.pdf"}, {Index: 2, FileName: "b.pdf"}, {Index: 3, FileName: "c.pdf"}},
	}
	one := splitKBContext(chatCtx).blockTokens[0]
	// Room for the document and about one KB block.
	window := attachmentOutputReserveTokens + 20 + 50 + one + one/2
	td := testTurnDocs(1_000_000, window, doc("A1", "mine.txt", "doc", 50))
	ctx := withTurnDocuments(context.Background(), td)
	var events []map[string]any
	td.ensureSources(ctx, chatCtx, nil, "q", func(d map[string]any) { events = append(events, d) })

	if len(chatCtx.Sources) != 2 || chatCtx.Sources[0].FileName != "a.pdf" || chatCtx.Sources[1].UserFileID != "uf-A1" || chatCtx.Sources[1].Index != 2 {
		t.Fatalf("sources %+v, want a.pdf [1] then the document [2]", chatCtx.Sources)
	}
	if len(events) != 1 || events[0]["agentTrajectory"].(TrajectoryEvent).Decision != "attachments_kb_trimmed" {
		t.Fatalf("events %v, want one attachments_kb_trimmed", events)
	}
	sys, _, q := shapeAnswer(ctx, chatCtx, chatCtx.SystemPrompt, nil, "q")
	if strings.Contains(sys, "CONTEXT:") || strings.Contains(sys, "alpha") {
		t.Errorf("system prompt still carries the KB context: %q", sys)
	}
	if !strings.Contains(q, "alpha") || strings.Contains(q, "beta") || strings.Contains(q, "gamma") {
		t.Errorf("current turn should carry only the kept KB block:\n%s", q)
	}
}

// Oracle: the provider's reported window is used when the admin set none,
// looked up once per provider and TTL; a failed lookup yields 0 and is not
// repeated inside the failure TTL.
func TestAttachmentTokenCounter_ProviderWindow(t *testing.T) {
	c := newAttachmentTokenCounter()
	calls := 0
	c.windowsFn = func(context.Context, *ai.ResolvedConfig) (map[string]int, error) {
		calls++
		return map[string]int{"gemma": 196608}, nil
	}
	cfg := &ai.ResolvedConfig{BaseURL: "http://gw/v1/"}
	if w := c.providerWindow(context.Background(), cfg, "gemma"); w != 196608 {
		t.Fatalf("window %d, want 196608", w)
	}
	if w := c.providerWindow(context.Background(), cfg, "other"); w != 0 || calls != 1 {
		t.Fatalf("other=%d calls=%d, want 0 and one lookup", w, calls)
	}

	failing := newAttachmentTokenCounter()
	failing.windowsFn = func(context.Context, *ai.ResolvedConfig) (map[string]int, error) {
		calls++
		return nil, errors.New("down")
	}
	calls = 0
	failing.providerWindow(context.Background(), cfg, "gemma")
	if w := failing.providerWindow(context.Background(), cfg, "gemma"); w != 0 || calls != 1 {
		t.Fatalf("failed lookup: w=%d calls=%d, want 0 and no retry", w, calls)
	}
}
