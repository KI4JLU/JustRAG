//go:build integration

package chat

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/adkbridge"
	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/kbaccess"
	"github.com/justrag/go-backend/internal/usage"
	"github.com/justrag/go-backend/internal/vector"
)

var agentChatSchemaSeq atomic.Int64

// agentChatPool returns a pool on a fresh schema holding schema-local stubs
// of the chat tables (chats, messages, message_chunks, usage_events,
// knowledge_bases) plus the real ADK session and run migrations. The stubs
// shadow public's tables via search_path, so nothing is written to (or
// cascaded through) the shared chat tables other test binaries use. Only
// users stays public: agent_runs references it.
func agentChatPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	host, port, name := os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_NAME")
	if host == "" || port == "" || name == "" {
		t.Skip("agent chat integration tests require DB_* env (main Postgres)")
	}
	base := fmt.Sprintf("postgres://%s:%s@%s:%s/%s",
		url.QueryEscape(os.Getenv("DB_USER")), url.QueryEscape(os.Getenv("DB_PASSWORD")), host, port, name)
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, base)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	schema := fmt.Sprintf("agentchat_test_%d_%d", time.Now().UnixNano(), agentChatSchemaSeq.Add(1))
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatalf("create schema: %v", err)
	}
	cfg, err := pgxpool.ParseConfig(base)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})
	const stubs = `
CREATE TABLE knowledge_bases (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
CREATE TABLE chats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kb_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    title text NOT NULL,
    type text NOT NULL DEFAULT 'chat',
    team_id uuid, agent_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    parent_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
    role text NOT NULL, content text NOT NULL, sources jsonb,
    is_enhanced boolean NOT NULL DEFAULT false, enhanced_query text, reasoning text,
    feedback text, feedback_comment text, feedback_updated_at timestamptz,
    verification jsonb, trace_id text, structured_table jsonb, conflicts jsonb,
    team_id uuid, agent_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE message_chunks (
    message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    chunk_id uuid NOT NULL, kb_id uuid, position int,
    PRIMARY KEY (message_id, chunk_id));
CREATE TABLE usage_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kb_id uuid, user_id uuid, api_key_id uuid, surface text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now());`
	if _, err := pool.Exec(ctx, stubs); err != nil {
		t.Fatalf("create stubs: %v", err)
	}
	for _, m := range []string{"0082_adk_sessions.sql", "0083_agent_runs.sql"} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "migrations", "main", m))
		if err != nil {
			t.Fatalf("read %s: %v", m, err)
		}
		up := strings.SplitN(string(raw), "-- +goose Down", 2)[0]
		for attempt := 1; ; attempt++ {
			_, err := pool.Exec(ctx, up)
			var pgErr *pgconn.PgError
			if err != nil && attempt < 5 && errors.As(err, &pgErr) && pgErr.Code == "40P01" {
				time.Sleep(time.Duration(attempt) * 50 * time.Millisecond)
				continue
			}
			if err != nil {
				t.Fatalf("apply %s: %v", m, err)
			}
			break
		}
	}
	return pool
}

// agentChatUser inserts a public.users row (agent_runs references it).
func agentChatUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`, id, "agentchat-test-"+id); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, id) })
	return id
}

type mapReader map[string]string

func (m mapReader) GetSiteConfigValue(_ context.Context, key string) (*string, error) {
	if v, ok := m[key]; ok {
		return &v, nil
	}
	return nil, nil
}

type mapOverrides map[string]map[string]*string

func (m mapOverrides) ListKBOverrides(_ context.Context, kbID string) (map[string]*string, error) {
	return m[kbID], nil
}

type agentChatFixture struct {
	pool    *pgxpool.Pool
	store   *PGStore
	srv     *httptest.Server
	kbID    string
	userA   string
	userB   string
	client  *agentFakeClient
	library *fakeLibrary
	chunks  []vector.SearchChunk // what every retrieval returns
}

func newAgentChatFixture(t *testing.T, flagOn bool) *agentChatFixture {
	t.Helper()
	pool := agentChatPool(t)
	f := &agentChatFixture{pool: pool, store: NewStore(pool), client: &agentFakeClient{}, library: &fakeLibrary{},
		userA: agentChatUser(t, pool), userB: agentChatUser(t, pool)}
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO knowledge_bases (name) VALUES ('agentchat') RETURNING id::text`).Scan(&f.kbID); err != nil {
		t.Fatalf("seed kb: %v", err)
	}
	overrides := mapOverrides{}
	if flagOn {
		on := "true"
		overrides[f.kbID] = map[string]*string{"chat_agent_chat_enabled": &on}
	}
	h := NewAgentChatHandler(AgentChatDeps{
		Store:      f.store,
		SiteConfig: mapReader{},
		KBConfig:   overrides,
		Sessions:   adkbridge.NewPGSessionService(pool),
		Runs:       adkbridge.NewRunStore(pool, time.Hour),
		Usage:      usage.NewRecorder(pool),
		Library:    f.library,
		modelFor: func(context.Context, string) (*adkbridge.Model, error) {
			return adkbridge.NewModel(f.client, "m"), nil
		},
		prepare: func(_ context.Context, p ChatContextParams) (*ChatContext, error) {
			sources, text := buildChatSourcesAndContext(f.chunks)
			return &ChatContext{SystemPrompt: "SYSTEM\n\nCONTEXT:\n" + text, Sources: sources, Context: text, FinalChunks: f.chunks}, nil
		},
	})
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Stands in for authMw + kbaccess.RequireKBRole(view).
		ctx := auth.WithUser(r.Context(), &auth.Claims{ID: r.Header.Get("X-Test-User")})
		ctx = kbaccess.WithAccess(ctx, &kbaccess.KBAccessResult{KB: &kbaccess.KnowledgeBase{ID: f.kbID}, Role: "edit"})
		h.ServeHTTP(w, r.WithContext(ctx))
	}))
	t.Cleanup(f.srv.Close)
	return f
}

// post sends body as user and returns the status and the SSE data events.
func (f *agentChatFixture) post(t *testing.T, user string, body map[string]any) (int, []map[string]any) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, f.srv.URL, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Test-User", user)
	resp, err := f.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var evs []map[string]any
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var ev map[string]any
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &ev); err != nil {
			t.Fatalf("bad SSE data %q: %v", line, err)
		}
		evs = append(evs, ev)
	}
	return resp.StatusCode, evs
}

func agentUserMsg(thread, text string) map[string]any {
	return map[string]any{"threadId": thread, "runId": uuid.NewString(),
		"messages": []map[string]any{{"id": uuid.NewString(), "role": "user", "content": text}}}
}

func eventOf(evs []map[string]any, typ string) map[string]any {
	for _, ev := range evs {
		if ev["type"] == typ {
			return ev
		}
	}
	return nil
}

func customOf(evs []map[string]any, name string) map[string]any {
	for _, ev := range evs {
		if ev["type"] == "CUSTOM" && ev["name"] == name {
			v, _ := ev["value"].(map[string]any)
			return v
		}
	}
	return nil
}

type storedMessage struct {
	id, role, content string
	parent            *string
	sources           []byte
}

func (f *agentChatFixture) messages(t *testing.T, chatID string) []storedMessage {
	t.Helper()
	rows, err := f.pool.Query(context.Background(),
		`SELECT id::text, role, content, parent_message_id::text, sources FROM messages WHERE chat_id=$1 ORDER BY created_at`, chatID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []storedMessage
	for rows.Next() {
		var m storedMessage
		if err := rows.Scan(&m.id, &m.role, &m.content, &m.parent, &m.sources); err != nil {
			t.Fatal(err)
		}
		out = append(out, m)
	}
	return out
}

func (f *agentChatFixture) count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// waitCount polls for an asynchronously written row count (usage ledger).
func (f *agentChatFixture) waitCount(t *testing.T, want int, sql string, args ...any) int {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		n := f.count(t, sql, args...)
		if n >= want || time.Now().After(deadline) {
			return n
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func (f *agentChatFixture) runStatus(t *testing.T, thread string) string {
	t.Helper()
	var s string
	if err := f.pool.QueryRow(context.Background(),
		`SELECT status FROM agent_runs WHERE thread_id=$1 ORDER BY created_at DESC LIMIT 1`, thread).Scan(&s); err != nil {
		t.Fatalf("run status: %v", err)
	}
	return s
}

var agentChunk = []vector.SearchChunk{{ID: "6f2c0b8e-0000-4000-8000-000000000001", FileID: "f1", FileName: "mensa.pdf",
	Content: "Die Mensa öffnet um 11 Uhr.", Score: 0.9}}

func TestEndpointHiddenWhenFlagOff(t *testing.T) {
	f := newAgentChatFixture(t, false)
	f.chunks = agentChunk
	f.client.turns = [][]ai.StreamChunk{agentTextTurn("Um 11 Uhr [1].")}
	code, _ := f.post(t, f.userA, agentUserMsg("", "Wann öffnet die Mensa?"))
	if code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", code)
	}
	if n := f.count(t, `SELECT count(*) FROM chats`); n != 0 {
		t.Fatalf("chats = %d, want 0", n)
	}
	if n := len(f.client.requests()); n != 0 {
		t.Fatalf("model calls = %d, want 0", n)
	}
	if n := f.count(t, `SELECT count(*) FROM agent_runs`); n != 0 {
		t.Fatalf("runs = %d, want 0", n)
	}
}

func TestNewThreadCreatesChatAndPersistsBothMessages(t *testing.T) {
	f := newAgentChatFixture(t, true)
	f.chunks = agentChunk
	f.client.turns = [][]ai.StreamChunk{agentTextTurn("Um 11 Uhr [1].")}
	code, evs := f.post(t, f.userA, agentUserMsg("", "Wann öffnet die Mensa?"))
	if code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	started := eventOf(evs, "RUN_STARTED")
	if started == nil {
		t.Fatalf("no RUN_STARTED in %v", evs)
	}
	thread, _ := started["threadId"].(string)
	chat, err := f.store.GetChatByID(context.Background(), thread)
	if err != nil || chat == nil {
		t.Fatalf("chat %q not created: %v", thread, err)
	}
	if chat.UserID != f.userA || chat.KbID != f.kbID || chat.Title != "Wann öffnet die Mensa?" {
		t.Fatalf("chat = %+v", chat)
	}
	msgs := f.messages(t, thread)
	if len(msgs) != 2 || msgs[0].role != "user" || msgs[1].role != "ai" {
		t.Fatalf("messages = %+v", msgs)
	}
	if msgs[0].content != "Wann öffnet die Mensa?" || msgs[0].parent != nil {
		t.Fatalf("user message = %+v", msgs[0])
	}
	if msgs[1].content != "Um 11 Uhr [1]." || msgs[1].parent == nil || *msgs[1].parent != msgs[0].id {
		t.Fatalf("ai message = %+v", msgs[1])
	}
	var sources []map[string]any
	if err := json.Unmarshal(msgs[1].sources, &sources); err != nil || len(sources) != 1 || sources[0]["fileName"] != "mensa.pdf" {
		t.Fatalf("ai sources = %s (%v)", msgs[1].sources, err)
	}
	m := customOf(evs, MessageEvent)
	if m == nil || m["aiMessageId"] != msgs[1].id || m["chatId"] != thread {
		t.Fatalf("%s = %v, want aiMessageId %s", MessageEvent, m, msgs[1].id)
	}
	if n := f.waitCount(t, 1, `SELECT count(*) FROM usage_events WHERE kb_id=$1 AND user_id=$2 AND surface='web'`, f.kbID, f.userA); n != 1 {
		t.Fatalf("usage_events = %d, want 1", n)
	}

	// A follow-up on the same thread chains to the previous answer.
	f.client.turns = [][]ai.StreamChunk{agentTextTurn("Bis 14 Uhr [1].")}
	if code, _ := f.post(t, f.userA, agentUserMsg(thread, "Und wie lange?")); code != http.StatusOK {
		t.Fatalf("follow-up status = %d", code)
	}
	msgs = f.messages(t, thread)
	if len(msgs) != 4 || msgs[2].parent == nil || *msgs[2].parent != msgs[1].id {
		t.Fatalf("follow-up messages = %+v", msgs)
	}
	if n := f.count(t, `SELECT count(*) FROM chats`); n != 1 {
		t.Fatalf("chats = %d, want 1", n)
	}
}

func TestThreadOfOtherUserIs404(t *testing.T) {
	f := newAgentChatFixture(t, true)
	f.chunks = agentChunk
	other, err := f.store.CreateChat(context.Background(), f.kbID, f.userB, "B's chat")
	if err != nil {
		t.Fatal(err)
	}
	for _, thread := range []string{other.ID, uuid.NewString(), "not-a-uuid"} {
		code, _ := f.post(t, f.userA, agentUserMsg(thread, "Hallo?"))
		if code != http.StatusNotFound {
			t.Fatalf("thread %q: status = %d, want 404", thread, code)
		}
	}
	if n := f.count(t, `SELECT count(*) FROM messages`); n != 0 {
		t.Fatalf("messages = %d, want 0", n)
	}
	if n := f.count(t, `SELECT count(*) FROM adk_sessions`); n != 0 {
		t.Fatalf("sessions = %d, want 0", n)
	}
	if n := len(f.client.requests()); n != 0 {
		t.Fatalf("model calls = %d, want 0", n)
	}
}

func TestAnswerFailurePersistsUserMessageOnly(t *testing.T) {
	f := newAgentChatFixture(t, true)
	f.chunks = agentChunk
	f.client.err = errors.New("provider exploded: secret detail")
	code, evs := f.post(t, f.userA, agentUserMsg("", "Wann öffnet die Mensa?"))
	if code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	runErr := eventOf(evs, "RUN_ERROR")
	if runErr == nil || runErr["message"] != "run failed" {
		t.Fatalf("RUN_ERROR = %v", runErr)
	}
	thread, _ := eventOf(evs, "RUN_STARTED")["threadId"].(string)
	msgs := f.messages(t, thread)
	if len(msgs) != 1 || msgs[0].role != "user" {
		t.Fatalf("messages = %+v, want the user message only", msgs)
	}
	if s := f.runStatus(t, thread); s != string(adkbridge.RunFailed) {
		t.Fatalf("run status = %s", s)
	}
	if customOf(evs, MessageEvent) != nil {
		t.Fatalf("unexpected %s event", MessageEvent)
	}
}

func TestDeadEndPausesAndResumeAddsLibraryFile(t *testing.T) {
	f := newAgentChatFixture(t, true)
	f.chunks = nil // no evidence
	code, evs := f.post(t, f.userA, agentUserMsg("", "Wie hoch ist das Budget?"))
	if code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	thread, _ := eventOf(evs, "RUN_STARTED")["threadId"].(string)
	finished := eventOf(evs, "RUN_FINISHED")
	outcome, _ := finished["outcome"].(map[string]any)
	list, _ := outcome["interrupts"].([]any)
	if len(list) != 1 {
		t.Fatalf("interrupts = %v (events %v)", outcome, evs)
	}
	intr, _ := list[0].(map[string]any)
	payload, _ := intr["metadata"].(map[string]any)
	var ids []string
	for _, a := range payload["actions"].([]any) {
		ids = append(ids, a.(map[string]any)["id"].(string))
	}
	if strings.Join(ids, ",") != "library,upload" {
		t.Fatalf("offered = %v, want library,upload (no web: no registry wired)", ids)
	}
	if msgs := f.messages(t, thread); len(msgs) != 1 || msgs[0].role != "user" {
		t.Fatalf("after pause: messages = %+v", msgs)
	}

	code, evs = f.post(t, f.userA, map[string]any{"threadId": thread, "runId": uuid.NewString(), "messages": []any{},
		"resume": []map[string]any{{"interruptId": intr["id"], "status": "resolved",
			"payload": map[string]any{"actionId": "library", "args": map[string]any{"userFileIds": []string{"f1"}}}}}})
	if code != http.StatusOK {
		t.Fatalf("resume status = %d", code)
	}
	if len(f.library.calls) != 1 {
		t.Fatalf("library calls = %+v", f.library.calls)
	}
	call := f.library.calls[0]
	if call.userID != f.userA || call.kbID != f.kbID || strings.Join(call.ids, ",") != "f1" {
		t.Fatalf("library call = %+v", call)
	}
	msgs := f.messages(t, thread)
	if len(msgs) != 2 || msgs[1].role != "ai" || msgs[1].content != libraryAddedText {
		t.Fatalf("messages = %+v", msgs)
	}
	if msgs[1].parent == nil || *msgs[1].parent != msgs[0].id {
		t.Fatalf("ai parent = %v, want %s", msgs[1].parent, msgs[0].id)
	}
	if m := customOf(evs, MessageEvent); m == nil || m["aiMessageId"] != msgs[1].id {
		t.Fatalf("%s = %v", MessageEvent, m)
	}
	if n := len(f.client.requests()); n != 0 {
		t.Fatalf("model calls = %d, want 0", n)
	}
}
