package rustparser

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/parser"
)

const (
	// defaultShadowTimeout bounds one background shadow run.
	defaultShadowTimeout = 300 * time.Second
	// maxConcurrentShadow caps how many shadow conversions run at once;
	// beyond the cap the extra runs are skipped, never queued.
	maxConcurrentShadow = 2
)

var (
	// shadowTotal counts shadow runs by outcome: "ok" (shadow succeeded),
	// "error" (shadow failed) and "skipped" (concurrency cap reached).
	shadowTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "rustparser_shadow_total",
			Help: "Shadow parse runs by outcome.",
		},
		[]string{"outcome"},
	)

	// shadowSimilarity is the token-set Jaccard similarity between the
	// primary and the shadow text of one run, in [0,1]. Reviewed after
	// shadow deployment before switching to primary mode.
	shadowSimilarity = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "rustparser_shadow_similarity",
			Help:    "Token-set Jaccard similarity between primary and shadow parse results.",
			Buckets: prometheus.LinearBuckets(0, 0.05, 21),
		},
	)
)

// ShadowParser answers with Primary and, in the background, runs Shadow on
// the same file for offline comparison. The shadow never influences the
// result the caller sees: it runs on a detached context (the caller's
// cancellation must not kill the comparison), under a per-run timeout, and
// at most maxConcurrentShadow runs are in flight — beyond the cap a run is
// skipped and counted rather than queued, so shadow traffic can never back
// up ingestion.
type ShadowParser struct {
	Primary parser.Parser
	Shadow  parser.Parser
	// Timeout bounds one shadow run; 0 uses 300 s.
	Timeout time.Duration
	// Dir, when non-empty, receives one JSON dump per file holding both
	// results in the goldset parsedump shape, so shadow traffic can be
	// scored offline.
	Dir string

	once sync.Once
	sem  chan struct{}
}

// Name passes the primary through: the rest of the app sees the parser it
// already knows.
func (p *ShadowParser) Name() string { return p.Primary.Name() }

// CanParse passes the primary through.
func (p *ShadowParser) CanParse(mimeType, fileName string) bool {
	return p.Primary.CanParse(mimeType, fileName)
}

// Parse returns Primary's result and error unchanged; the shadow run is
// detached.
func (p *ShadowParser) Parse(ctx context.Context, pctx parser.ParseContext) (*parser.ParseResult, error) {
	start := time.Now()
	res, err := p.Primary.Parse(ctx, pctx)
	p.launchShadow(ctx, pctx, res, time.Since(start))
	return res, err
}

// launchShadow starts the detached shadow run, or counts a skip when the
// concurrency cap is already reached. ctx is only used for log context.
func (p *ShadowParser) launchShadow(ctx context.Context, pctx parser.ParseContext, primary *parser.ParseResult, primaryElapsed time.Duration) {
	if p.Shadow == nil {
		return
	}
	p.once.Do(func() { p.sem = make(chan struct{}, maxConcurrentShadow) })
	select {
	case p.sem <- struct{}{}:
	default:
		shadowTotal.WithLabelValues("skipped").Inc()
		return
	}
	timeout := p.Timeout
	if timeout <= 0 {
		timeout = defaultShadowTimeout
	}
	go func() {
		defer func() { <-p.sem }()
		// Detached: the caller's context is spent the moment Primary
		// returned — it must not cap the comparison run.
		sctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		sstart := time.Now()
		sres, serr := p.Shadow.Parse(sctx, pctx)
		sElapsed := time.Since(sstart)
		outcome := shadowOutcome{res: sres, elapsed: sElapsed}
		if serr != nil {
			shadowTotal.WithLabelValues("error").Inc()
			logctx.From(ctx).Warn("rustparser shadow parse failed",
				"fileName", pctx.FileName,
				"error", serr.Error(),
			)
			outcome.err = serr
		} else {
			shadowTotal.WithLabelValues("ok").Inc()
			if primary != nil {
				shadowSimilarity.Observe(jaccard(
					tokenSet(resultText(primary)),
					tokenSet(resultText(sres)),
				))
			}
		}
		p.writeDump(ctx, pctx, primary, primaryElapsed, outcome)
	}()
}

// shadowOutcome is one finished (or failed) shadow run.
type shadowOutcome struct {
	res     *parser.ParseResult
	err     error
	elapsed time.Duration
}

// writeDump writes <Dir>/<sha256(file)>.json holding both results. A
// missing or unwritable file costs the dump only, never the parse.
func (p *ShadowParser) writeDump(ctx context.Context, pctx parser.ParseContext, primary *parser.ParseResult, primaryElapsed time.Duration, sh shadowOutcome) {
	if p.Dir == "" {
		return
	}
	data, err := os.ReadFile(pctx.FilePath)
	if err != nil {
		logctx.From(ctx).Warn("rustparser shadow dump: read file",
			"fileName", pctx.FileName,
			"error", err.Error(),
		)
		return
	}
	sum := sha256.Sum256(data)
	doc := docID(pctx.FileName)
	out := struct {
		Primary *parseDump `json:"primary"`
		Shadow  *parseDump `json:"shadow"`
	}{
		Primary: dumpResult(p.Primary.Name(), doc, primary, primaryElapsed, nil),
		Shadow:  dumpResult(p.Shadow.Name(), doc, sh.res, sh.elapsed, sh.err),
	}
	b, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		logctx.From(ctx).Warn("rustparser shadow dump: encode",
			"fileName", pctx.FileName,
			"error", err.Error(),
		)
		return
	}
	path := filepath.Join(p.Dir, hex.EncodeToString(sum[:])+".json")
	if err := os.WriteFile(path, b, 0o644); err != nil {
		logctx.From(ctx).Warn("rustparser shadow dump: write",
			"path", path,
			"error", err.Error(),
		)
	}
}

// parseDump mirrors goldset's ParseDump (fileparser repo,
// crates/goldset/src/dump.rs) so shadow dumps can be scored with goldset
// without translation.
type parseDump struct {
	Parser     string     `json:"parser"`
	Doc        string     `json:"doc"`
	Text       string     `json:"text"`
	Pages      []dumpPage `json:"pages"`
	IsMarkdown bool       `json:"is_markdown"`
	Degraded   bool       `json:"degraded"`
	Error      *string    `json:"error"`
	ElapsedMS  uint64     `json:"elapsed_ms"`
}

type dumpPage struct {
	PageNumber uint32 `json:"page_number"`
	Text       string `json:"text"`
}

// dumpResult renders one parse result (or failure) in the parsedump shape.
func dumpResult(name, doc string, res *parser.ParseResult, elapsed time.Duration, err error) *parseDump {
	d := &parseDump{
		Parser:    name,
		Doc:       doc,
		ElapsedMS: uint64(elapsed / time.Millisecond),
		// Always an empty array, never null: goldset's serde
		// deserializer reads pages as a sequence and rejects null.
		Pages: []dumpPage{},
	}
	if res != nil {
		d.Text = resultText(res)
		d.IsMarkdown = res.IsMarkdown
		d.Degraded = res.Degraded
		for _, pg := range res.Pages {
			d.Pages = append(d.Pages, dumpPage{PageNumber: uint32(pg.PageNumber), Text: pg.Text})
		}
	}
	if err != nil {
		msg := err.Error()
		d.Error = &msg
	}
	return d
}

// docID is the corpus-style document id for a file: the base name without
// its extension, matching how goldset names its dumps.
func docID(fileName string) string {
	base := filepath.Base(fileName)
	return strings.TrimSuffix(base, filepath.Ext(base))
}

// resultText is the full document text of a parse result: the joined pages
// when the parser knows them, otherwise the single Text blob.
func resultText(res *parser.ParseResult) string {
	if res == nil {
		return ""
	}
	if len(res.Pages) == 0 {
		return res.Text
	}
	var sb strings.Builder
	for i, pg := range res.Pages {
		if i > 0 {
			sb.WriteString("\n\n")
		}
		sb.WriteString(pg.Text)
	}
	return sb.String()
}

// tokenSet is the normalized text's word set: lowercased, whitespace-split.
func tokenSet(text string) map[string]struct{} {
	set := make(map[string]struct{})
	for _, field := range strings.Fields(strings.ToLower(text)) {
		set[field] = struct{}{}
	}
	return set
}

// jaccard is |A∩B|/|A∪B| over token sets; two empty texts are identical.
func jaccard(a, b map[string]struct{}) float64 {
	if len(a) == 0 && len(b) == 0 {
		return 1
	}
	smaller, larger := a, b
	if len(smaller) > len(larger) {
		smaller, larger = larger, smaller
	}
	inter := 0
	for k := range smaller {
		if _, ok := larger[k]; ok {
			inter++
		}
	}
	return float64(inter) / float64(len(a)+len(b)-inter)
}
