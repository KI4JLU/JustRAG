package chat

import (
	"context"
	"fmt"
	"strings"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/parser"
	"github.com/justrag/go-backend/internal/prompts"
	"github.com/justrag/go-backend/internal/splitter"
	"github.com/justrag/go-backend/internal/vector"
)

// libraryChunkTokens is the per-chunk budget library pages are pre-split to,
// so a single huge page cannot dominate a map group and TruncateChunksToFit
// never has a whole page to drop (P3-R3).
const libraryChunkTokens = 1500

// LibraryFile is one selected library file with its parsed text.
type LibraryFile struct {
	UserFileID string
	Name       string
	Parsed     *parser.ParseResult
}

// LibraryContextParams is the input of BuildLibraryContext.
type LibraryContextParams struct {
	Files           []LibraryFile
	Query           string
	Language        string
	CurrentDateLine string
	Emit            func(map[string]any) // trajectory events, may be nil
}

// ErrLibraryTooLarge reports that the selected files exceed even the
// long-context budget. Nothing is silently truncated.
type ErrLibraryTooLarge struct{ Tokens, Max int }

func (e *ErrLibraryTooLarge) Error() string {
	return fmt.Sprintf("selected files are too large for one chat turn (%d tokens, maximum %d)", e.Tokens, e.Max)
}

// BuildLibraryContext turns the selected files' parsed text into a
// *ChatContext for a KB-less chat turn: full text when it fits
// chat_library_fulltext_max_tokens, the map_reduce long-context consumer when
// it fits chat_longcontext_max_tokens, else *ErrLibraryTooLarge.
func BuildLibraryContext(ctx context.Context, resolver *ai.ConfigResolver, cfg SiteConfigReader, p LibraryContextParams) (*ChatContext, error) {
	return buildLibraryContextWith(ctx, resolver, ai.ExtractLongContextFindings, cfg, p)
}

// buildLibraryContextWith is the testable core; extract may be nil when the
// map_reduce path is not expected.
func buildLibraryContextWith(ctx context.Context, resolver *ai.ConfigResolver, extract extractFindingsFn, cfg SiteConfigReader, p LibraryContextParams) (*ChatContext, error) {
	chunks, owners, total := libraryChunks(p.Files)
	if len(chunks) == 0 {
		return nil, fmt.Errorf("library: the selected files contain no text")
	}

	notice := prompts.LibraryNotice(p.Language)
	var cc *ChatContext
	var err error
	switch fullMax, lcMax := ChatLibraryFulltextMaxTokens(ctx, cfg), ChatLongContextMaxTokens(ctx, cfg); {
	case total <= fullMax:
		sources, text := buildChatSourcesAndContext(chunks)
		cc = &ChatContext{
			SystemPrompt: prompts.ChatSystemPromptWithDate(p.Language, p.CurrentDateLine) +
				"\n\n" + notice + "\n\nCONTEXT:\n" + text,
			Sources:     sources,
			Context:     text,
			FinalChunks: chunks,
		}
	case total <= lcMax:
		lp := resolveLongContextParams(ctx, cfg, LongContextParams{
			Query:           p.Query,
			Language:        p.Language,
			KbSystemPrompt:  notice,
			CurrentDateLine: p.CurrentDateLine,
			Mode:            LongContextModeMapReduce,
			MaxTokens:       lcMax,
			Emit:            p.Emit,
		})
		cc, err = consumeLongContextWith(ctx, resolver, extract, lp, chunks)
		if err != nil {
			return nil, err
		}
	default:
		return nil, &ErrLibraryTooLarge{Tokens: total, Max: lcMax}
	}

	// Sources number the chunks in input order (nothing is truncated), so
	// source i maps back to owners[i].
	for i := range cc.Sources {
		if i < len(owners) {
			cc.Sources[i].UserFileID = owners[i]
		}
		cc.Sources[i].FileID = ""
	}
	for i := range cc.FinalChunks {
		cc.FinalChunks[i].FileID = ""
	}
	return cc, nil
}

// libraryChunks renders the files as synthetic page chunks in selection
// order (descending score keeps that order), splitting pages above
// libraryChunkTokens. owners[i] is chunk i's UserFileID; total is the summed
// token count of the chunk bodies.
func libraryChunks(files []LibraryFile) (chunks []vector.SearchChunk, owners []string, total int) {
	cfg := splitter.DefaultConfig()
	cfg.ChunkSize = libraryChunkTokens
	cfg.ChunkOverlap = 0

	add := func(f LibraryFile, page int, text string) {
		text = strings.TrimSpace(text)
		if text == "" {
			return
		}
		parts := []string{text}
		if splitter.CountTokens(text) > libraryChunkTokens {
			parts = splitter.Split(text, cfg)
		}
		for _, part := range parts {
			c := vector.SearchChunk{Content: part, FileName: f.Name}
			if page > 0 {
				c.Metadata = map[string]any{"pages": []int{page}}
			}
			chunks = append(chunks, c)
			owners = append(owners, f.UserFileID)
			total += splitter.CountTokens(part)
		}
	}
	for _, f := range files {
		if f.Parsed == nil {
			continue
		}
		if len(f.Parsed.Pages) > 0 {
			for _, pg := range f.Parsed.Pages {
				add(f, pg.PageNumber, pg.Text)
			}
		} else {
			add(f, 0, f.Parsed.Text)
		}
	}
	n := float64(len(chunks))
	for i := range chunks {
		chunks[i].Score = 1 - float64(i)/(n+1)
	}
	return chunks, owners, total
}
