package worker

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/justrag/go-backend/internal/middleware"
	"github.com/justrag/go-backend/internal/safego"
)

// HealthServer exposes /healthz and /readyz endpoints for K8s probes and,
// when asked (WORKER_METRICS), /metrics: the worker process's Prometheus
// registry — the file parser runs here, so parser metrics such as
// rustparser_shadow_total are only observable from the worker, not from the
// server's /metrics. That endpoint is unauthenticated, unlike the server's
// admin-gated one, so it is off unless the deployment opts in.
type HealthServer struct {
	ready atomic.Bool
	srv   *http.Server
}

// NewHealthServer creates a health server on the given port; serveMetrics
// adds GET /metrics.
func NewHealthServer(port int, serveMetrics bool) *HealthServer {
	hs := &HealthServer{}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "ok")
	})
	if serveMetrics {
		mux.HandleFunc("GET /metrics", middleware.MetricsHandler())
	}
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, _ *http.Request) {
		if hs.ready.Load() {
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, "ok")
		} else {
			w.WriteHeader(http.StatusServiceUnavailable)
			fmt.Fprint(w, "not ready")
		}
	})

	hs.srv = &http.Server{
		Addr:    fmt.Sprintf(":%d", port),
		Handler: mux,
		// Probe requests are tiny; without this a peer that opens a
		// connection and never sends headers pins a goroutine forever.
		ReadHeaderTimeout: 10 * time.Second,
	}
	return hs
}

// Start begins listening in a background goroutine.
func (hs *HealthServer) Start() {
	safego.Go(func() {
		slog.Info("worker health server listening", "addr", hs.srv.Addr)
		if err := hs.srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("worker health server error", "error", err)
		}
	})
}

// SetReady marks the worker as ready to receive traffic.
func (hs *HealthServer) SetReady(ready bool) {
	hs.ready.Store(ready)
}

// Shutdown gracefully stops the health server, draining in-flight probe
// requests within a 30s window (matching the Asynq server's shutdown grace)
// before forcing connections closed. srv.Shutdown is the idiomatic match for
// the graceful drain the rest of the worker already performs; the prior
// srv.Close() abruptly dropped any in-flight /readyz connection.
func (hs *HealthServer) Shutdown() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := hs.srv.Shutdown(ctx); err != nil {
		// Drain window exceeded (or another error) — force-close the rest.
		_ = hs.srv.Close()
	}
}
