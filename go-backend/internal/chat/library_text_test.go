package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/justrag/go-backend/internal/libpaths"
	"github.com/justrag/go-backend/internal/parser"
	"github.com/justrag/go-backend/internal/storage"
	"github.com/justrag/go-backend/internal/userfiles"
)

type degradedParser struct{}

func (degradedParser) Name() string              { return "degraded" }
func (degradedParser) CanParse(_, f string) bool { return f == "d.degr" }
func (degradedParser) Parse(context.Context, parser.ParseContext) (*parser.ParseResult, error) {
	return &parser.ParseResult{Text: "fallback", Degraded: true}, nil
}

func libFixture(t *testing.T, name, body string) (*LibraryTextSource, storage.Storage, *userfiles.UserFile) {
	t.Helper()
	stor, err := storage.New(storage.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	f := parser.DefaultFactoryWith(nil, degradedParser{})
	uf := &userfiles.UserFile{ID: "uf1", OwnerUserID: "u1", Name: name, Mime: "text/plain", StoragePath: "users/u1/blob-" + name}
	if err := stor.StoreFile(context.Background(), uf.StoragePath, []byte(body), "text/plain"); err != nil {
		t.Fatal(err)
	}
	return NewLibraryTextSource(stor, f), stor, uf
}

func TestLibraryTextSource_CachesAndServesFromCache(t *testing.T) {
	ctx := context.Background()
	s, stor, uf := libFixture(t, "a.txt", "hello library")
	res, err := s.Text(ctx, uf)
	if err != nil || res.Text == "" {
		t.Fatalf("first: %v %+v", err, res)
	}
	key := libpaths.ChatTextKey("u1", "uf1")
	if ok, _ := stor.FileExists(ctx, key); !ok {
		t.Fatal("cache object not written at ChatTextKey")
	}
	if err := stor.DeleteFile(ctx, uf.StoragePath); err != nil {
		t.Fatal(err)
	}
	res2, err := s.Text(ctx, uf)
	if err != nil || res2.Text != res.Text {
		t.Fatalf("second should hit cache: %v %+v", err, res2)
	}
}

func TestLibraryTextSource_DegradedNotCached(t *testing.T) {
	ctx := context.Background()
	s, stor, uf := libFixture(t, "d.degr", "x")
	res, err := s.Text(ctx, uf)
	if err != nil || !res.Degraded {
		t.Fatalf("got %v %+v", err, res)
	}
	if ok, _ := stor.FileExists(ctx, libpaths.ChatTextKey("u1", "uf1")); ok {
		t.Fatal("degraded result must not be cached")
	}
}

func TestLibraryTextSource_Unparseable(t *testing.T) {
	// The default factory ends in a catch-all TextParser, so "no parser" needs
	// an empty factory.
	s, _, uf := libFixture(t, "a.bin", "x")
	s.factory = parser.NewFactory()
	if _, err := s.Text(context.Background(), uf); !errors.Is(err, ErrUnparseable) {
		t.Fatalf("no parser: want ErrUnparseable, got %v", err)
	}
}

func TestLibraryTextSource_MissingBlobIsOrdinaryError(t *testing.T) {
	s, stor, uf := libFixture(t, "a.txt", "x")
	_ = stor.DeleteFile(context.Background(), uf.StoragePath)
	_, err := s.Text(context.Background(), uf)
	if err == nil || errors.Is(err, ErrUnparseable) {
		t.Fatalf("want ordinary error, got %v", err)
	}
}

type failParser struct{}

func (failParser) Name() string              { return "fail" }
func (failParser) CanParse(_, f string) bool { return f == "f.fail" }
func (failParser) Parse(context.Context, parser.ParseContext) (*parser.ParseResult, error) {
	return nil, errors.New("secret internal detail")
}

func TestLibraryTextSource_ParserFailureIsBareSentinel(t *testing.T) {
	stor, _ := storage.New(storage.Config{DataDir: t.TempDir()})
	uf := &userfiles.UserFile{ID: "uf1", OwnerUserID: "u1", Name: "f.fail", Mime: "x/y", StoragePath: "b"}
	_ = stor.StoreFile(context.Background(), "b", []byte("x"), "x/y")
	s := NewLibraryTextSource(stor, parser.DefaultFactoryWith(nil, failParser{}))
	_, err := s.Text(context.Background(), uf)
	if err != ErrUnparseable {
		t.Fatalf("want bare ErrUnparseable, got %v", err)
	}
}

func TestLibraryTextSource_CanceledContextIsOrdinaryError(t *testing.T) {
	s, _, uf := libFixture(t, "a.txt", "x")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := s.Text(ctx, uf)
	if err == nil || errors.Is(err, ErrUnparseable) {
		t.Fatalf("want ordinary error, got %v", err)
	}
}

func TestLibraryTextSource_CorruptCacheReparsesAndOverwrites(t *testing.T) {
	ctx := context.Background()
	s, stor, uf := libFixture(t, "a.txt", "fresh")
	key := libpaths.ChatTextKey("u1", "uf1")
	_ = stor.StoreFile(ctx, key, []byte("{garbage"), "application/json")
	res, err := s.Text(ctx, uf)
	if err != nil || res.Text != "fresh" {
		t.Fatalf("got %v %+v", err, res)
	}
	raw, _ := stor.ReadFile(ctx, key)
	if string(raw) == "{garbage" {
		t.Fatal("corrupt cache not overwritten")
	}
}

func TestChatTextKey(t *testing.T) {
	if got := libpaths.ChatTextKey("o", "f"); got != libpaths.ParseCacheDir("o", "f")+"chat-text.json" {
		t.Fatal(got)
	}
}
