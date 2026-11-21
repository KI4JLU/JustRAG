package gitrepo

import (
	"bytes"
	"testing"
)

func TestShouldIngestPath(t *testing.T) {
	cases := []struct {
		name   string
		path   string
		size   int
		wantOK bool
	}{
		{"markdown accepted", "docs/readme.md", 100, true},
		{"oversized md rejected", "big.md", GitRepoMaxFileBytes + 1, false},
		{"node_modules rejected", "node_modules/index.js", 100, false},
		{"nested node_modules rejected", "pkg/node_modules/x.js", 100, false},
		{"vendor rejected", "vendor/lib/x.go", 100, false},
		{"go source accepted", "internal/app/main.go", 500, true},
		{"readme no ext accepted", "README", 100, true},
		{"dockerfile accepted", "Dockerfile", 100, true},
		{"png extension rejected", "assets/logo.png", 100, false},
		{"unknown ext rejected", "data.bin", 100, false},
		{"dotfile rejected", ".gitignore", 50, false},
		{"git dir rejected", ".git/config", 100, false},
		{"dist rejected", "dist/app.js", 100, false},
		{"yaml accepted", "ci/build.yaml", 100, true},
		// Skip dirs match whole path segments, not substrings.
		{"node_modules prefix accepted", "src/node_modules_helper/x.go", 100, true},
		{"vendor prefix accepted", "src/vendor_copy/main.go", 100, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ok, _ := ShouldIngestPath(c.path, c.size)
			if ok != c.wantOK {
				t.Fatalf("ShouldIngestPath(%q, %d) = %v, want %v", c.path, c.size, ok, c.wantOK)
			}
		})
	}
}

func TestIsBinaryContent(t *testing.T) {
	cases := []struct {
		name    string
		content []byte
		want    bool
	}{
		{"plain text", []byte("hello world\nsome text"), false},
		{"NUL byte", []byte("ab\x00cd"), true},
		{"binary with NUL", []byte{0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01}, true}, // ELF magic + NUL
		{"empty", []byte{}, false},
		{"NUL beyond 8KiB is not sniffed", append(bytes.Repeat([]byte{'x'}, 8192), 0), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := IsBinaryContent(c.content)
			if got != c.want {
				t.Fatalf("IsBinaryContent(...) = %v, want %v", got, c.want)
			}
		})
	}
}

func TestShouldIngestPathMimeType(t *testing.T) {
	cases := []struct {
		name     string
		path     string
		size     int
		wantOK   bool
		wantMime string
	}{
		{"markdown extension", "a.md", 10, true, "text/markdown"},
		{"html extension", "a.html", 10, true, "text/html"},
		{"go source", "a.go", 10, true, "text/plain"},
		{"readme no ext", "README", 10, true, "text/markdown"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ok, mime := ShouldIngestPath(c.path, c.size)
			if ok != c.wantOK {
				t.Errorf("ShouldIngestPath(%q) ok = %v, want %v", c.path, ok, c.wantOK)
			}
			if mime != c.wantMime {
				t.Errorf("ShouldIngestPath(%q) mime = %q, want %q", c.path, mime, c.wantMime)
			}
		})
	}
}
