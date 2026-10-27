package userfiles

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/storage"
)

const (
	uOld   = "4a4a4a4a-4444-4444-4444-444444444444"
	uYoung = "55555555-5555-5555-5555-555555555555"
	uKept  = "66666666-6666-6666-6666-666666666666"
	tUID   = "11111111-1111-1111-1111-111111111111"
	tUFID  = "22222222-2222-2222-2222-222222222222"
)

type fakeOrphanStore struct {
	owners  []string
	blobs   map[string]bool // referenced storage paths
	files   map[string]bool // "owner/ufid" existing
	ownErr  error
	blobErr error
	fileErr error
	onCheck func(key string)
}

func (f *fakeOrphanStore) OwnerIDs(context.Context) ([]string, error) { return f.owners, f.ownErr }
func (f *fakeOrphanStore) BlobReferenced(_ context.Context, _, _, key string) (bool, error) {
	if f.onCheck != nil {
		f.onCheck(key)
	}
	return f.blobs[key], f.blobErr
}
func (f *fakeOrphanStore) LibraryFileExists(_ context.Context, owner, ufid string) (bool, error) {
	return f.files[owner+"/"+ufid], f.fileErr
}

type fakeOrphanStorage struct {
	storage.Storage
	objs    []storage.ObjectInfo
	listErr error
	deleted []string
	prefix  []string
	delErr  error
	onList  func()
}

func (f *fakeOrphanStorage) List(_ context.Context, prefix string) ([]storage.ObjectInfo, error) {
	f.prefix = append(f.prefix, prefix)
	if f.onList != nil {
		f.onList()
	}
	if f.listErr != nil {
		return nil, f.listErr
	}
	var out []storage.ObjectInfo
	for _, o := range f.objs {
		if len(o.Key) >= len(prefix) && o.Key[:len(prefix)] == prefix {
			out = append(out, o)
		}
	}
	return out, nil
}

func (f *fakeOrphanStorage) DeleteFile(_ context.Context, k string) error {
	if f.delErr != nil {
		return f.delErr
	}
	f.deleted = append(f.deleted, k)
	return nil
}

func obj(key string, age time.Duration) storage.ObjectInfo {
	return storage.ObjectInfo{Key: key, ModTime: time.Now().Add(-age)}
}

func TestSweepBlobDecisions(t *testing.T) {
	st := &fakeOrphanStore{owners: []string{tUID}, blobs: map[string]bool{"users/" + tUID + "/" + uKept: true}}
	sg := &fakeOrphanStorage{objs: []storage.ObjectInfo{
		obj("users/"+tUID+"/"+uOld, 48*time.Hour),
		obj("users/"+tUID+"/"+uYoung, time.Hour),
		obj("users/"+tUID+"/"+uKept, 48*time.Hour),
		obj("legacy/kb/file.txt", 48*time.Hour),
	}}
	n, err := NewOrphanSweeper(st, sg).RunOnce(context.Background())
	if err != nil || n != 1 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	if len(sg.deleted) != 1 || sg.deleted[0] != "users/"+tUID+"/"+uOld {
		t.Fatalf("deleted=%v", sg.deleted)
	}
	for _, p := range sg.prefix {
		if p != "users/"+tUID+"/" {
			t.Fatalf("unexpected list prefix %q", p)
		}
	}
}

func TestSweepCacheDecisions(t *testing.T) {
	st := &fakeOrphanStore{owners: []string{tUID}, files: map[string]bool{tUID + "/" + tUFID: true}}
	missing := "33333333-3333-3333-3333-333333333333"
	sg := &fakeOrphanStorage{objs: []storage.ObjectInfo{
		obj("users/"+tUID+"/parses/"+missing+"/chat-text.json", 48*time.Hour),
		obj("users/"+tUID+"/parses/"+tUFID+"/chat-text.json", 48*time.Hour),
		obj("users/"+tUID+"/parses/not-a-uuid/x.json", 48*time.Hour),
		obj("users/"+tUID+"/other/dir/x", 48*time.Hour),
	}}
	n, err := NewOrphanSweeper(st, sg).RunOnce(context.Background())
	if err != nil || n != 1 {
		t.Fatalf("n=%d err=%v deleted=%v", n, err, sg.deleted)
	}
	if sg.deleted[0] != "users/"+tUID+"/parses/"+missing+"/chat-text.json" {
		t.Fatalf("deleted=%v", sg.deleted)
	}
}

func TestSweepCap(t *testing.T) {
	st := &fakeOrphanStore{owners: []string{tUID}}
	sg := &fakeOrphanStorage{}
	for i := 0; i < 700; i++ {
		sg.objs = append(sg.objs, obj(fmt.Sprintf("users/%s/00000000-0000-0000-0000-%012d", tUID, i), 48*time.Hour))
	}
	n, err := NewOrphanSweeper(st, sg).RunOnce(context.Background())
	if err != nil || n != 500 || len(sg.deleted) != 500 {
		t.Fatalf("n=%d deleted=%d err=%v", n, len(sg.deleted), err)
	}
}

func TestSweepErrorsAbortWithoutDeleting(t *testing.T) {
	mk := func() []storage.ObjectInfo { return []storage.ObjectInfo{obj("users/"+tUID+"/"+uOld, 48*time.Hour)} }
	cases := map[string]struct {
		st *fakeOrphanStore
		sg *fakeOrphanStorage
	}{
		"list":  {&fakeOrphanStore{owners: []string{tUID}}, &fakeOrphanStorage{objs: mk(), listErr: errors.New("boom")}},
		"db":    {&fakeOrphanStore{owners: []string{tUID}, blobErr: errors.New("boom")}, &fakeOrphanStorage{objs: mk()}},
		"owner": {&fakeOrphanStore{ownErr: errors.New("boom")}, &fakeOrphanStorage{objs: mk()}},
	}
	for name, c := range cases {
		n, err := NewOrphanSweeper(c.st, c.sg).RunOnce(context.Background())
		if err == nil || n != 0 || len(c.sg.deleted) != 0 {
			t.Fatalf("%s: n=%d err=%v deleted=%v", name, n, err, c.sg.deleted)
		}
	}
}

func TestSweepSkipsInvalidOwnerID(t *testing.T) {
	st := &fakeOrphanStore{owners: []string{"../x"}}
	sg := &fakeOrphanStorage{}
	if _, err := NewOrphanSweeper(st, sg).RunOnce(context.Background()); err != nil || len(sg.prefix) != 0 {
		t.Fatalf("err=%v prefixes=%v", err, sg.prefix)
	}
}

type fakeTotals struct{ n, b int64 }

func (f fakeTotals) LibraryTotals(context.Context) (int64, int64, error) { return f.n, f.b, nil }

func TestRefreshLibraryGauges(t *testing.T) {
	var gn, gb float64
	if err := RefreshLibraryGauges(context.Background(), fakeTotals{3, 99}, func(n, b float64) { gn, gb = n, b }); err != nil {
		t.Fatal(err)
	}
	if gn != 3 || gb != 99 {
		t.Fatalf("%v %v", gn, gb)
	}
}

func TestSweepMoreAbortAndSkipCases(t *testing.T) {
	old := 48 * time.Hour
	cacheKey := "users/" + tUID + "/parses/" + tUFID + "/chat-text.json"

	// LibraryFileExists error aborts.
	sg := &fakeOrphanStorage{objs: []storage.ObjectInfo{obj(cacheKey, old)}}
	n, err := NewOrphanSweeper(&fakeOrphanStore{owners: []string{tUID}, fileErr: errors.New("boom")}, sg).RunOnce(context.Background())
	if err == nil || n != 0 || len(sg.deleted) != 0 {
		t.Fatalf("file check: n=%d err=%v", n, err)
	}

	// Young cache object kept.
	sg = &fakeOrphanStorage{objs: []storage.ObjectInfo{obj(cacheKey, time.Hour)}}
	n, err = NewOrphanSweeper(&fakeOrphanStore{owners: []string{tUID}}, sg).RunOnce(context.Background())
	if err != nil || n != 0 {
		t.Fatalf("young cache: n=%d err=%v", n, err)
	}

	// DeleteFile error (not not-found) aborts.
	sg = &fakeOrphanStorage{objs: []storage.ObjectInfo{obj("users/"+tUID+"/"+uOld, old)}, delErr: errors.New("denied")}
	n, err = NewOrphanSweeper(&fakeOrphanStore{owners: []string{tUID}}, sg).RunOnce(context.Background())
	if err == nil || n != 0 {
		t.Fatalf("delete err: n=%d err=%v", n, err)
	}

	// DeleteFile not-found counts as success.
	sg = &fakeOrphanStorage{objs: []storage.ObjectInfo{obj("users/"+tUID+"/"+uOld, old)}, delErr: fmt.Errorf("storage: %w", os.ErrNotExist)}
	n, err = NewOrphanSweeper(&fakeOrphanStore{owners: []string{tUID}}, sg).RunOnce(context.Background())
	if err != nil || n != 1 {
		t.Fatalf("not-found: n=%d err=%v", n, err)
	}

	// Non-UUID blob name and non-canonical uuid forms are skipped.
	sg = &fakeOrphanStorage{objs: []storage.ObjectInfo{
		obj("users/"+tUID+"/notauuid", old),
		obj("users/"+tUID+"/urn:uuid:"+uOld, old),
		obj("users/"+tUID+"/{"+uOld+"}", old),
		obj("users/"+tUID+"/4a4a4a4a444444444444444444444444", old),
		obj("users/"+tUID+"/"+strings.ToUpper(uOld), old),
		obj("users/"+tUID+"/parses/urn:uuid:"+tUFID+"/x.json", old),
	}}
	n, err = NewOrphanSweeper(&fakeOrphanStore{owners: []string{tUID}}, sg).RunOnce(context.Background())
	if err != nil || n != 0 || len(sg.deleted) != 0 {
		t.Fatalf("skip: n=%d err=%v deleted=%v", n, err, sg.deleted)
	}
}

// A user_files row that appears after List must keep its blob: the existence
// check happens per key after the listing, not before.
func TestSweepRowAppearingAfterListIsKept(t *testing.T) {
	key := "users/" + tUID + "/" + uOld
	st := &fakeOrphanStore{owners: []string{tUID}, blobs: map[string]bool{}}
	sg := &fakeOrphanStorage{objs: []storage.ObjectInfo{obj(key, 48*time.Hour)}}
	sg.onList = func() { st.blobs[key] = true }
	n, err := NewOrphanSweeper(st, sg).RunOnce(context.Background())
	if err != nil || n != 0 || len(sg.deleted) != 0 {
		t.Fatalf("n=%d err=%v deleted=%v", n, err, sg.deleted)
	}
}

func TestSweepZeroModTimeIsTooYoung(t *testing.T) {
	st := &fakeOrphanStore{owners: []string{tUID}}
	sg := &fakeOrphanStorage{objs: []storage.ObjectInfo{{Key: "users/" + tUID + "/" + uOld}}}
	n, err := NewOrphanSweeper(st, sg).RunOnce(context.Background())
	if err != nil || n != 0 || len(sg.deleted) != 0 {
		t.Fatalf("n=%d deleted=%v err=%v", n, sg.deleted, err)
	}
}

type fakePendingStore struct {
	files []PendingFile
	err   error
	limit int
}

func (f *fakePendingStore) PendingChatFiles(_ context.Context, _ time.Time, limit int) ([]PendingFile, error) {
	f.limit = limit
	return f.files, f.err
}

type fakeChatDeleter struct {
	failID  string
	keepID  string
	stale   []time.Time
	deleted []string
}

func (f *fakeChatDeleter) DeleteChatAttachment(_ context.Context, _, id string, staleBefore time.Time) (bool, error) {
	f.stale = append(f.stale, staleBefore)
	switch id {
	case f.failID:
		return false, errors.New("storage down")
	case f.keepID:
		return false, nil
	}
	f.deleted = append(f.deleted, id)
	return true, nil
}

// The pending listing is only a candidate list: the delete gets the grace
// cutoff for its own in-transaction re-check, and a file the delete keeps
// (sent or promoted meanwhile) is not counted.
func TestSweepChatAttachmentsPassCutoffAndCountOnlyDeletes(t *testing.T) {
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	pending := &fakePendingStore{files: []PendingFile{{ID: uOld, OwnerID: tUID}, {ID: uKept, OwnerID: tUID}}}
	del := &fakeChatDeleter{keepID: uKept}
	s := NewOrphanSweeper(&fakeOrphanStore{}, &fakeOrphanStorage{}).WithPendingChatFiles(pending, del)
	s.now = func() time.Time { return now }

	n, err := s.RunOnce(context.Background())
	if err != nil || n != 1 {
		t.Fatalf("n=%d err=%v, want 1 deletion", n, err)
	}
	for _, c := range del.stale {
		if !c.Equal(now.Add(-OrphanGrace)) {
			t.Fatalf("staleBefore %v, want now-OrphanGrace", c)
		}
	}
}

// A chat attachment that keeps failing, or a failed listing, must not stop
// the blob/cache sweep, and the chat step does not use up its budget.
func TestSweepChatAttachmentErrorsDoNotAbortBlobSweep(t *testing.T) {
	blobs := func() *fakeOrphanStorage {
		sg := &fakeOrphanStorage{}
		for i := 0; i < 10; i++ {
			sg.objs = append(sg.objs, obj(fmt.Sprintf("users/%s/00000000-0000-0000-0000-%012d", tUID, i), 48*time.Hour))
		}
		return sg
	}
	many := make([]PendingFile, OrphanMaxPerRun)
	for i := range many {
		many[i] = PendingFile{ID: fmt.Sprintf("99999999-0000-0000-0000-%012d", i), OwnerID: tUID}
	}
	cases := map[string]struct {
		pending   *fakePendingStore
		del       *fakeChatDeleter
		wantTotal int
	}{
		"delete fails":    {&fakePendingStore{files: []PendingFile{{ID: uOld, OwnerID: tUID}, {ID: uYoung, OwnerID: tUID}}}, &fakeChatDeleter{failID: uOld}, 1 + 10},
		"listing fails":   {&fakePendingStore{err: errors.New("db down")}, &fakeChatDeleter{}, 10},
		"full chat batch": {&fakePendingStore{files: many}, &fakeChatDeleter{}, OrphanMaxPerRun + 10},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			sg := blobs()
			s := NewOrphanSweeper(&fakeOrphanStore{owners: []string{tUID}}, sg).WithPendingChatFiles(tc.pending, tc.del)
			n, err := s.RunOnce(context.Background())
			if err != nil {
				t.Fatalf("err=%v", err)
			}
			if len(sg.deleted) != 10 || n != tc.wantTotal {
				t.Fatalf("blob deletes=%d total=%d, want 10 / %d", len(sg.deleted), n, tc.wantTotal)
			}
		})
	}
}
