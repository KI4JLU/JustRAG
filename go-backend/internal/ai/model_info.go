package ai

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// ModelInfo is one entry of the provider's GET /models listing.
type ModelInfo struct {
	ID string `json:"id"`
	// ContextWindow is the model's context window in tokens, when the server
	// reports one (vLLM: max_model_len); 0 otherwise.
	ContextWindow int `json:"contextWindow,omitempty"`
}

// modelsResponse is the OpenAI-compatible model listing. max_model_len is a
// vLLM extension; servers without it leave the field absent.
type modelsResponse struct {
	Data []struct {
		ID          string `json:"id"`
		MaxModelLen int    `json:"max_model_len"`
	} `json:"data"`
}

// liteLLMModelInfoResponse is a LiteLLM proxy's GET /model/info: per model
// alias its model_info, whose max_input_tokens is the input limit (the
// window minus the output reserve the proxy keeps) and max_tokens the window.
type liteLLMModelInfoResponse struct {
	Data []struct {
		ModelName string `json:"model_name"`
		ModelInfo *struct {
			MaxInputTokens *int `json:"max_input_tokens"`
			MaxTokens      *int `json:"max_tokens"`
		} `json:"model_info"`
	} `json:"data"`
}

// ModelInfos lists the provider's models with their context windows, when
// the server reports them: vLLM in GET /models (max_model_len), a LiteLLM
// proxy in GET /model/info at the server root (max_input_tokens, else
// max_tokens). Models the server says nothing about have no window. 10 s
// timeout per call, like ListModels.
func (c *Client) ModelInfos(ctx context.Context) ([]ModelInfo, error) {
	lctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var resp modelsResponse
	if err := c.doJSON(lctx, http.MethodGet, "models", nil, &resp); err != nil {
		return nil, fmt.Errorf("ai: list models: %w", err)
	}
	out := make([]ModelInfo, 0, len(resp.Data))
	reported := false
	for _, m := range resp.Data {
		out = append(out, ModelInfo{ID: m.ID, ContextWindow: max(m.MaxModelLen, 0)})
		reported = reported || m.MaxModelLen > 0
	}
	if reported {
		return out, nil
	}
	windows := c.liteLLMWindows(ctx)
	for i := range out {
		if w := windows[out[i].ID]; w > 0 {
			out[i].ContextWindow = w
		}
	}
	return out, nil
}

// liteLLMWindows reads a LiteLLM proxy's /model/info. Any failure (not a
// LiteLLM proxy, no access) is an empty map: the windows are a hint.
func (c *Client) liteLLMWindows(ctx context.Context) map[string]int {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var resp liteLLMModelInfoResponse
	if err := c.doJSONURL(ctx, http.MethodGet, c.serverRootURL()+"model/info", nil, &resp); err != nil {
		return nil
	}
	out := make(map[string]int, len(resp.Data))
	for _, m := range resp.Data {
		if m.ModelInfo == nil {
			continue
		}
		w := 0
		switch {
		case m.ModelInfo.MaxInputTokens != nil && *m.ModelInfo.MaxInputTokens > 0:
			w = *m.ModelInfo.MaxInputTokens
		case m.ModelInfo.MaxTokens != nil && *m.ModelInfo.MaxTokens > 0:
			w = *m.ModelInfo.MaxTokens
		}
		if w > 0 && out[m.ModelName] == 0 {
			out[m.ModelName] = w
		}
	}
	return out
}

// tokenizeRequest / tokenizeResponse are vLLM's POST /tokenize shapes. count
// is the number of prompt tokens under the model's own tokenizer.
type tokenizeRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
	// AddSpecialTokens false counts the text alone, without BOS/EOS.
	AddSpecialTokens bool `json:"add_special_tokens"`
}

type tokenizeResponse struct {
	Count int `json:"count"`
}

// tokenizeTimeout bounds one count; a large document tokenizes in well under
// a second on vLLM.
const tokenizeTimeout = 30 * time.Second

// CountTokens counts text with model's own tokenizer through vLLM's
// /tokenize endpoint, which sits at the server root, next to /v1. Servers
// without the endpoint answer 404; callers fall back to an estimate.
func (c *Client) CountTokens(ctx context.Context, model, text string) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, tokenizeTimeout)
	defer cancel()
	var resp tokenizeResponse
	if err := c.doJSONURL(ctx, http.MethodPost, c.serverRootURL()+"tokenize",
		tokenizeRequest{Model: model, Prompt: text}, &resp); err != nil {
		return 0, fmt.Errorf("ai: tokenize: %w", err)
	}
	return resp.Count, nil
}

// serverRootURL is the base URL without its trailing OpenAI version segment
// ("http://host:8000/v1/" → "http://host:8000/"). A base URL without one is
// returned unchanged.
func (c *Client) serverRootURL() string {
	if root, ok := strings.CutSuffix(c.baseURL, "v1/"); ok {
		return root
	}
	return c.baseURL
}
