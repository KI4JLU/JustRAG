package uploadcheck_test

import (
	"bytes"
	"context"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/uploadcheck"
)

type fixedLimits int

func (f fixedLimits) TabularMaxFileBytes(context.Context) int { return int(f) }

func multipartReq(t *testing.T, field, filename string, content []byte) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile(field, filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/upload", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

func TestParse(t *testing.T) {
	tests := []struct {
		name    string
		req     func(t *testing.T) *http.Request
		limits  uploadcheck.Limits
		shrink  int64
		status  int
		message string
		code    string
		limit   int64
	}{
		{
			name: "body over cap",
			req: func(t *testing.T) *http.Request {
				t.Helper()
				return multipartReq(t, "file", "a.txt", bytes.Repeat([]byte("x"), 4096))
			},
			shrink: 1024, status: 413, message: "File too large: the upload limit is 1 KB",
			code: uploadcheck.CodeFileTooLarge, limit: 1024,
		},
		{
			name: "not multipart",
			req: func(t *testing.T) *http.Request {
				t.Helper()
				r := httptest.NewRequest(http.MethodPost, "/upload", strings.NewReader("hello"))
				r.Header.Set("Content-Type", "text/plain")
				return r
			},
			status: 400, message: "Invalid multipart form", code: uploadcheck.CodeInvalidUpload,
		},
		{
			name:   "missing field",
			req:    func(t *testing.T) *http.Request { t.Helper(); return multipartReq(t, "other", "a.pdf", []byte("x")) },
			status: 400, message: "File field is required", code: uploadcheck.CodeInvalidUpload,
		},
		{
			name:   "empty file",
			req:    func(t *testing.T) *http.Request { t.Helper(); return multipartReq(t, "file", "a.pdf", nil) },
			status: 400, message: "File must not be empty", code: uploadcheck.CodeEmptyFile,
		},
		{
			name:   "dangerous extension",
			req:    func(t *testing.T) *http.Request { t.Helper(); return multipartReq(t, "file", "a.exe", []byte("x")) },
			status: 400, message: "File type not allowed", code: uploadcheck.CodeUnsupportedFileType,
		},
		{
			name:   "unsupported extension",
			req:    func(t *testing.T) *http.Request { t.Helper(); return multipartReq(t, "file", "a.doc", []byte("x")) },
			status: 400, message: "File type not supported (.doc)", code: uploadcheck.CodeUnsupportedFileType,
		},
		{
			name: "long filename",
			req: func(t *testing.T) *http.Request {
				t.Helper()
				return multipartReq(t, "file", strings.Repeat("a", 252)+".pdf", []byte("x"))
			},
			status: 400, message: "Filename must not exceed 255 bytes", code: uploadcheck.CodeFileNameTooLong,
		},
		{
			name: "spreadsheet over cap",
			req: func(t *testing.T) *http.Request {
				t.Helper()
				return multipartReq(t, "file", "a.csv", bytes.Repeat([]byte("x"), 2048))
			},
			limits: fixedLimits(1024), status: 413,
			message: "Spreadsheet too large (2 KB): the limit is 1 KB (tabular_max_file_bytes)",
			code:    uploadcheck.CodeFileTooLarge, limit: 1024,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if tc.shrink > 0 {
				old := uploadcheck.MaxUploadSize
				uploadcheck.MaxUploadSize = tc.shrink
				t.Cleanup(func() { uploadcheck.MaxUploadSize = old })
			}
			up, err := uploadcheck.Parse(httptest.NewRecorder(), tc.req(t), tc.limits)
			if err == nil {
				up.File.Close()
				t.Fatal("expected error")
			}
			var ve *uploadcheck.Error
			if !errors.As(err, &ve) {
				t.Fatalf("want *Error, got %T", err)
			}
			if ve.Status != tc.status || ve.Message != tc.message {
				t.Fatalf("got %d %q, want %d %q", ve.Status, ve.Message, tc.status, tc.message)
			}
			if ve.Code != tc.code || ve.LimitBytes != tc.limit {
				t.Fatalf("got code %q limit %d, want %q %d", ve.Code, ve.LimitBytes, tc.code, tc.limit)
			}
		})
	}
}

func TestParse_Valid(t *testing.T) {
	up, err := uploadcheck.Parse(httptest.NewRecorder(), multipartReq(t, "file", "a.pdf", []byte("%PDF")), fixedLimits(1))
	if err != nil {
		t.Fatal(err)
	}
	defer up.File.Close()
	if up.MimeType != "application/pdf" || up.Header.Filename != "a.pdf" {
		t.Fatalf("got %q %q", up.MimeType, up.Header.Filename)
	}
}

func TestValidateNameMarksRejected(t *testing.T) {
	for _, name := range []string{"x.zip", "x.exe", strings.Repeat("a", 300) + ".pdf"} {
		err := uploadcheck.ValidateName(name)
		if err == nil || !err.Rejected {
			t.Errorf("ValidateName(%q) = %+v, want Rejected", name, err)
		}
	}
	if err := uploadcheck.ValidateName("ok.pdf"); err != nil {
		t.Errorf("ValidateName(ok.pdf) = %+v, want nil", err)
	}
}

func TestValidateName(t *testing.T) {
	long := strings.Repeat("a", uploadcheck.MaxFileNameBytes) + ".pdf"
	for name, wantOK := range map[string]bool{
		"a.pdf": true, "A.PDF": true, "x.svg": false, "x.exe": false,
		"x.doc": false, long: false,
	} {
		err := uploadcheck.ValidateName(name)
		if (err == nil) != wantOK {
			t.Errorf("ValidateName(%q) = %v, wantOK=%v", name, err, wantOK)
		}
	}
}

// TestErrorWrite pins the wire shape clients map to a localized message:
// the status, the human message, the code and, for a size refusal, the limit.
func TestErrorWrite(t *testing.T) {
	tests := []struct {
		name string
		err  *uploadcheck.Error
		want string
	}{
		{
			name: "with limit",
			err:  &uploadcheck.Error{Status: 413, Code: uploadcheck.CodeFileTooLarge, Message: "too large", LimitBytes: 1024},
			want: `{"error":"too large","code":"file_too_large","limitBytes":1024}`,
		},
		{
			name: "without limit",
			err:  &uploadcheck.Error{Status: 400, Code: uploadcheck.CodeEmptyFile, Message: "empty"},
			want: `{"error":"empty","code":"empty_file"}`,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			tc.err.Write(context.Background(), w)
			if w.Code != tc.err.Status {
				t.Fatalf("status %d, want %d", w.Code, tc.err.Status)
			}
			if got := strings.TrimSpace(w.Body.String()); got != tc.want {
				t.Fatalf("body %s, want %s", got, tc.want)
			}
		})
	}
}
