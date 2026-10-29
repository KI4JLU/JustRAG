//go:build integration

// Integration tests for the start page settings and category colour slots
// (migration 0093): the jsonb round trip through kbstartpage.Store, and the
// colour slot kbcategories assigns on create. Skipped when DB_* env is unset;
// helpers are shared with behavior_integration_test.go (same package).

package kb_test

import (
	"context"
	"testing"

	"github.com/justrag/go-backend/internal/kbcategories"
	"github.com/justrag/go-backend/internal/kbstartpage"
)

func TestStartPage_SaveLoad(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	kbID := insertBehaviorKB(t, pool, nil)
	st := kbstartpage.NewStore(pool)

	if got, err := st.Load(ctx, kbID); err != nil || got != nil {
		t.Fatalf("never configured: %v (%v), want nil", got, err)
	}
	p := kbstartpage.Default()
	p.RoleStarts = map[string]kbstartpage.EntryStart{"tutor": {Kind: kbstartpage.EntryTask, Text: "Elternzeit?", Send: false}}
	p.RoleEntries = []kbstartpage.RoleEntry{{ID: "re-1", RoleID: "tutor"}}
	p.QuestionMode, p.FixedQuestions = kbstartpage.QuestionsFixed, []string{"Eins", "Zwei"}
	p.StartMode = kbstartpage.StartUpload
	if err := st.Save(ctx, kbID, p); err != nil {
		t.Fatal(err)
	}
	got, err := st.Load(ctx, kbID)
	if err != nil || got == nil || got.RoleEntries[0].RoleID != "tutor" || got.RoleStarts["tutor"].Send ||
		len(got.FixedQuestions) != 2 || got.StartMode != kbstartpage.StartUpload {
		t.Fatalf("round trip = %+v (%v)", got, err)
	}
	if _, err := st.Load(ctx, "00000000-0000-0000-0000-000000000000"); err == nil {
		t.Error("missing KB must error")
	}
}

// Oracle: the least-used slot, lowest first — so fresh categories on a
// taxonomy whose slots are all used once get distinct, ascending slots.
func TestCategory_ColorSlotOnCreate(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	st := kbcategories.NewStore(pool)
	before, err := st.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	used := map[int]int{}
	for _, c := range before {
		if c.ColorSlot != nil {
			used[*c.ColorSlot]++
		}
	}
	want := 1
	for s := 1; s <= kbcategories.ColorSlots; s++ {
		if used[s] < used[want] {
			want = s
		}
	}

	c, err := st.Create(ctx, "it-color-slot-a", 999, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Delete(context.Background(), c.ID) }) //nolint:errcheck
	if c.ColorSlot == nil || *c.ColorSlot != want {
		t.Fatalf("slot = %v, want %d", c.ColorSlot, want)
	}

	seven := 7
	d, err := st.Create(ctx, "it-color-slot-b", 999, &seven)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Delete(context.Background(), d.ID) }) //nolint:errcheck
	if d.ColorSlot == nil || *d.ColorSlot != 7 {
		t.Fatalf("explicit slot = %v, want 7", d.ColorSlot)
	}
	u, err := st.Update(ctx, d.ID, "it-color-slot-b", 999, nil)
	if err != nil || u.ColorSlot == nil || *u.ColorSlot != 7 {
		t.Fatalf("update without a slot must keep it: %+v (%v)", u, err)
	}
}
