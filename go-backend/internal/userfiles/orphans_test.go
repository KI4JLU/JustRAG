package userfiles

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/storage"
)

const (
	tUID  = "11111111-1111-1111-1111-111111111111"
	tUFID = "22222222-2222-2222-2222-222222222222"
)

type fakeOrphanStore struct {
	owners  []string
	blobs   map[string]bool // referenced storage paths
	files   map[string]bool // "owner/ufid" existing
	ownErr  error
	blobErr error
}

func (f *fakeOrphanStore) OwnerIDs(context.Context) ([]string, error) { return f.owners, f.ownErr }
func (f *fakeOrphanStore) BlobReferenced(_ context.Context, key string) (bool, error) {
	return f.blobs[key], f.blobErr
}
func (f *fakeOrphanStore) LibraryFileExists(_ context.Context, owner, ufid string) (bool, error) {
	return f.files[owner+"/"+ufid], nil
}

type fakeOrphanStorage struct {
	storage.Storage
	objs    []storage.ObjectInfo
	listErr error
	deleted []string
	prefix  []string
}

func (f *fakeOrphanStorage) List(_ context.Context, prefix string) ([]storage.ObjectInfo, error) {
	f.prefix = append(f.prefix, prefix)
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
	f.deleted = append(f.deleted, k)
	return nil
}

func obj(key string, age time.Duration) storage.ObjectInfo {
	return storage.ObjectInfo{Key: key, ModTime: time.Now().Add(-age)}
}

func TestSweepBlobDecisions(t *testing.T) {
	st := &fakeOrphanStore{owners: []string{tUID}, blobs: map[string]bool{"users/" + tUID + "/kept": true}}
	sg := &fakeOrphanStorage{objs: []storage.ObjectInfo{
		obj("users/"+tUID+"/old-orphan", 48*time.Hour),
		obj("users/"+tUID+"/young-orphan", time.Hour),
		obj("users/"+tUID+"/kept", 48*time.Hour),
		obj("legacy/kb/file.txt", 48*time.Hour),
	}}
	n, err := NewOrphanSweeper(st, sg).RunOnce(context.Background())
	if err != nil || n != 1 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	if len(sg.deleted) != 1 || sg.deleted[0] != "users/"+tUID+"/old-orphan" {
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
		sg.objs = append(sg.objs, obj(fmt.Sprintf("users/%s/o%04d", tUID, i), 48*time.Hour))
	}
	n, err := NewOrphanSweeper(st, sg).RunOnce(context.Background())
	if err != nil || n != 500 || len(sg.deleted) != 500 {
		t.Fatalf("n=%d deleted=%d err=%v", n, len(sg.deleted), err)
	}
}

func TestSweepErrorsAbortWithoutDeleting(t *testing.T) {
	mk := func() []storage.ObjectInfo { return []storage.ObjectInfo{obj("users/"+tUID+"/a", 48*time.Hour)} }
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
