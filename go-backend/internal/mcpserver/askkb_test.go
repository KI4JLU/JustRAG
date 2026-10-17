package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/kbaccess"
)

// accessCtx is the context RequireKBRole hands the handler: the key owner's
// resolved role on a KB with the given source flags.
func accessCtx(role string, flags kbaccess.SourcePermissions) context.Context {
	return kbaccess.WithAccess(context.Background(), &kbaccess.KBAccessResult{
		KB: &kbaccess.KnowledgeBase{ID: "kb-123", Sources: flags}, Role: role,
	})
}

type fakeAnswerer struct {
	gotKB, gotQuestion, gotLang string
	result                      AnswerResult
	err                         error
}

func (f *fakeAnswerer) Answer(_ context.Context, kbID, question, language string) (AnswerResult, error) {
	f.gotKB, f.gotQuestion, f.gotLang = kbID, question, language
	return f.result, f.err
}

func TestRunAskKB_Success(t *testing.T) {
	fa := &fakeAnswerer{result: AnswerResult{
		Answer:  "the answer",
		Sources: []Source{{Index: 1, FileID: "f1", FileName: "doc.pdf", Score: 0.9}},
	}}
	res, err := runAskKB(accessCtx(kbaccess.RoleAdmin, kbaccess.SourcePermissions{}), fa, "kb-123", json.RawMessage(`{"question":"q?","language":"en"}`))
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if fa.gotKB != "kb-123" {
		t.Errorf("kbID = %q, want kb-123 (must come from path, not params)", fa.gotKB)
	}
	if fa.gotQuestion != "q?" || fa.gotLang != "en" {
		t.Errorf("question/lang = %q/%q", fa.gotQuestion, fa.gotLang)
	}
	if res.IsError {
		t.Errorf("IsError = true, want false")
	}
	if len(res.Content) != 1 || res.Content[0].Type != "text" || res.Content[0].Text != "the answer" {
		t.Errorf("content = %+v", res.Content)
	}
	var sc struct {
		Sources []Source `json:"sources"`
	}
	if err := json.Unmarshal(res.StructuredContent, &sc); err != nil {
		t.Fatalf("structuredContent unmarshal: %v", err)
	}
	if len(sc.Sources) != 1 || sc.Sources[0].FileName != "doc.pdf" {
		t.Errorf("sources = %+v", sc.Sources)
	}
}

func TestRunAskKB_MissingQuestion(t *testing.T) {
	_, err := runAskKB(context.Background(), &fakeAnswerer{}, "kb-1", json.RawMessage(`{"language":"de"}`))
	if err == nil {
		t.Fatal("err = nil, want invalid-params error")
	}
}

func TestRunAskKB_PipelineError(t *testing.T) {
	fa := &fakeAnswerer{err: errors.New("boom")}
	res, err := runAskKB(context.Background(), fa, "kb-1", json.RawMessage(`{"question":"q?"}`))
	if err != nil {
		t.Fatalf("err should be nil (pipeline failure is reported via IsError), got %v", err)
	}
	if !res.IsError {
		t.Error("IsError = false, want true")
	}
	if len(res.Content) == 0 {
		t.Error("expected an error text block")
	}
}

func TestRunAskKB_DefaultLanguage(t *testing.T) {
	fa := &fakeAnswerer{}
	if _, err := runAskKB(context.Background(), fa, "kb-1", json.RawMessage(`{"question":"q?"}`)); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if fa.gotLang != "de" {
		t.Errorf("default lang = %q, want de", fa.gotLang)
	}
}

// A key owner without seeCitations gets ask_kb's answer without sources and
// without [n] markers; with the flag, or as KB admin, both stay. Oracle: the
// tool result's JSON, searched for the file name and the marker.
func TestRunAskKB_CitationVisibility(t *testing.T) {
	cases := []struct {
		name    string
		ctx     context.Context
		visible bool
	}{
		{"viewer, flag off", accessCtx(kbaccess.RoleView, kbaccess.SourcePermissions{}), false},
		{"viewer, flag on", accessCtx(kbaccess.RoleView, kbaccess.SourcePermissions{ViewerSeeCitations: true}), true},
		{"admin, flags off", accessCtx(kbaccess.RoleAdmin, kbaccess.SourcePermissions{}), true},
		{"no access result", context.Background(), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			fa := &fakeAnswerer{result: AnswerResult{
				Answer:  "Die Frist beträgt 3 Tage [1].",
				Sources: []Source{{Index: 1, FileID: "f1", FileName: "geheim.pdf"}},
			}}
			res, err := runAskKB(c.ctx, fa, "kb-123", json.RawMessage(`{"question":"q?"}`))
			if err != nil {
				t.Fatal(err)
			}
			wire, _ := json.Marshal(res)
			leaks := strings.Contains(string(wire), "geheim.pdf") || strings.Contains(res.Content[0].Text, "[1]")
			if leaks != c.visible {
				t.Fatalf("visible = %v, want %v: %s", leaks, c.visible, wire)
			}
			if !c.visible && (res.Content[0].Text != "Die Frist beträgt 3 Tage." || !strings.Contains(string(res.StructuredContent), `"sources":[]`)) {
				t.Fatalf("hidden result = %s", wire)
			}
		})
	}
}
