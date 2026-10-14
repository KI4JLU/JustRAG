package observability

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var owuiRequests = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Name:        "rag_owui_requests_total",
		Help:        "Requests on the Open WebUI compatibility surface (ILIAS plugin), by route and outcome.",
		ConstLabels: commonLabels,
	},
	[]string{"route", "outcome"},
)

var owuiKBFilesError = promauto.NewGauge(prometheus.GaugeOpts{
	Name: "rag_owui_kb_files_error",
	Help: "KB files linked through the Open WebUI surface whose ingest ended in status 'error'. " +
		"The plugin sees such files as completed, so this gauge is the only signal that course material is missing.",
	ConstLabels: commonLabels,
})

// RecordOWUIRequest counts one request. route is a fixed name ("upload",
// "file_status", …), outcome one of "ok", "unsupported", "not_found", "error".
func RecordOWUIRequest(route, outcome string) { owuiRequests.WithLabelValues(route, outcome).Inc() }

// SetOWUIKBFilesError publishes the error-file count (worker metrics tick).
func SetOWUIKBFilesError(n float64) { owuiKBFilesError.Set(n) }
