package observability

import (
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

// histogramCount returns the observation count of one label value.
func histogramCount(t *testing.T, h *prometheus.HistogramVec, label string) uint64 {
	t.Helper()
	var m dto.Metric
	if err := h.WithLabelValues(label).(prometheus.Histogram).Write(&m); err != nil {
		t.Fatalf("write histogram: %v", err)
	}
	return m.GetHistogram().GetSampleCount()
}
