// Unit tests for the topic-order routes.
//
// Oracle: the route contract in API.md, fixed before the handler — GET 200
// with both views, null for one never saved and [] for a saved empty one; PUT
// 204; an unknown view 404; a body that is not an order (no ids, a non-UUID,
// a repeated topic, more than MaxOrderLen ids) 400, with nothing stored. The
// expected canonical ids are the RFC 4122 text form, written by hand. The
// store is the fake from http_test.go, so these tests say nothing about
// Postgres; store_pg_integration_test.go covers that half.

package kbfilters_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/kbfilters"
)

func (f *fakeStore) ListOrders(_ context.Context, userID string) (map[kbfilters.OrderView][]string, error) {
	f.calls++
	f.gotUserID = userID
	return f.orders, f.err
}

func (f *fakeStore) SetOrder(_ context.Context, userID string, view kbfilters.OrderView, kbIDs []string) error {
	f.calls++
	f.gotUserID, f.gotView, f.gotIDs = userID, view, kbIDs
	return f.err
}

const (
	orderID1 = "0f8fad5b-d9cb-469f-a165-70867728950e"
	orderID2 = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
)

func putOrder(t *testing.T, store *fakeStore, view, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := authed(http.MethodPut, "/api/kb-user-order/"+view, body)
	req.SetPathValue("view", view)
	rec := httptest.NewRecorder()
	kbfilters.NewHandler(store).SetOrder(rec, req)
	return rec
}

func TestListOrdersShowsUnsavedViewsAsNull(t *testing.T) {
	for _, tc := range []struct {
		name   string
		orders map[kbfilters.OrderView][]string
		want   string
	}{
		{"nothing saved", nil, `{"my":null,"shared":null}`},
		{"one view saved", map[kbfilters.OrderView][]string{kbfilters.OrderViewMy: {orderID1, orderID2}},
			`{"my":["` + orderID1 + `","` + orderID2 + `"],"shared":null}`},
		{"saved empty", map[kbfilters.OrderView][]string{kbfilters.OrderViewShared: {}},
			`{"my":null,"shared":[]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeStore{orders: tc.orders}
			rec := httptest.NewRecorder()
			kbfilters.NewHandler(store).ListOrders(rec, authed(http.MethodGet, "/api/kb-user-order", ""))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body)
			}
			if got := strings.TrimSpace(rec.Body.String()); got != tc.want {
				t.Fatalf("body = %s, want %s", got, tc.want)
			}
			if store.gotUserID != testUserID {
				t.Fatalf("store got user %q, want %q", store.gotUserID, testUserID)
			}
		})
	}
}

func TestSetOrderStoresCanonicalIDsInOrder(t *testing.T) {
	store := &fakeStore{}
	rec := putOrder(t, store, "shared",
		`{"ids":["urn:uuid:`+orderID2+`","`+strings.ToUpper(orderID1)+`"]}`)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 (body: %s)", rec.Code, rec.Body)
	}
	if store.gotUserID != testUserID || store.gotView != kbfilters.OrderViewShared {
		t.Fatalf("store got (%q, %q), want (%q, shared)", store.gotUserID, store.gotView, testUserID)
	}
	if want := []string{orderID2, orderID1}; fmt.Sprint(store.gotIDs) != fmt.Sprint(want) {
		t.Fatalf("store got ids %v, want %v", store.gotIDs, want)
	}
}

// An empty array is an order too (a view without topics), and the store must
// get a non-nil slice: kb_ids is NOT NULL.
func TestSetOrderAcceptsAnEmptyOrder(t *testing.T) {
	store := &fakeStore{}
	rec := putOrder(t, store, "my", `{"ids":[]}`)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 (body: %s)", rec.Code, rec.Body)
	}
	if store.calls != 1 || store.gotIDs == nil || len(store.gotIDs) != 0 {
		t.Fatalf("store calls = %d, ids = %#v; want one call with an empty non-nil slice", store.calls, store.gotIDs)
	}
}

func TestSetOrderAcceptsExactlyMaxOrderLen(t *testing.T) {
	store := &fakeStore{}
	rec := putOrder(t, store, "my", orderBody(kbfilters.MaxOrderLen))

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 (body: %s)", rec.Code, rec.Body)
	}
	if len(store.gotIDs) != kbfilters.MaxOrderLen {
		t.Fatalf("store got %d ids, want %d", len(store.gotIDs), kbfilters.MaxOrderLen)
	}
}

// Every refusal happens before the write: the store is never called.
func TestSetOrderRefusesWhatIsNotAnOrder(t *testing.T) {
	for _, tc := range []struct {
		name, view, body string
		want             int
	}{
		{"unknown view", "global", `{"ids":[]}`, http.StatusNotFound},
		{"empty view", "", `{"ids":[]}`, http.StatusNotFound},
		{"view in another case", "My", `{"ids":[]}`, http.StatusNotFound},
		{"not JSON", "my", `ids=1`, http.StatusBadRequest},
		{"no ids", "my", `{}`, http.StatusBadRequest},
		{"null ids", "my", `{"ids":null}`, http.StatusBadRequest},
		{"ids not an array", "my", `{"ids":"` + orderID1 + `"}`, http.StatusBadRequest},
		{"not a UUID", "my", `{"ids":["` + orderID1 + `","kb-2"]}`, http.StatusBadRequest},
		{"repeated topic", "my", `{"ids":["` + orderID1 + `","` + orderID2 + `","` + orderID1 + `"]}`, http.StatusBadRequest},
		{"repeat in another spelling", "my", `{"ids":["` + orderID1 + `","{` + orderID1 + `}"]}`, http.StatusBadRequest},
		{"too many ids", "my", orderBody(kbfilters.MaxOrderLen + 1), http.StatusBadRequest},
		{"body too large", "my", `{"ids":[],"pad":"` + strings.Repeat("x", 200<<10) + `"}`, http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeStore{}
			rec := putOrder(t, store, tc.view, tc.body)

			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d (body: %s)", rec.Code, tc.want, rec.Body)
			}
			if store.calls != 0 {
				t.Fatalf("store called %d times, want 0", store.calls)
			}
		})
	}
}

func TestOrderRoutesUnauthenticatedAre401(t *testing.T) {
	store := &fakeStore{}
	h := kbfilters.NewHandler(store)

	rec := httptest.NewRecorder()
	h.ListOrders(rec, httptest.NewRequest(http.MethodGet, "/api/kb-user-order", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET status = %d, want 401", rec.Code)
	}

	req := httptest.NewRequest(http.MethodPut, "/api/kb-user-order/my", strings.NewReader(`{"ids":[]}`))
	req.SetPathValue("view", "my")
	rec = httptest.NewRecorder()
	h.SetOrder(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("PUT status = %d, want 401", rec.Code)
	}
	if store.calls != 0 {
		t.Fatalf("store called %d times, want 0", store.calls)
	}
}

func TestOrderStoreFailureIs500(t *testing.T) {
	store := &fakeStore{err: fmt.Errorf("boom")}
	h := kbfilters.NewHandler(store)

	rec := httptest.NewRecorder()
	h.ListOrders(rec, authed(http.MethodGet, "/api/kb-user-order", ""))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("GET status = %d, want 500", rec.Code)
	}
	if rec := putOrder(t, store, "my", `{"ids":[]}`); rec.Code != http.StatusInternalServerError {
		t.Fatalf("PUT status = %d, want 500", rec.Code)
	}
}

// orderBody builds {"ids": [...]} with n distinct UUIDs.
func orderBody(n int) string {
	var b strings.Builder
	b.WriteString(`{"ids":[`)
	for i := range n {
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, `"00000000-0000-4000-8000-%012d"`, i)
	}
	b.WriteString(`]}`)
	return b.String()
}
