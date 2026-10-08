package processor

import (
	"context"
	"testing"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/parser"
	"github.com/justrag/go-backend/internal/siteconfig"
)

// fpConfigStore is an ai.ConfigStore with one active provider and one
// embedding model, both adjustable per test.
type fpConfigStore struct {
	providerID string
	model      string
	dims       int
}

func (s fpConfigStore) GetActiveAIProvider(context.Context) (*ai.AIProviderInfo, error) {
	return &ai.AIProviderInfo{ID: s.providerID, Name: "p", BaseURL: "http://x"}, nil
}

func (s fpConfigStore) GetAIProviderByID(context.Context, string) (*ai.AIProviderInfo, error) {
	return nil, nil
}

func (s fpConfigStore) GetAIModelsByProvider(context.Context, string) ([]ai.AIModelInfo, error) {
	return []ai.AIModelInfo{
		{Name: "chat-m"},
		{Name: s.model, IsEmbedding: true, Dimensions: s.dims},
	}, nil
}

func (s fpConfigStore) GetKBModelOverrides(context.Context, string) (*ai.KBModelOverrides, error) {
	return nil, nil
}

func fpProcessor(cs fpConfigStore, cfg map[string]string, st ProcessorStore) *Processor {
	vals := map[string]*string{}
	for k, v := range cfg {
		vals[k] = strPtr(v)
	}
	p := NewProcessor(parser.DefaultFactoryWith(nil), ai.NewConfigResolver(cs), nil, st)
	p.SetSiteConfigReader(&fakeSiteConfigReader{values: vals})
	return p
}

func fpBase() fpConfigStore { return fpConfigStore{providerID: "prov-1", model: "emb-a", dims: 1024} }

func fingerprintOf(t *testing.T, cs fpConfigStore, cfg map[string]string, size, overlap int) string {
	t.Helper()
	fp, err := fpProcessor(cs, cfg, &mockStore{}).IndexFingerprint(context.Background(), "kb-1", size, overlap)
	if err != nil {
		t.Fatal(err)
	}
	return fp
}

func TestIndexFingerprint_Sensitivity(t *testing.T) {
	base := fpBase()
	on := map[string]string{
		"contextual_enrichment": "true", "contextual_enrichment_model": "e1",
		"hype_enabled": "true", "hype_model": "h1",
		"raptor_enabled": "true", "kg_extraction_enabled": "true", "kg_extraction_model": "k1",
	}
	with := func(over map[string]string) map[string]string {
		m := map[string]string{}
		for k, v := range on {
			m[k] = v
		}
		for k, v := range over {
			m[k] = v
		}
		return m
	}
	tests := []struct {
		name     string
		cs       fpConfigStore
		cfg      map[string]string
		size, ov int
	}{
		{"embedding model", fpConfigStore{"prov-1", "emb-b", 1024}, on, 512, 100},
		{"dims", fpConfigStore{"prov-1", "emb-a", 2048}, on, 512, 100},
		{"provider", fpConfigStore{"prov-2", "emb-a", 1024}, on, 512, 100},
		{"chunk size", base, on, 256, 100},
		{"chunk overlap", base, on, 512, 50},
		{"parent_child on", base, with(map[string]string{"parent_child_enabled": "true"}), 512, 100},
		{"parent size (pc on)", base, with(map[string]string{"parent_child_enabled": "true", "parent_chunk_size": "3000"}), 512, 100},
		{"enrichment off", base, with(map[string]string{"contextual_enrichment": "false"}), 512, 100},
		{"enrichment model", base, with(map[string]string{"contextual_enrichment_model": "e2"}), 512, 100},
		{"late chunking", base, with(map[string]string{"late_chunking_enabled": "true"}), 512, 100},
		{"late chunking tokens", base, with(map[string]string{"late_chunking_enabled": "true", "late_chunking_max_input_tokens": "4096"}), 512, 100},
		{"hype off", base, with(map[string]string{"hype_enabled": "false"}), 512, 100},
		{"hype model", base, with(map[string]string{"hype_model": "h2"}), 512, 100},
		{"raptor off", base, with(map[string]string{"raptor_enabled": "false"}), 512, 100},
		{"raptor max levels (on)", base, with(map[string]string{"raptor_max_levels": "7"}), 512, 100},
		{"kg off", base, with(map[string]string{"kg_extraction_enabled": "false"}), 512, 100},
		{"kg model", base, with(map[string]string{"kg_extraction_model": "k2"}), 512, 100},
		{"parse config", base, with(map[string]string{"docling_force_ocr": "true"}), 512, 100},
	}
	ref := fingerprintOf(t, base, on, 512, 100)
	if ref != fingerprintOf(t, base, on, 512, 100) {
		t.Fatal("fingerprint is not deterministic")
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := fingerprintOf(t, tc.cs, tc.cfg, tc.size, tc.ov); got == ref {
				t.Errorf("fingerprint unchanged by %s", tc.name)
			}
		})
	}
}

func TestIndexFingerprint_Insensitivity(t *testing.T) {
	base := fpBase()
	off := map[string]string{"contextual_enrichment": "false"} // kg/raptor/hype default off
	ref := fingerprintOf(t, base, off, 512, 100)
	for _, tc := range []struct{ key, val string }{
		{"kg_extraction_model", "other"},       // KG off
		{"raptor_max_levels", "9"},             // RAPTOR off
		{"hype_model", "other"},                // HyPE off
		{"contextual_enrichment_model", "oth"}, // enrichment off
		{"late_chunking_max_input_tokens", "1"},
		{"parent_chunk_size", "9999"},
		{"embedding_batch_size", "7"},
		{"ingest_enrich_concurrency", "3"},
		{"kg_extraction_concurrency", "9"},
		{"ingest_screening_enabled", "false"},
		{"tabular_large_file_concurrency", "4"},
	} {
		cfg := map[string]string{tc.key: tc.val}
		for k, v := range off {
			cfg[k] = v
		}
		if got := fingerprintOf(t, base, cfg, 512, 100); got != ref {
			t.Errorf("%s changed the fingerprint", tc.key)
		}
	}
}

// Drift guard: every per-KB RequiresReingest registry key must feed the
// fingerprint or be explicitly excluded with a reason.
func TestIndexFingerprint_DriftGuard(t *testing.T) {
	// Everything on, so every conditional sub-key is present too.
	allOn := map[string]string{
		"parent_child_enabled": "true", "contextual_enrichment": "true",
		"late_chunking_enabled": "true", "hype_enabled": "true",
		"raptor_enabled": "true", "kg_extraction_enabled": "true",
	}
	in, err := fpProcessor(fpBase(), allOn, &mockStore{}).IndexFingerprintInputs(context.Background(), "kb-1", 512, 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range siteconfig.All() {
		if !f.RequiresReingest {
			continue
		}
		_, inFP := in[f.Key]
		reason, excluded := fingerprintExcluded[f.Key]
		if !inFP && !excluded {
			t.Errorf("RequiresReingest key %q is neither a fingerprint input nor in fingerprintExcluded", f.Key)
		}
		if inFP && excluded {
			t.Errorf("key %q is both a fingerprint input and excluded", f.Key)
		}
		if excluded && reason == "" {
			t.Errorf("excluded key %q has no reason", f.Key)
		}
	}
	for k := range fingerprintExcluded {
		if fld, ok := siteconfig.Field(k); !ok || !fld.RequiresReingest {
			t.Errorf("fingerprintExcluded lists %q which is not a RequiresReingest registry key", k)
		}
	}
}

func fpInput(userFileID string) ProcessFileInput {
	return ProcessFileInput{FileID: "f1", FileName: "doc.txt", MimeType: "text/plain", KBID: "kb-1",
		UserFileID: userFileID, OwnerUserID: "o1"}
}

func TestRecordIndexFingerprint(t *testing.T) {
	ctx := context.Background()
	t.Run("library file writes", func(t *testing.T) {
		st := &mockStore{}
		p := fpProcessor(fpBase(), nil, st)
		p.recordIndexFingerprint(ctx, fpInput("uf-1"))
		if st.fingerprints["f1"] == "" {
			t.Fatal("fingerprint not written")
		}
	})
	t.Run("non-library skips", func(t *testing.T) {
		st := &mockStore{}
		fpProcessor(fpBase(), nil, st).recordIndexFingerprint(ctx, fpInput(""))
		if len(st.fingerprints) != 0 {
			t.Fatal("fingerprint written for non-library file")
		}
	})
	t.Run("resolver failure is best-effort", func(t *testing.T) {
		st := &mockStore{}
		p := NewProcessor(parser.DefaultFactoryWith(nil), ai.NewConfigResolver(noProviderConfigStore{}), nil, st)
		p.recordIndexFingerprint(ctx, fpInput("uf-1")) // must not panic
		if len(st.fingerprints) != 0 {
			t.Fatal("fingerprint written despite error")
		}
	})
}

// End to end through ProcessFile: only a completed run writes it.
func TestProcessFile_FingerprintOnlyOnCompleted(t *testing.T) {
	// An empty document completes with "no chunks produced" and never needs
	// the embedder.
	for _, tc := range []struct {
		name       string
		userFileID string
		want       bool
	}{
		{"library completed", "uf-1", true},
		{"non-library completed", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			st := &mockStore{}
			p := fpProcessor(fpBase(), nil, st)
			in := fpInput(tc.userFileID)
			in.FilePath = writeTempText(t, "   ")
			if err := p.ProcessFile(context.Background(), in); err != nil {
				t.Fatalf("ProcessFile: %v", err)
			}
			if got := st.fingerprints["f1"] != ""; got != tc.want {
				t.Errorf("fingerprint written = %v, want %v (statuses %v)", got, tc.want, st.statuses)
			}
		})
	}
	t.Run("error run writes none", func(t *testing.T) {
		st := &mockStore{}
		p := NewProcessor(parser.DefaultFactoryWith(nil), ai.NewConfigResolver(noProviderConfigStore{}), nil, st)
		p.SetSiteConfigReader(&fakeSiteConfigReader{values: map[string]*string{}})
		in := fpInput("uf-1")
		in.FilePath = writeTempText(t, "some real text content")
		_ = p.ProcessFile(context.Background(), in)
		if len(st.fingerprints) != 0 {
			t.Errorf("fingerprint written for a non-completed run (statuses %v)", st.statuses)
		}
	})
}
