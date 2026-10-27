# Chat SSE: early open (`chat_sse_early_open_enabled`)

Applies to `POST /api/kb/{id}/chat?stream=true` when the KB has the flag on (default off).

- The response (HTTP 200, `text/event-stream`) starts immediately with an SSE comment line `: open`. While the server prepares the answer it writes `: ping` every 15 s. Both are comments and carry no `data:` field; `parseSseStream` already ignores them.
- Trajectory/progress frames (`{"stage": …}`, `{"agentTrajectory": …}`, `{"supervisorStage": …}`, …) stream live during preparation, so they now arrive **before** the opening `{sources, chatId, userMessageId, …}` frame on every path (the deep-chat path already did this). Each frame is sent once; nothing is replayed after the opening frame.
- If an orchestrator fails and the turn falls back to the standard path, the progress frames it already sent stay in the stream (with the flag off they were dropped). An `orchestrator_policy` / `fallthrough` trajectory frame announces the fallback only for a policy-forced orchestrator; a flag-driven orchestrator failure falls back to the standard path without an announcing frame, and its progress frames simply stay in the stream.
- Two failures that used to be HTTP 500 JSON responses now arrive as `data: {"error": "failed to prepare context"}` / `{"error": "failed to save user message"}` followed by `data: [DONE]`, with HTTP 200. Validation errors (4xx) are unchanged: they are decided before the stream opens.
- A server panic after the stream has opened ends it without `data: [DONE]` (the 200 is already sent). Treat end-of-stream without `[DONE]` as an error.
- On KB chat, `followUpQuestions` may now arrive before the `refine_start` / `refine_complete` trajectory frames (follow-ups no longer wait for the factcheck). This applies whether or not the early-open flag is on.
- Suggested FE use: show the reasoning panel as soon as the first `stage` frame arrives.

Citation visibility applies to these frames as to every other frame of the turn: for a caller without `capabilities.seeCitations`, the opening frame carries `"sources": []` and trajectory frames carry no `chunks` (API.md § Citations). The order and the heartbeat are unchanged.
