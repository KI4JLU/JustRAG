package authhandler

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

// recordingExec answers each statement with the scripted error, in order, and
// records which tables the statements touched.
type recordingExec struct {
	errs  []error
	stmts []string
}

func (r *recordingExec) Exec(_ context.Context, sql string, _ ...any) (pgconn.CommandTag, error) {
	i := len(r.stmts)
	r.stmts = append(r.stmts, sql)
	if i < len(r.errs) {
		return pgconn.CommandTag{}, r.errs[i]
	}
	return pgconn.CommandTag{}, nil
}

func TestApplyPendingInvites_BothStatementsAreAttempted(t *testing.T) {
	kbErr, glossaryErr := errors.New("kb boom"), errors.New("glossary boom")
	tests := []struct {
		name    string
		errs    []error
		wantErr []error // every one must be in the returned error; none means nil
	}{
		{"both succeed", nil, nil},
		{"the KB statement fails: the glossary one is still attempted", []error{kbErr, nil}, []error{kbErr}},
		{"the glossary statement fails", []error{nil, glossaryErr}, []error{glossaryErr}},
		{"both fail: both are reported", []error{kbErr, glossaryErr}, []error{kbErr, glossaryErr}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			db := &recordingExec{errs: tc.errs}
			err := applyPendingInvites(context.Background(), db, "u1", "Alice")
			if len(db.stmts) != 2 {
				t.Fatalf("statements run = %d, want 2 (KB then glossary)", len(db.stmts))
			}
			if !strings.Contains(db.stmts[0], "pending_kb_invites") || !strings.Contains(db.stmts[1], "glossary_pending_invites") {
				t.Errorf("statement order wrong: %q then %q", db.stmts[0], db.stmts[1])
			}
			if len(tc.wantErr) == 0 {
				if err != nil {
					t.Fatalf("err = %v, want nil", err)
				}
				return
			}
			for _, want := range tc.wantErr {
				if !errors.Is(err, want) {
					t.Errorf("err = %v, want it to carry %v", err, want)
				}
			}
		})
	}
}
