package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/uploadcheck"
	"github.com/justrag/go-backend/internal/userfiles"
)

// recordingIngester notes that an upload got past uploadcheck.Parse, then
// stops the request there.
type recordingIngester struct{ called bool }

func (r *recordingIngester) IngestScoped(context.Context, string, *uploadcheck.Upload, string) (*userfiles.UserFile, bool, error) {
	r.called = true
	return nil, false, errors.New("stop after parse")
}

func chatAttachmentUploadRequest(t *testing.T, fileBytes int) *http.Request {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("file", "notes.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(bytes.Repeat([]byte("a"), fileBytes)); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	const kbID = "6f1c1f3e-8a7e-4c55-9a39-2b8f5b6b1e10"
	req := httptest.NewRequest(http.MethodPost, "/api/kb/"+kbID+"/chat/attachments", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.SetPathValue("id", kbID)
	return req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: "u1"}))
}

// Oracle: chat_attachments_max_file_bytes bounds the upload, and the 413
// carries that limit as limitBytes (the composer chip names it). A file under
// the limit reaches the ingester; unset, the limit is the 50 MiB default, so
// a 2 MiB file (refused by the old 1 MiB global body cap) gets through.
func TestUploadChatAttachment_FileSizeLimit(t *testing.T) {
	oneMiB := strconv.Itoa(1 << 20)
	cases := []struct {
		name        string
		configured  map[string]*string
		fileBytes   int
		wantRefused bool
	}{
		{"over the configured limit", map[string]*string{"chat_attachments_max_file_bytes": &oneMiB}, 1<<20 + 1, true},
		{"under the configured limit", map[string]*string{"chat_attachments_max_file_bytes": &oneMiB}, 512 << 10, false},
		{"2 MiB under the default", map[string]*string{}, 2 << 20, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ing := &recordingIngester{}
			h := &Handler{
				siteConfigReader: &fakeSiteConfigReader{values: tc.configured},
				attachmentFiles:  &PGStore{}, attachIngester: ing, attachDeleter: fakeDeleter{},
				attachLimits: fakeAttachLimits{}, libraryFiles: fakeFileGetter{}, libraryText: fakeTextProvider{},
				aiResolver: &ai.ConfigResolver{}, attachTokens: newAttachmentTokenCounter(),
			}
			rec := httptest.NewRecorder()
			h.UploadChatAttachment(rec, chatAttachmentUploadRequest(t, tc.fileBytes))

			if !tc.wantRefused {
				if rec.Code == http.StatusRequestEntityTooLarge || !ing.called {
					t.Fatalf("upload refused before the ingester: %d %s", rec.Code, rec.Body.String())
				}
				return
			}
			if rec.Code != http.StatusRequestEntityTooLarge {
				t.Fatalf("status = %d, want 413 (body: %s)", rec.Code, rec.Body.String())
			}
			if ing.called {
				t.Fatal("an oversize upload reached the ingester")
			}
			var got struct {
				Code       string `json:"code"`
				LimitBytes int64  `json:"limitBytes"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode %q: %v", rec.Body.String(), err)
			}
			if got.Code != uploadcheck.CodeFileTooLarge || got.LimitBytes != 1<<20 {
				t.Fatalf("got %+v, want code %q and limitBytes %d", got, uploadcheck.CodeFileTooLarge, 1<<20)
			}
		})
	}
}

// Oracle: the reader's documented default and range; an out-of-range value
// reads as the default, like every other clamped chat_* reader.
func TestChatAttachmentsMaxFileBytes(t *testing.T) {
	ctx := context.Background()
	str := func(s string) map[string]*string { return map[string]*string{"chat_attachments_max_file_bytes": &s} }
	cases := []struct {
		name   string
		values map[string]*string
		want   int64
	}{
		{"unset", map[string]*string{}, 50 << 20},
		{"lower bound", str("1048576"), 1 << 20},
		{"upper bound", str("524288000"), 500 << 20},
		{"below range", str("1048575"), 50 << 20},
		{"above range", str("524288001"), 50 << 20},
		{"not a number", str("50MB"), 50 << 20},
	}
	for _, tc := range cases {
		if got := ChatAttachmentsMaxFileBytes(ctx, &fakeSiteConfigReader{values: tc.values}); got != tc.want {
			t.Errorf("%s: got %d, want %d", tc.name, got, tc.want)
		}
	}
	if got := ChatAttachmentsMaxFileBytes(ctx, nil); got != 50<<20 {
		t.Errorf("nil reader: got %d, want %d", got, 50<<20)
	}
}
