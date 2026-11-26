package ai

import (
	"context"
	"errors"
)

// upstreamStatus returns the HTTP status of the provider's answer when err
// carries one.
func upstreamStatus(err error) (int, bool) {
	var api *APIError
	if errors.As(err, &api) {
		return api.StatusCode, true
	}
	return 0, false
}

// Failure classes of FailureClass.
const (
	FailureUpstream   = "upstream_status"
	FailureTimeout    = "timeout"
	FailureCanceled   = "canceled"
	FailureNoProvider = "no_provider"
	FailureMalformed  = "malformed_answer"
	FailureTransport  = "transport"
)

// FailureClass names what kind of failure err is and, for an error answer of
// the provider, its HTTP status (0 otherwise). It is what a log line may say
// about a failed model call: APIError.Error() carries the provider's response
// body, and a provider may echo the submitted text (a user's text, glossary
// terms) back in it, so the error itself must not reach a log.
func FailureClass(err error) (class string, status int) {
	if s, ok := upstreamStatus(err); ok {
		return FailureUpstream, s
	}
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return FailureTimeout, 0
	case errors.Is(err, context.Canceled):
		return FailureCanceled, 0
	case errors.Is(err, ErrNoActiveProvider):
		return FailureNoProvider, 0
	case errors.Is(err, ErrMalformedJSON):
		return FailureMalformed, 0
	default:
		return FailureTransport, 0
	}
}
