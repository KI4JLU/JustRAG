package chat

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/uploadcheck"
)

// TestAttachmentTextError pins the upload / send refusal per text-read
// verdict. Oracle: the error-case list in docs/user-error-messages.md — a
// format no parser handles is "not supported" (415), a supported file that
// cannot be read is "could not be read" (422), never the other way round.
func TestAttachmentTextError(t *testing.T) {
	cases := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"no parser", ErrUnsupportedType, http.StatusUnsupportedMediaType, uploadcheck.CodeUnsupportedFileType},
		{"parser failed", ErrUnparseable, http.StatusUnprocessableEntity, uploadcheck.CodeFileUnreadable},
		{"parse timeout", ErrLibraryParseTimeout, http.StatusUnprocessableEntity, uploadcheck.CodeParseTimeout},
		{"no text", errAttachmentText, http.StatusUnprocessableEntity, uploadcheck.CodeNoText},
		{"other", fmt.Errorf("s3: %w", errors.New("down")), http.StatusInternalServerError, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, code, _ := attachmentTextError(tc.err, "a.pdf")
			if status != tc.status || code != tc.code {
				t.Fatalf("got %d %q, want %d %q", status, code, tc.status, tc.code)
			}
		})
	}
}

// TestTurnAttachmentErrorWrite: a file refusal at send time names the file
// (the client only sent ids), so the UI can say which attachment to remove.
func TestTurnAttachmentErrorWrite(t *testing.T) {
	cases := []struct {
		name string
		err  *turnAttachmentError
		want string
	}{
		{"file refusal", &turnAttachmentError{status: 422, code: uploadcheck.CodeFileUnreadable, msg: "m", fileName: "a.pdf"},
			`{"code":"file_unreadable","error":"m","fileName":"a.pdf"}`},
		{"coded, no file", &turnAttachmentError{status: 415, code: uploadcheck.CodeUnsupportedFileType, msg: "m"},
			`{"error":"m","code":"unsupported_file_type"}`},
		{"uncoded", &turnAttachmentError{status: 400, msg: "m"}, `{"error":"m"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			tc.err.write(context.Background(), w)
			if w.Code != tc.err.status || strings.TrimSpace(w.Body.String()) != tc.want {
				t.Fatalf("got %d %s, want %d %s", w.Code, w.Body.String(), tc.err.status, tc.want)
			}
		})
	}
}
