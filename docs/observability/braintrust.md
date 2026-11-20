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

## As built (agent)

Everything lives in `agent/src/lib/braintrust/`; `agent/src/lib/platform.ts` wires it in. Tests: `agent/test/braintrust.test.ts` (fetch stubs, no network).

| Piece | Where | What it does |
|---|---|---|
| Config | `config.ts` | Off unless `BRAINTRUST_API_KEY` (Worker secret) and `BRAINTRUST_PROJECT_ID` (var) are set. `BRAINTRUST_API_URL` defaults to `https://api.braintrust.dev`. `BRAINTRUST_CONTENT`: empty or `redacted` means `redacted`; any other value means `metadata`, so a typo never sends more. |
| Exporter | `exporter.ts`, `traceExporters()` | `BraintrustSpanExporter` sits beside Langfuse and the generic OTLP exporter. It receives each finished run trace from the Flue trace recorder, masks it, shapes it and posts OTLP/JSON (through core's `OtlpHttpSpanExporter`) to `{BRAINTRUST_API_URL}/otel/v1/traces` with `Authorization: Bearer …` and `x-bt-parent: project_id:…`. Timeout 5 s. It never throws. The first failure per isolate is logged and later ones are dropped silently. `partialSuccess.rejectedSpans` is counted in `braintrustExportStats` and logged once. The recorder's flush now runs under `waitUntil` (`observerOptions().tracing.waitUntil`), so no export (Langfuse and OTLP included) sits on a reply's path. |
| Masking | `mask.ts` (`maskSpan`) | One function covers every attribute, event attribute and status message. It runs `redactSecrets` (`marketer/memory/redact.ts`), then the shared PII redactor for emails, phone numbers, Luhn-valid card numbers, SSNs, IBANs and IP addresses. Attributes and JSON keys whose name contains a segment like `authorization`, `cookie`, `token`, `secret`, `password`, `api_key` or `credential` are dropped (`input_tokens` is kept). JSON values are parsed and masked field by field. JSON cut short by truncation is masked as text, and secret-looking `"key": "value"` pairs are blanked. Identity attributes (tenant, actor, conversation and run ids) skip the number-shaped rules so a UUID is not taken for a phone number, but an email-shaped id is still replaced. |
| Personal memory | `mask.ts` | Every `<untrusted_content>` block from `memory`, `memory:*`, `retrieval` or `relational-memory` is cut out wherever it appears, including the recall signal, retrieved notes and the private entity graph, and in later turns' prompts. A block cut off by truncation is dropped to the end of the string. For the memory tools (`recall_memory`, `fact_history`, `remember_note`, `search_notes`, `forget_note`, `remember_fact`, `recall_entity`, `remember`), arguments and results are replaced on their own spans and inside every prompt that replays them. `recall_memory` keeps counts and scope kinds only (`{ facts, recalled: { personal, team } }`). Truncated text that still references a memory tool call is dropped whole. There are no separate recall spans: recall runs in `useAgentStart` and is not traced. |
| Content mode | `settings.ts` | `metadata` keeps an allowlist only: ids, model, tokens, cost, timing, tool names, finish reasons, outcomes, error codes and scores. Status messages and event attributes are dropped too. The workspace setting comes from `GET {PRIMARY_SAAS_API_URL}/api/v1/observability/settings`, read with the service token and `x-tenant-id` and cached for 60 s per workspace. A missing backend, a non-2xx response, a timeout (2 s) or an unexpected body all mean `metadata`. The global `metadata` setting skips the lookup. The mode used is recorded on the root as `marketer.content_mode`. |
| Root span | `exporter.ts` | Attributes: `agent`, `tenant_id`, `actor_id`, `conversation_id` (person conversations only), `role`, `env` (`SERVICE_NAME`) and `release` (`CODE_VERSION`), plus `braintrust.scores`. Agent spans are Braintrust `task` spans with `braintrust.input` (the waking message) and `braintrust.output`. |
| Model turns | `exporter.ts` | `gen_ai.operation.name=chat`, `gen_ai.request.model`, `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens`, `agent.cost_usd`. The recorder's prompt view becomes OpenAI-style `gen_ai.prompt_json` (system, user, assistant with `tool_calls`, tool). Tool-call completions become `gen_ai.completion_json`. Tool spans are `execute_tool` spans with `braintrust.input_json` and `braintrust.output_json`. |
| Decision models | `marketer/decisions/run.ts` (`onCall`), `annotations.ts` | Each decision-model call becomes a GenAI child span of the run: `decision <point>`, model, total tokens, cost, latency, `decision.mode`, `decision.fallback_used` and `decision.failure`. It never carries the state or the answers. |
| Scores | `exporter.ts`, `annotations.ts`, `hooks.ts` | `rails_blocked` is set on every root: 1 when a tool result in the run shows `PENDING_APPROVAL`, `TOOL_NOT_ALLOWED`, `RAILS_*`, `AUTO_REVIEW_BLOCKED` or a security halt. `decision_fallback` is set when the run made decision calls: 1 if any failed and the rule answered. `approval` is set on the run woken by a person's `tool-approval` decision: 1 for approve, 0 for reject. |
| `traceSpanId` | `annotations.ts`, `hooks.ts` | The root span id is deterministic: `traceSpanIdFor(instanceId, submissionId)`, 16 hex characters. The platform observer tracks the submission in flight. `useTraceRun({ id, actor })` (in assistant, copilot, orchestrator and background-worker) adds `traceSpanId` to the delivered assistant message's metadata (Flue `useResponseStart` and `useResponseFinish`) only while Braintrust is configured, and the exporter gives the root that id. This is additive metadata, so existing clients are unaffected. A client shows thumbs only when the field is present. |
| Run ↔ conversation | `feedback.ts` (`rememberRunSpan`) | When a run of a person's conversation starts, `bt:run:<conversationId>:<traceSpanId>` is written to `AGENT_CACHE` with a 90-day TTL. The conversation id already names the tenant and the owner. |
| Feedback | `feedback.ts`, `POST /api/marketer/feedback` | Bearer session token only; visitor and voice tokens are refused. Responses: `401` without a valid token. `403` without `agent:chat`, or with a conversation-bound token for another conversation. `400` for a malformed body. `429` from a per-person token bucket (`rl:feedback:`, 30 a minute, burst 10). `404` while Braintrust is off, when the conversation is not the caller's own in their own workspace, or when the span is not one of its runs. Otherwise `204`. It then sends `POST {BRAINTRUST_API_URL}/v1/project_logs/{project}/feedback` with `{ id: traceSpanId, scores: { user_rating }, comment (masked), metadata: { user_id, tenant_id, conversation_id }, source: "external" }` under `waitUntil` with a 5 s timeout. A failure is logged once and never reaches the person. |
| Evals | `agent/scripts/braintrust-evals.ts` (`pnpm evals:braintrust`), CI job `agent-evals-braintrust` | The offline suite replays the decision conformance cases (`docs/decisions/conformance`) through the production client with a stubbed fetch: no model key, no network. `--promptfoo <results.json>` adds the harness suites (`pnpm evals -o …`) or the live decision suites (`pnpm evals:decisions -o …`), which need a running agent or a model key. Results are uploaded with plain fetch, not the SDK: `POST /v1/experiment` with `base_exp_id` set to the newest experiment of the suite on `main`, then `/insert` and `/summarize` against that baseline. The CI job runs after `agent` and only when the `BRAINTRUST_API_KEY` secret and the `BRAINTRUST_PROJECT_ID` variable or secret exist; otherwise it passes with a notice. Fork PRs skip it. It uses `persist-credentials: false`. |

Deviations and open points:

- **Feedback id.** The project-logs feedback API takes the row `id`. For spans ingested over OTLP, Braintrust's docs do not say whether the row `id` equals the OTel span id. We send the root span id (`traceSpanId`). Check this once against a real project: a thumbs up should attach to the run's root row and not create a new row. If it creates a row, switch `sendFeedback` to log a child `score` span over OTLP (trace id plus root span id as parent), which needs the trace id stored next to the span id.
- **Approval score placement.** `approval` lands on the run that the decision wakes, not on the run that parked the call. The two are consecutive runs of the same conversation.
- **Unreadable setting means `metadata`, including local development** without a backend. Point `PRIMARY_SAAS_API_URL` at a backend that serves the settings route to see prompt text.
- **Eval uploads mask emails only.** The rows come from eval tenants and conformance fixtures, not production data.
