# Chat SSE: early open (`chat_sse_early_open_enabled`)

Applies to `POST /api/kb/{id}/chat?stream=true` when the KB has the flag on (default off).

- The response (HTTP 200, `text/event-stream`) starts immediately with an SSE comment line `: open`. While the server prepares the answer it writes `: ping` every 15 s. Both are comments and carry no `data:` field; `parseSseStream` already ignores them.
- Trajectory/progress frames (`{"stage": …}`, `{"agentTrajectory": …}`, `{"supervisorStage": …}`, …) stream live during preparation, so they now arrive **before** the opening `{sources, chatId, userMessageId, …}` frame on every path (the deep-chat path already did this). Each frame is sent once; nothing is replayed after the opening frame.
- If an orchestrator fails and the turn falls back to the standard path, the progress frames it already sent stay in the stream (with the flag off they were dropped). The fallback is announced by an `orchestrator_policy` / `fallthrough` trajectory frame where it was before.
- Two failures that used to be HTTP 500 JSON responses now arrive as `data: {"error": "failed to prepare context"}` / `{"error": "failed to save user message"}` followed by `data: [DONE]`, with HTTP 200. Validation errors (4xx) are unchanged: they are decided before the stream opens.
- Suggested FE use: show the reasoning panel as soon as the first `stage` frame arrives.
