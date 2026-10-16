//go:build integration

package globalsearch_test

import (
	"context"
	"slices"
	"testing"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/globalsearch"
	"github.com/justrag/go-backend/internal/kbaccess"
)

// TestFileHitsFollowSeeSources is the readable statement of the rule the
// parity matrix checks exhaustively: the header search hides file hits from
// a KB where the caller may not see sources, and only those.
//
//   - a viewer (kb_members role view) gets no file from the KB whose
//     viewer_see_sources is off, but still gets that KB as a topic hit, and
//     gets the file from the KB where the flag is on;
//   - the KB owner and a KB admin get both files;
//   - a system admin gets the file of a public KB with the flag off (rule 3,
//     KB admin capabilities).
//
// Oracle: the expected file and topic sets, written by hand from the spec.
func TestFileHitsFollowSeeSources(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := globalsearch.NewStore(pool)
	m := hexOnlyDigits(marker(t))

	// Users first: t.Cleanup runs in reverse, so the KBs (and with them the
	// kb_members rows) are gone before their users are deleted.
	viewer := insertUser(t, pool, m+"-viewer", auth.RoleUser)
	owner := insertUser(t, pool, m+"-owner", auth.RoleUser)
	kbAdmin := insertUser(t, pool, m+"-kbadmin", auth.RoleUser)
	sysAdmin := insertUser(t, pool, m+"-sysadmin", auth.RoleAdmin)

	off := insertKB(t, pool, kbSpec{name: m + "-off", visibility: "private"})
	on := insertKB(t, pool, kbSpec{name: m + "-on", visibility: "private", viewerSeeSources: true})
	pub := insertKB(t, pool, kbSpec{name: m + "-pub", visibility: "public", published: true})
	offFile := insertFile(t, pool, off, m+"-off.pdf")
	onFile := insertFile(t, pool, on, m+"-on.pdf")
	pubFile := insertFile(t, pool, pub, m+"-pub.pdf")

	for _, kb := range []string{off, on} {
		insertMember(t, pool, kb, viewer, kbaccess.RoleView)
		insertMember(t, pool, kb, owner, kbaccess.RoleOwner)
		insertMember(t, pool, kb, kbAdmin, kbaccess.RoleAdmin)
	}

	cases := []struct {
		name       string
		caller     globalsearch.Caller
		wantFiles  []string
		wantTopics []string
	}{
		// The viewer is also an implicit viewer of the published public KB
		// (flag off), so its file is hidden as well — the topic is not.
		{"viewer", globalsearch.Caller{UserID: viewer, SysRole: auth.RoleUser},
			[]string{onFile}, []string{off, on, pub}},
		{"owner", globalsearch.Caller{UserID: owner, SysRole: auth.RoleUser},
			[]string{offFile, onFile}, []string{off, on, pub}},
		{"kb_admin", globalsearch.Caller{UserID: kbAdmin, SysRole: auth.RoleUser},
			[]string{offFile, onFile}, []string{off, on, pub}},
		{"system_admin_on_public", globalsearch.Caller{UserID: sysAdmin, SysRole: auth.RoleAdmin},
			[]string{pubFile}, []string{pub}},
	}
	fixture := map[string]bool{off: true, on: true, pub: true}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := store.Search(ctx, tc.caller, globalsearch.Query{Text: m, Limit: globalsearch.MaxLimit})
			if err != nil {
				t.Fatalf("Search: %v", err)
			}
			var files, topics []string
			for _, h := range got.Sources {
				if fixture[h.KBID] {
					files = append(files, h.ID)
				}
			}
			for _, h := range got.Topics {
				if fixture[h.ID] {
					topics = append(topics, h.ID)
				}
			}
			slices.Sort(files)
			slices.Sort(topics)
			wantFiles, wantTopics := slices.Clone(tc.wantFiles), slices.Clone(tc.wantTopics)
			slices.Sort(wantFiles)
			slices.Sort(wantTopics)
			if !slices.Equal(files, wantFiles) {
				t.Errorf("file hits = %v, want %v", files, wantFiles)
			}
			if !slices.Equal(topics, wantTopics) {
				t.Errorf("topic hits = %v, want %v", topics, wantTopics)
			}
		})
	}
}
