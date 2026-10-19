package chat

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/prompts"
	"github.com/justrag/go-backend/internal/splitter"
	"github.com/justrag/go-backend/internal/userfiles"
)

// ---------------------------------------------------------------------------
// Chat attachments as context (migration 0090)
//
// Files the user attaches in the composer are user_files rows (scope 'chat'
// unless the bytes are already a library file) linked to the user message
// they were sent with. Their full text is context for the answer model next
// to the KB retrieval; nothing is indexed.
//
// Prompt layout on a turn that carries any attached document, new or from an
// earlier message of the conversation:
//
//   - system: the usual rules, without the KB CONTEXT block, plus
//     prompts.ChatAttachmentRules (documents are data, how to cite them);
//   - the first user turn of the request opens with every document of the
//     conversation, in the order they were attached, as <document> blocks
//     with a stable id (A1, A2, …);
//   - the current user turn carries the KB sources and one numbered entry
//     per document, then the question.
//
// The documents sit at a fixed place near the start of the request and the
// per-turn KB sources after them, so a provider's prefix cache can reuse the
// documents from one turn to the next. KB sources keep their numbers 1..N;
// the documents follow as N+1..N+M, so no existing numbering (validator,
// conflicts, long-context findings) shifts. A turn without documents is
// byte-identical to the layout before attachments existed.
// ---------------------------------------------------------------------------

// attachmentOutputReserveTokens is kept free of the context window for the
// answer itself when the documents of a turn are selected.
const attachmentOutputReserveTokens = 8192

// turnDocument is one attached document of the conversation.
type turnDocument struct {
	// DocID is the stable id shown to the model ("A1"): the document's place
	// in the order of first attachment in the conversation.
	DocID      string
	UserFileID string
	Name       string
	Text       string
	Tokens     int
	// New marks an attachment of this turn's own question.
	New bool
}

// turnDocuments is the attachment state of one chat turn, carried on the
// request context (withTurnDocuments) so every answer path — standard,
// orchestrators, teams, answer tools — reads the same documents.
type turnDocuments struct {
	lang string
	// all is every document of the conversation, in attach order.
	all []turnDocument
	// newIDs are this turn's attachment ids, stored with the user message.
	newIDs []string
	// budget is the share of the answer model's window the documents may
	// fill; window is that window.
	budget, window int

	// Set by ensureSources for one ChatContext.
	mu         sync.Mutex
	appliedTo  *ChatContext
	selected   []turnDocument
	sourceBase int
	// originalContext is chatCtx.Context before KB sources were trimmed: the
	// text the system prompt's CONTEXT block still carries.
	originalContext string
}

type turnDocumentsKey struct{}

func withTurnDocuments(ctx context.Context, td *turnDocuments) context.Context {
	if td == nil {
		return ctx
	}
	return context.WithValue(ctx, turnDocumentsKey{}, td)
}

func turnDocumentsFrom(ctx context.Context) *turnDocuments {
	td, _ := ctx.Value(turnDocumentsKey{}).(*turnDocuments)
	return td
}

// attachmentTurn reports whether ctx carries attached documents. Post-response
// checks that read only the KB context (factcheck, verifier, refine, RAGAS)
// are skipped on such a turn: they would judge an answer grounded in the
// user's documents against sources that do not contain them.
func attachmentTurn(ctx context.Context) bool {
	td := turnDocumentsFrom(ctx)
	return td != nil && len(td.all) > 0
}

// newAttachmentIDs returns this turn's attachment ids (nil without any).
func newAttachmentIDs(ctx context.Context) []string {
	if td := turnDocumentsFrom(ctx); td != nil {
		return td.newIDs
	}
	return nil
}

// ensureSources selects the documents that fit this turn and appends one
// source per selected document to chatCtx.Sources, numbered after the KB
// sources. Idempotent per ChatContext; a new ChatContext (an orchestrator
// fell back to the standard path) is selected for afresh. Must run before
// the sources are streamed or persisted.
//
// Priority: the user's attached documents come before the KB sources. The
// space is the window minus the request without its KB sources (system
// prompt, history, question) and the answer reserve. Documents take it
// first, newest first and within the attachment budget; the KB sources get
// what is left, lowest-ranked ones trimmed first (attachments_kb_trimmed).
// A document is left out only when it does not fit even without any KB
// source (attachments_dropped). A KB context that is not one block per
// source (the long-context findings) is never trimmed: the documents then
// get only the space next to it.
func (td *turnDocuments) ensureSources(ctx context.Context, chatCtx *ChatContext, history []ai.ChatHistoryEntry, question string, emit func(map[string]any)) {
	if td == nil || chatCtx == nil || len(td.all) == 0 {
		return
	}
	td.mu.Lock()
	defer td.mu.Unlock()
	if td.appliedTo == chatCtx {
		return
	}

	kb := splitKBContext(chatCtx)
	// The KB context is counted once (in splitKBContext); the system prompt
	// is counted without it. cl100k runs at ~9 MB/s, so a KB context counted
	// three times was a measurable share of an attachment turn.
	rest := splitter.CountTokens(kb.systemWithout(chatCtx)) + splitter.CountTokens(question)
	for _, h := range history {
		rest += splitter.CountTokens(h.Content)
	}
	space := td.window - rest - attachmentOutputReserveTokens
	docSpace := space
	if kb.inSystem && !kb.trimmable {
		// KB context in the prompt that cannot be trimmed: documents get
		// only the space next to it.
		docSpace -= kb.tokens
	}

	keep := make([]bool, len(td.all))
	used := 0
	for i := len(td.all) - 1; i >= 0; i-- {
		if used+td.all[i].Tokens <= min(td.budget, docSpace) {
			keep[i] = true
			used += td.all[i].Tokens
		}
	}
	selected := make([]turnDocument, 0, len(td.all))
	var dropped []string
	for i, d := range td.all {
		if keep[i] {
			selected = append(selected, d)
		} else {
			dropped = append(dropped, d.Name)
		}
	}
	if len(dropped) > 0 {
		logctx.From(ctx).Warn("chat.attachments: documents dropped for the context budget",
			"dropped", len(dropped), "kept", len(selected), "budget", td.budget, "available", docSpace, "window", td.window)
		emitTrajectory(emit, TrajectoryEvent{
			Stage:    "attachments",
			Decision: "attachments_dropped",
			Reason:   fmt.Sprintf("context budget: %d of %d attached documents fit (%s left out)", len(selected), len(td.all), strings.Join(dropped, ", ")),
			Findings: len(dropped),
		}, nil)
	}

	td.originalContext = chatCtx.Context
	if kb.trimmable {
		if n := kb.fit(space - used); n < len(kb.blocks) {
			total := len(kb.blocks)
			chatCtx.Context = strings.Join(kb.blocks[:n], chunkBlockSeparator)
			// A copy: the attachment sources are appended below, and the
			// trimmed tail of the original array may still be held elsewhere.
			chatCtx.Sources = append([]ChatSource(nil), chatCtx.Sources[:n]...)
			// A conflict between sources that are gone has nothing left to
			// point at in the answer's source list.
			if chatCtx.Conflicts != nil {
				kept := make([]MessageConflict, 0, len(chatCtx.Conflicts.Conflicts))
				for _, c := range chatCtx.Conflicts.Conflicts {
					if c.SourceA <= n && c.SourceB <= n {
						kept = append(kept, c)
					}
				}
				chatCtx.Conflicts = &ConflictReport{Conflicts: kept}
			}
			logctx.From(ctx).Info("chat.attachments: KB sources trimmed for the attached documents",
				"kept", n, "of", total, "window", td.window)
			emitTrajectory(emit, TrajectoryEvent{
				Stage:    "attachments",
				Decision: "attachments_kb_trimmed",
				Reason:   fmt.Sprintf("attached documents first: %d of %d knowledge-base sources fit next to them", n, total),
				Findings: total - n,
			}, nil)
		}
	}

	td.sourceBase = len(chatCtx.Sources)
	for i, d := range selected {
		chatCtx.Sources = append(chatCtx.Sources, ChatSource{
			Index:      td.sourceBase + i + 1,
			FileName:   d.Name,
			UserFileID: d.UserFileID,
			Content:    d.Text,
		})
	}
	td.selected = selected
	td.appliedTo = chatCtx
}

// kbContext is a turn's KB context split into its per-source blocks.
type kbContext struct {
	// inSystem: the system prompt carries the context as its CONTEXT block.
	inSystem    bool
	blocks      []string
	blockTokens []int
	tokens      int
	trimmable   bool
}

// splitKBContext splits chatCtx.Context into the blocks buildChatSourcesAndContext
// rendered. It is trimmable only when there is exactly one block per source
// and the system prompt carries the block (the standard CONTEXT layout).
func splitKBContext(chatCtx *ChatContext) kbContext {
	if chatCtx.Context == "" {
		return kbContext{}
	}
	k := kbContext{inSystem: strings.Contains(chatCtx.SystemPrompt, "\n\nCONTEXT:\n"+chatCtx.Context)}
	blocks := strings.Split(chatCtx.Context, chunkBlockSeparator)
	if !k.inSystem || len(blocks) != len(chatCtx.Sources) {
		k.tokens = splitter.CountTokens(chatCtx.Context)
		return k
	}
	k.blocks, k.trimmable = blocks, true
	k.blockTokens = make([]int, len(blocks))
	for i, b := range blocks {
		k.blockTokens[i] = splitter.CountTokens(b)
		k.tokens += k.blockTokens[i]
	}
	return k
}

// systemWithout returns the system prompt without its KB CONTEXT block (the
// prompt unchanged when it carries none).
func (k kbContext) systemWithout(chatCtx *ChatContext) string {
	if !k.inSystem {
		return chatCtx.SystemPrompt
	}
	return strings.Replace(chatCtx.SystemPrompt, "\n\nCONTEXT:\n"+chatCtx.Context, "", 1)
}

// fit returns how many leading blocks fit in space tokens.
func (k kbContext) fit(space int) int {
	used := 0
	for i, t := range k.blockTokens {
		if used+t > space {
			return i
		}
		used += t
	}
	return len(k.blockTokens)
}

// shapeAnswer turns the answer inputs of a turn into the attachment layout
// (see the top of this file). Without attached documents — or before
// ensureSources ran for chatCtx — it returns the inputs unchanged.
func shapeAnswer(ctx context.Context, chatCtx *ChatContext, system string, history []ai.ChatHistoryEntry, question string) (string, []ai.ChatHistoryEntry, string) {
	td := turnDocumentsFrom(ctx)
	if td == nil || chatCtx == nil {
		return system, history, question
	}
	td.mu.Lock()
	selected, base, applied, original := td.selected, td.sourceBase, td.appliedTo == chatCtx, td.originalContext
	td.mu.Unlock()
	if !applied || len(selected) == 0 {
		return system, history, question
	}
	lang := td.lang

	// The KB sources move from the system prompt into the user turn — the
	// (possibly trimmed) chatCtx.Context, while the system prompt still
	// carries the original block.
	kbBlock := ""
	if original != "" {
		marker := "\n\nCONTEXT:\n" + original
		if strings.Contains(system, marker) {
			system = strings.Replace(system, marker, "", 1)
			kbBlock = chatCtx.Context
		}
	}
	system = strings.Replace(system, prompts.ChatAbstainNotice(lang), prompts.ChatAttachmentAbstainNotice(lang), 1)
	system += prompts.ChatAttachmentRules(lang)

	docs := renderDocuments(lang, selected)
	placed := false
	shaped := make([]ai.ChatHistoryEntry, len(history))
	copy(shaped, history)
	for i := range shaped {
		if shaped[i].Role != "ai" && shaped[i].Role != "assistant" && strings.TrimSpace(shaped[i].Content) != "" {
			shaped[i].Content = docs + "\n\n" + shaped[i].Content
			placed = true
			break
		}
	}

	var b strings.Builder
	if !placed {
		b.WriteString(docs)
		b.WriteString("\n\n")
	}
	b.WriteString(prompts.ChatAttachmentSourcesHeading(lang))
	b.WriteString("\n<sources>\n")
	if kbBlock != "" {
		b.WriteString(escapeAttachmentTags(kbBlock))
		b.WriteString(chunkBlockSeparator)
	}
	for i, d := range selected {
		if i > 0 {
			b.WriteString("\n")
		}
		b.WriteString(prompts.ChatAttachmentSourceLine(lang, base+i+1, d.DocID, escapeAttachmentName(d.Name)))
	}
	b.WriteString("\n</sources>\n\n<question>\n")
	b.WriteString(question)
	b.WriteString("\n</question>")
	return system, shaped, b.String()
}

// renderDocuments renders the documents block (Anthropic's long-context
// layout: <documents>/<document>/<source>/<document_content>).
func renderDocuments(lang string, docs []turnDocument) string {
	var b strings.Builder
	b.WriteString(prompts.ChatAttachmentEarlierDocuments(lang))
	b.WriteString("\n<documents>\n")
	for _, d := range docs {
		b.WriteString(`<document id="`)
		b.WriteString(d.DocID)
		b.WriteString("\">\n<source>")
		b.WriteString(escapeAttachmentName(d.Name))
		b.WriteString("</source>\n<document_content>\n")
		b.WriteString(escapeAttachmentTags(d.Text))
		b.WriteString("\n</document_content>\n</document>\n")
	}
	b.WriteString("</documents>")
	return b.String()
}

// attachmentTagRe matches an opening or closing tag of the attachment layout.
// Document and KB text are escaped against it so a document cannot close its
// own block and continue as something the model reads as ours.
var attachmentTagRe = regexp.MustCompile(`(?i)<(/?)(documents|document_content|document|sources|source|question)\b`)

func escapeAttachmentTags(s string) string {
	return attachmentTagRe.ReplaceAllString(s, "&lt;$1$2")
}

var attachmentNameEscaper = strings.NewReplacer("<", "&lt;", ">", "&gt;", `"`, "&quot;")

func escapeAttachmentName(s string) string { return attachmentNameEscaper.Replace(s) }

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

// errAttachmentText marks an attachment whose text cannot be read.
var errAttachmentText = fmt.Errorf("chat attachment: no readable text")

// attachmentText returns uf's parsed text through the library text source
// (parse cache, bounded parse slots, detached timeout).
func (h *Handler) attachmentText(ctx context.Context, uf *userfiles.UserFile) (string, error) {
	if h.libraryText == nil {
		return "", errAttachmentText
	}
	res, err := h.libraryText.Text(ctx, uf)
	if err != nil {
		return "", err
	}
	text := strings.TrimSpace(res.Text)
	if text == "" {
		return "", errAttachmentText
	}
	return text, nil
}

// attachmentLimits is the token budget of one turn's documents.
type attachmentLimits struct {
	budget, window int
	model          string
	cfg            *ai.ResolvedConfig
}

// resolveAttachmentLimits sizes the document budget from the KB answer
// model's context window: the admin-set ai_models.context_window, else the
// window the provider reports (vLLM max_model_len, LiteLLM /model/info;
// cached per provider), else chat_attachments_fallback_context_window.
func (h *Handler) resolveAttachmentLimits(ctx context.Context, kbID string) (attachmentLimits, error) {
	var lim attachmentLimits
	if h.aiResolver == nil {
		return lim, fmt.Errorf("chat attachments: no AI resolver")
	}
	cfg, err := h.aiResolver.Resolve(ctx, kbID)
	if err != nil {
		return lim, fmt.Errorf("chat attachments: resolve model: %w", err)
	}
	lim.cfg = cfg
	lim.model = cfg.ChatModel
	lim.window = cfg.ContextWindow(cfg.ChatModel)
	if lim.window <= 0 {
		lim.window = h.attachTokens.providerWindow(ctx, cfg, cfg.ChatModel)
	}
	if lim.window <= 0 {
		lim.window = ChatAttachmentsFallbackContextWindow(ctx, h.siteConfigReader)
		h.attachTokens.warnFallback(ctx, cfg.ChatModel, lim.window)
	}
	lim.budget = int(float64(lim.window) * ChatAttachmentsContextShare(ctx, h.siteConfigReader))
	return lim, nil
}

// buildTurnDocuments collects the documents of a turn: the earlier
// attachments of the conversation (in conversation order), then the turn's
// new files. Returns nil when there are none. A file whose text cannot be
// read any more is left out and logged.
func (h *Handler) buildTurnDocuments(ctx context.Context, lang string, lim attachmentLimits, earlier []attachedFile, newFiles []newAttachment) *turnDocuments {
	if len(earlier) == 0 && len(newFiles) == 0 {
		return nil
	}

	td := &turnDocuments{lang: lang, budget: lim.budget, window: lim.window}
	seen := make(map[string]bool, len(earlier)+len(newFiles))
	next := 0
	add := func(uf *userfiles.UserFile, text string, tokens int, isNew bool) {
		next++
		td.all = append(td.all, turnDocument{
			DocID:      fmt.Sprintf("A%d", next),
			UserFileID: uf.ID,
			Name:       uf.Name,
			Text:       text,
			Tokens:     tokens,
			New:        isNew,
		})
	}
	for _, a := range earlier {
		if seen[a.File.ID] {
			continue
		}
		seen[a.File.ID] = true
		text, err := h.attachmentText(ctx, a.File)
		if err != nil {
			logctx.From(ctx).Warn("chat.attachments: earlier attachment unreadable; left out",
				"user_file_id", a.File.ID, "error", err)
			next++ // keep the later ids stable
			continue
		}
		add(a.File, text, h.attachTokens.count(ctx, lim, a.File.ID, text), false)
	}
	for _, n := range newFiles {
		td.newIDs = append(td.newIDs, n.file.ID)
		if seen[n.file.ID] {
			continue
		}
		seen[n.file.ID] = true
		add(n.file, n.text, n.tokens, true)
	}
	return td
}

// newAttachment is a validated attachment of the turn's own question.
type newAttachment struct {
	file   *userfiles.UserFile
	text   string
	tokens int
}

// ---------------------------------------------------------------------------
// Token counting
// ---------------------------------------------------------------------------

const (
	// attachmentTokenCacheSize bounds the per-process count cache.
	attachmentTokenCacheSize = 4096
	// tokenizeRetryAfter is how long a provider without /tokenize is counted
	// with the cl100k estimate before /tokenize is tried again.
	tokenizeRetryAfter = 10 * time.Minute
)

const (
	// providerWindowTTL / providerWindowFailTTL bound how long a provider's
	// reported windows (or a failed lookup) are reused per process.
	providerWindowTTL     = time.Hour
	providerWindowFailTTL = 10 * time.Minute
)

// windowsFunc lists the context windows a provider reports per model. A test
// seam; production asks ai.CachedClient.ModelInfos.
type windowsFunc func(ctx context.Context, cfg *ai.ResolvedConfig) (map[string]int, error)

func providerModelWindows(ctx context.Context, cfg *ai.ResolvedConfig) (map[string]int, error) {
	infos, err := ai.CachedClient(cfg.BaseURL, cfg.APIKey).ModelInfos(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[string]int, len(infos))
	for _, m := range infos {
		if m.ContextWindow > 0 {
			out[m.ID] = m.ContextWindow
		}
	}
	return out, nil
}

type cachedWindows struct {
	windows map[string]int
	until   time.Time
}

// tokenCountFunc counts text with model's own tokenizer (the provider's
// /tokenize). A test seam; production uses ai.CachedClient.
type tokenCountFunc func(ctx context.Context, cfg *ai.ResolvedConfig, model, text string) (int, error)

func providerCountTokens(ctx context.Context, cfg *ai.ResolvedConfig, model, text string) (int, error) {
	return ai.CachedClient(cfg.BaseURL, cfg.APIKey).CountTokens(ctx, model, text)
}

// attachmentTokenCounter counts a document's tokens with the answer model's
// tokenizer where the provider exposes one (vLLM /tokenize), else with the
// cl100k estimate, and remembers the count per (file, model) so a document
// sent on many turns is counted once per process. Bounded: the oldest entry
// goes when the cache is full.
type attachmentTokenCounter struct {
	countFn   tokenCountFunc
	windowsFn windowsFunc
	// windowFlight collapses concurrent lookups of one provider's windows.
	windowFlight singleflight.Group

	mu          sync.Mutex
	counts      map[string]int
	order       []string
	unsupported map[string]time.Time     // provider base URL → retry /tokenize after
	warned      map[string]bool          // models already warned about (no window)
	windows     map[string]cachedWindows // provider base URL → reported windows
	now         func() time.Time
}

func newAttachmentTokenCounter() *attachmentTokenCounter {
	return &attachmentTokenCounter{
		countFn:     providerCountTokens,
		windowsFn:   providerModelWindows,
		windows:     make(map[string]cachedWindows),
		counts:      make(map[string]int),
		unsupported: make(map[string]time.Time),
		warned:      make(map[string]bool),
		now:         time.Now,
	}
}

func (c *attachmentTokenCounter) count(ctx context.Context, lim attachmentLimits, userFileID, text string) int {
	if c == nil {
		return splitter.CountTokens(text)
	}
	key := userFileID + "\x00" + lim.model
	c.mu.Lock()
	if n, ok := c.counts[key]; ok {
		c.mu.Unlock()
		return n
	}
	skip := lim.cfg == nil
	if !skip {
		until, ok := c.unsupported[lim.cfg.BaseURL]
		skip = ok && c.now().Before(until)
	}
	c.mu.Unlock()

	n := 0
	if !skip {
		got, err := c.countFn(ctx, lim.cfg, lim.model, text)
		if err == nil && got > 0 {
			n = got
		} else {
			logctx.From(ctx).Info("chat.attachments: provider token count unavailable; using the cl100k estimate",
				"model", lim.model, "error", err)
			c.mu.Lock()
			c.unsupported[lim.cfg.BaseURL] = c.now().Add(tokenizeRetryAfter)
			c.mu.Unlock()
		}
	}
	if n == 0 {
		n = splitter.CountTokens(text)
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.counts[key]; !ok {
		if len(c.order) >= attachmentTokenCacheSize {
			delete(c.counts, c.order[0])
			c.order = c.order[1:]
		}
		c.order = append(c.order, key)
	}
	c.counts[key] = n
	return n
}

// providerWindow returns the context window the provider reports for model,
// or 0. One lookup per provider per providerWindowTTL; a failed lookup is
// not repeated for providerWindowFailTTL.
func (c *attachmentTokenCounter) providerWindow(ctx context.Context, cfg *ai.ResolvedConfig, model string) int {
	if c == nil || c.windowsFn == nil || cfg == nil {
		return 0
	}
	key := cfg.BaseURL
	c.mu.Lock()
	cached, ok := c.windows[key]
	c.mu.Unlock()
	if ok && c.now().Before(cached.until) {
		return cached.windows[model]
	}
	v, _, _ := c.windowFlight.Do(key, func() (any, error) {
		w, err := c.windowsFn(context.WithoutCancel(ctx), cfg)
		entry := cachedWindows{windows: w, until: c.now().Add(providerWindowTTL)}
		if err != nil {
			logctx.From(ctx).Info("chat.attachments: provider context windows unavailable", "error", err)
			entry = cachedWindows{until: c.now().Add(providerWindowFailTTL)}
		}
		c.mu.Lock()
		c.windows[key] = entry
		c.mu.Unlock()
		return entry.windows, nil
	})
	windows, _ := v.(map[string]int)
	return windows[model]
}

// warnFallback logs once per model and process that the model has no
// configured context window.
func (c *attachmentTokenCounter) warnFallback(ctx context.Context, model string, window int) {
	if c == nil {
		return
	}
	c.mu.Lock()
	seen := c.warned[model]
	c.warned[model] = true
	c.mu.Unlock()
	if !seen {
		logctx.From(ctx).Warn("chat.attachments: answer model has no context window configured; using the fallback",
			"model", model, "fallback_window", window)
	}
}
