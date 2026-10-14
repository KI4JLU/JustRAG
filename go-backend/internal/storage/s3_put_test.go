package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// TestS3StoreFileFromReaderUnseekableOverHTTP pins the staging regression: a
// plain-HTTP S3 endpoint (MinIO without TLS) and an unseekable body — the
// library upload hashes through an io.TeeReader — made the SDK refuse the
// PutObject ("unseekable stream is not supported without TLS and trailing
// checksum").
func TestS3StoreFileFromReaderUnseekableOverHTTP(t *testing.T) {
	var (
		mu  sync.Mutex
		got []byte
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			http.Error(w, "unexpected method", http.StatusMethodNotAllowed)
			return
		}
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = body
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	client := s3.New(s3.Options{
		Region:       "us-east-1",
		Credentials:  credentials.NewStaticCredentialsProvider("key", "secret", ""),
		BaseEndpoint: aws.String(srv.URL),
		UsePathStyle: true,
	})
	s := &s3Storage{client: client, bucket: "bucket"}

	content := strings.Repeat("library blob ", 1000)
	h := sha256.New()
	reader := io.TeeReader(strings.NewReader(content), h)
	if err := s.StoreFileFromReader(context.Background(), "users/u/f", reader, "text/plain"); err != nil {
		t.Fatalf("StoreFileFromReader: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if !bytes.Equal(got, []byte(content)) {
		t.Fatalf("uploaded body mismatch: got %d bytes, want %d", len(got), len(content))
	}
	want := sha256.Sum256([]byte(content))
	if !bytes.Equal(h.Sum(nil), want[:]) {
		t.Fatal("tee hash does not cover the whole body")
	}
}
