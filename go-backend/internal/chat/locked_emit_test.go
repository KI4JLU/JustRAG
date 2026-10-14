package chat

import (
	"sync"
	"testing"
)

func TestLockedEmit_NilStaysNil(t *testing.T) {
	if lockedEmit(nil) != nil {
		t.Fatal("lockedEmit(nil) must be nil so non-streaming callers keep skipping emits")
	}
}

func TestLockedEmit_SerialisesConcurrentCalls(t *testing.T) {
	inFlight, maxInFlight := 0, 0
	emit := lockedEmit(func(map[string]any) {
		inFlight++
		if inFlight > maxInFlight {
			maxInFlight = inFlight
		}
		inFlight--
	})
	var wg sync.WaitGroup
	for range 50 {
		wg.Add(1)
		go func() { defer wg.Done(); emit(map[string]any{"x": 1}) }()
	}
	wg.Wait()
	if maxInFlight != 1 {
		t.Fatalf("max concurrent emits = %d, want 1", maxInFlight)
	}
}
