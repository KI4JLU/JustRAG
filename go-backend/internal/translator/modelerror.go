package translator

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/justrag/go-backend/internal/ai"
)

// The causes of a failed model call a user can tell apart. Each wraps
// ErrModel, so a caller that does not care still matches ErrModel.
var (
	// ErrModelTimeout means the model did not answer within the time the
	// text allows: 504.
	ErrModelTimeout = fmt.Errorf("%w: no answer in time", ErrModel)
	// ErrModelUnavailable means no provider can be asked at all, none is
	// active or it refuses the credentials; only an administrator can fix
	// that: 503.
	ErrModelUnavailable = fmt.Errorf("%w: no usable provider", ErrModel)
)

// statusClientClosedRequest is the status for a request whose client left
// before the answer (the nginx convention; net/http has no name for it).
const statusClientClosedRequest = 499

// A model call may take 30 seconds and 10 milliseconds for each character of
// the text sent, at most completionTimeoutMax. The cap stays below the
// server's 120 second write timeout, so a call that runs out of time can still
// be answered with an error instead of a dropped connection.
const (
	completionTimeoutMin     = 30 * time.Second
	completionTimeoutPerRune = 10 * time.Millisecond
	completionTimeoutMax     = 110 * time.Second
)

// completionTimeoutFor bounds one model call for the text it is sent.
func completionTimeoutFor(user string) time.Duration {
	d := completionTimeoutMin + time.Duration(utf8.RuneCountInString(user))*completionTimeoutPerRune
	return min(d, completionTimeoutMax)
}

// classifyModelError names the cause of a failed model call: a timeout, a
// provider that cannot be used, or any other failure, as an error that wraps
// both ErrModel (or a more specific one below it) and err.
func classifyModelError(err error) error {
	var api *ai.APIError
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return fmt.Errorf("%w: %w", ErrModelTimeout, err)
	case errors.Is(err, ai.ErrNoActiveProvider),
		errors.As(err, &api) && (api.StatusCode == http.StatusUnauthorized || api.StatusCode == http.StatusForbidden):
		return fmt.Errorf("%w: %w", ErrModelUnavailable, err)
	default:
		return fmt.Errorf("%w: %w", ErrModel, err)
	}
}

// failureEmptyAnswer is the log class of a model that answered without text.
const failureEmptyAnswer = "empty_answer"

// modelFailureClass names a failed model call for the log: the failure class
// and, for an error answer of the provider, its HTTP status, never the error's
// text (ai.FailureClass).
func modelFailureClass(err error) (class string, status int) {
	if errors.Is(err, ErrEmptyAnswer) {
		return failureEmptyAnswer, 0
	}
	return ai.FailureClass(err)
}
