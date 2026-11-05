package processor

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/hibiken/asynq"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/parser"
)

type tooLargeTranscriber struct{}

func (tooLargeTranscriber) Transcribe(context.Context, string, string, string, string) (string, error) {
	return "", fmt.Errorf("%w: \"talk.mp3\" is 27 MB", ai.ErrAudioTooLarge)
}

// KI-960: an audio file over the transcription limit is recorded under its
// own stage (not "parse", which the UI words as "may be damaged") and is not
// retried.
func TestProcessFile_AudioTooLargeHasOwnStageAndNoRetry(t *testing.T) {
	store := &mockStore{}
	factory := parser.NewFactory()
	factory.Register(&parser.AudioParser{Transcriber: tooLargeTranscriber{}})
	p := NewProcessor(factory, nil, nil, store)

	err := p.ProcessFile(context.Background(), ProcessFileInput{
		FileID: "f-audio", FilePath: "/tmp/talk.mp3", FileName: "talk.mp3", MimeType: "audio/mpeg", KBID: "kb",
	})
	if !errors.Is(err, asynq.SkipRetry) || !errors.Is(err, ai.ErrAudioTooLarge) {
		t.Fatalf("err = %v, want SkipRetry wrapping ErrAudioTooLarge", err)
	}
	if len(store.errStages) != 1 || store.errStages[0] != "too_large" {
		t.Errorf("error stages = %v, want [too_large]", store.errStages)
	}
}
