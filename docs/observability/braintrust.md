# Braintrust: traces, evals and feedback

Braintrust is where we watch Marketer's AI work and decide whether a change made it better. Every model call and agent run becomes a trace, people's reactions become scores on those traces, and every prompt, model or tool change runs against the same datasets before it ships.

It is an observability tool, not a runtime dependency. If Braintrust is down, unconfigured or slow, Marketer behaves exactly the same.

## What goes where

| Surface | What Braintrust receives | How |
|---|---|---|
| Agent (Cloudflare Worker) | One trace per run: the waking message, each model turn, tool calls and results, decision-model calls, rails outcomes, cost and latency | The agent's existing span pipeline (`traceExporters` in `agent/src/lib/platform.ts`) gains a Braintrust OTLP exporter beside Langfuse and the generic OTLP exporter |
| Backend (FastAPI, Modal) | Spans for every model call: OpenRouter text, decision models, image, TTS, transcription, music; and the content pipelines that make articles and videos | The existing OpenTelemetry setup (`src/marketer/services/otel.py`) gains a Braintrust span processor |
| People | Thumbs up or down (with an optional comment) on agent replies; approve or reject on agent approvals | Scores logged as feedback on the run's trace |
| CI | Agent eval datasets (`agent/evals/*.yaml`) and the decision-model conformance cases, as Braintrust experiments compared with the main-branch baseline | A CI job that runs only when `BRAINTRUST_API_KEY` is set |

## Rules

1. **Off unless configured.** Nothing is sent unless `BRAINTRUST_API_KEY` and `BRAINTRUST_PROJECT_ID` are set. Unset is a supported, tested configuration.
2. **Never on the hot path.** Export is batched and asynchronous (on Workers, through `ctx.waitUntil`). An export error is logged once and dropped, never retried in a loop and never surfaced to a person. Each export has a timeout.
3. **Masking before export, on both sides.** A single masking function per side runs over every attribute before it leaves:
   - the existing secret redaction (agent `memory/redact.ts`; backend equivalent);
   - emails, phone numbers and card-like numbers are replaced;
   - attributes named like `authorization`, `cookie`, `token`, `secret`, `password`, `api_key` are dropped.
4. **Content mode.** `BRAINTRUST_CONTENT` sets how much text is exported:
   - `redacted` (default): prompts and outputs, after masking;
   - `metadata`: no prompt or output text at all, only model, tokens, cost, latency, tool names, outcomes and scores;
   - `full` is not offered: masking always runs.
   A workspace can set "Don't send AI content to our observability provider" (`security:manage`). Its traces are then exported in `metadata` mode whatever the global setting.
5. **Personal memory never leaves.** Recall content (personal or team) is never put on a span. Recall spans carry counts, timing and scope kind only. The same holds for anything wrapped as untrusted content from a person's personal memory.
6. **Identity on spans is opaque.** Spans carry `tenant_id`, `actor_id` (person id), `conversation_id`, `agent`, `role`, environment and release. Never email, name or IP.
7. **Prompts stay in the repo.** Prompts are code, reviewed in pull requests. Marketer never loads a prompt from Braintrust at runtime; that would put a vendor on the path of every reply. A script may push repo prompts to Braintrust for the playground.
8. **Models stay on OpenRouter.** We do not route model calls through Braintrust's proxy.
9. **Feedback is authorized.** A person can score only runs from a conversation in their own workspace that they can see, and the score records their person id. The browser never holds the Braintrust key; feedback goes through our servers.
10. **Region.** `BRAINTRUST_API_URL` defaults to `https://api.braintrust.dev`. EU workspaces use `https://api-eu.braintrust.dev`; a self-hosted data plane uses its own URL.

## Transport

OpenTelemetry over HTTP:

- Traces: `POST {BRAINTRUST_API_URL}/otel/v1/traces`
- Headers: `Authorization: Bearer {BRAINTRUST_API_KEY}` and `x-bt-parent: project_id:{BRAINTRUST_PROJECT_ID}`
- A 200 response can still reject spans (`partialSuccess.rejectedSpans`); count and log them.

Model spans follow the OpenTelemetry GenAI conventions (`gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, prompt and completion content) so Braintrust shows them as LLM calls. Each run's root span names the agent and carries the identity attributes above, so filtering by workspace or person works in Braintrust.

Feedback uses Braintrust's REST API for project logs, attached to the run's root span id.

## Scores

| Score | Source | Values |
|---|---|---|
| `user_rating` | Thumbs on an agent reply | 1 or 0, optional comment |
| `approval` | A person deciding an agent approval | 1 approved, 0 rejected |
| `rails_blocked` | The rails refused or parked an action | 1 or 0 |
| `decision_fallback` | A decision model failed and the rule-based fallback answered | 1 or 0 |

Online scorers (LLM-as-judge on a sample of production traces) are set up in Braintrust, not in code. Start with: the reply follows the brand voice; claims match the brand kit and confirmed facts; the agent asked for approval when the rails say it should; the reply answers what was asked. Score a sample (for example 10%) to keep cost down.

## Contracts between the pieces

- **Run ids reach the browser.** Each assistant message the agent delivers carries `traceSpanId`, the root span id of the run that produced it. It is an opaque id and safe to show.
- **Feedback goes through the agent.** `POST {agent}/api/marketer/feedback` with the agent session token and `{ conversationId, traceSpanId, score: 0 | 1, comment? }` (comment at most 1,000 characters, masked). The agent checks that the span id belongs to a run in that conversation, for that tenant, then logs `user_rating`. Response `204`; `404` if the span isn't one of the conversation's runs; `403` without `agent:chat`.
- **The workspace content setting lives in the backend.** `GET /api/v1/observability/settings` returns `{ "content": "redacted" | "metadata" }` to any member and to the agent; `PUT` needs `security:manage` and a person, and is audited as `observability.settings_changed`. The agent caches it for 60 seconds and treats an unreadable setting as `metadata`.

## Environment

| Variable | Where | Notes |
|---|---|---|
| `BRAINTRUST_API_KEY` | Worker secret, backend env, CI secret | Never in the web app or the browser. Use one key per environment. |
| `BRAINTRUST_PROJECT_ID` | Worker var, backend env, CI | The Braintrust project for this environment. |
| `BRAINTRUST_API_URL` | Worker var, backend env, CI | Region or self-hosted data plane. |
| `BRAINTRUST_CONTENT` | Worker var, backend env | `redacted` (default) or `metadata`. |

Braintrust is a subprocessor: it receives masked prompt and output text unless the content mode is `metadata`. List it in `legal/subprocessors` when it is turned on in production.
