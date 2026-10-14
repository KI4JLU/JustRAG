package owuicompat

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sort"
	"sync"
	"time"

	"github.com/justrag/go-backend/internal/auth"
)

const testOwner = "11111111-1111-1111-1111-111111111111"

type fakeStore struct {
	mu        sync.Mutex
	handles   map[string]FileHandle
	knowledge map[string]string            // kbID → owner
	links     map[string]map[string]string // kbID → handleID → fileID
	kbFiles   map[string]string            // kbID|userFileID → fileID
}

func newFakeStore() *fakeStore {
	return &fakeStore{handles: map[string]FileHandle{}, knowledge: map[string]string{},
		links: map[string]map[string]string{}, kbFiles: map[string]string{}}
}

func (f *fakeStore) CreateHandle(_ context.Context, h NewHandle) (*FileHandle, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fh := FileHandle{ID: h.ID, OwnerUserID: h.OwnerUserID, UserFileID: h.UserFileID, Filename: h.Filename,
		Metadata: h.Metadata, Unsupported: h.Unsupported, CreatedAt: time.Now()}
	f.handles[h.ID] = fh
	return &fh, nil
}
func (f *fakeStore) GetHandle(_ context.Context, owner, id string) (*FileHandle, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	h, ok := f.handles[id]
	if !ok || h.OwnerUserID != owner {
		return nil, nil
	}
	return &h, nil
}
func (f *fakeStore) ListHandles(_ context.Context, owner string) ([]FileHandle, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []FileHandle{}
	for _, h := range f.handles {
		if h.OwnerUserID == owner {
			out = append(out, h)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}
func (f *fakeStore) DeleteHandle(_ context.Context, owner, id string) (bool, bool, []string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	h, ok := f.handles[id]
	if !ok || h.OwnerUserID != owner {
		return false, false, nil, nil
	}
	orphans := []string{}
	for kb, m := range f.links {
		fid, linked := m[id]
		if !linked || fid == "" {
			continue
		}
		shared := false
		for other, ofid := range m {
			if other != id && ofid == fid {
				shared = true
			}
		}
		if !shared {
			orphans = append(orphans, fid)
		}
		delete(m, id)
		_ = kb
	}
	delete(f.handles, id)
	last := h.UserFileID != ""
	for _, o := range f.handles {
		if o.UserFileID == h.UserFileID && o.UserFileID != "" {
			last = false
		}
	}
	return true, last, orphans, nil
}
func (f *fakeStore) HandleCleanupPlan(_ context.Context, owner, id string) (bool, bool, []string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	h, ok := f.handles[id]
	if !ok || h.OwnerUserID != owner {
		return false, false, nil, nil
	}
	orphans := []string{}
	for _, m := range f.links {
		fid, linked := m[id]
		if !linked || fid == "" {
			continue
		}
		shared := false
		for other, ofid := range m {
			if other != id && ofid == fid {
				shared = true
			}
		}
		if !shared {
			orphans = append(orphans, fid)
		}
	}
	last := h.UserFileID != ""
	for oid, o := range f.handles {
		if oid != id && o.UserFileID == h.UserFileID && o.UserFileID != "" {
			last = false
		}
	}
	return true, last, orphans, nil
}
func (f *fakeStore) UnlinkPlan(_ context.Context, kb, handle string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fid, ok := f.links[kb][handle]
	if !ok || fid == "" {
		return "", nil
	}
	for other, ofid := range f.links[kb] {
		if other != handle && ofid == fid {
			return "", nil
		}
	}
	return fid, nil
}
func (f *fakeStore) RegisterKnowledge(_ context.Context, kb, owner string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.knowledge[kb] = owner
	return nil
}
func (f *fakeStore) OwnsKnowledge(_ context.Context, owner, kb string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.knowledge[kb] == owner && owner != "", nil
}
func (f *fakeStore) KBFileForUserFile(_ context.Context, kb, uf string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.kbFiles[kb+"|"+uf], nil
}
func (f *fakeStore) LinkFile(_ context.Context, kb, handle, file string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.links[kb] == nil {
		f.links[kb] = map[string]string{}
	}
	f.links[kb][handle] = file
	return nil
}
func (f *fakeStore) UnlinkFile(_ context.Context, kb, handle string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fid, ok := f.links[kb][handle]
	if !ok {
		return "", nil
	}
	delete(f.links[kb], handle)
	if fid == "" {
		return "", nil
	}
	for _, other := range f.links[kb] {
		if other == fid {
			return "", nil
		}
	}
	return fid, nil
}
func (f *fakeStore) HandlesForFiles(_ context.Context, kb string, fileIDs []string) (map[string]FileHandle, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]FileHandle{}
	for hid, fid := range f.links[kb] {
		for _, want := range fileIDs {
			if fid == want {
				if cur, ok := out[fid]; !ok || hid < cur.ID {
					out[fid] = f.handles[hid]
				}
			}
		}
	}
	return out, nil
}

type fakeConfig struct{ enabled bool }

func (c fakeConfig) GetSiteConfigValue(_ context.Context, key string) (*string, error) {
	if key == "owui_compat_enabled" && c.enabled {
		v := "true"
		return &v, nil
	}
	return nil, nil
}

// withUser puts an authenticated API-key user on the request, as
// apikeyauth.Authenticate does in production.
func withUser(r *http.Request) *http.Request {
	ctx := auth.WithUser(r.Context(), &auth.Claims{ID: testOwner, Role: "api-user"})
	return r.WithContext(ctx)
}

func do(h http.Handler, r *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, withUser(r))
	return rec
}
