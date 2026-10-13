package chat

import "sync"

// lockedEmit serialises emit so goroutines in the post-response fan-out can
// write SSE frames directly instead of waiting for wg.Wait. nil stays nil.
func lockedEmit(emit func(map[string]any)) func(map[string]any) {
	if emit == nil {
		return nil
	}
	var mu sync.Mutex
	return func(pl map[string]any) {
		mu.Lock()
		defer mu.Unlock()
		emit(pl)
	}
}
