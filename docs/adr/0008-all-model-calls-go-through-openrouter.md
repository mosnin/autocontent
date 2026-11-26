---
status: accepted
---

# All model calls go through OpenRouter

Every model call Marketer makes goes through OpenRouter with a server-side `OPENROUTER_API_KEY`. Model slugs are
pinned in config (dated slugs, never `-latest`). Decision models use OpenRouter's decisions endpoint, configurable as
`OPENROUTER_DECISIONS_URL` (default `https://openrouter.ai/api/alpha/decisions`) because the `/alpha/` path may move.

## Why

- **One key, one bill, one place to meter.** Per-call cost comes back in the response and is recorded with the
  decision or the spend entry.
- **Provider choice without code changes.** A slug change in config, not a new SDK.
- **Keys stay server-side.** The browser and the agent's model context never see a key.

## Exceptions (not LLM text calls)

| Exception | Why |
|---|---|
| Workers AI embeddings and reranker (`@cf/baai/bge-*`) | Local and free; the Vectorize index is 768-dimensional, so moving means re-indexing |
| Workers AI first-line and compaction models in the agent harness | Latency and cost on trivial turns; governed by the harness's model router |
| Speech (OpenAI TTS and Whisper, ElevenLabs), images (gpt-image), video (Grok Imagine, fal) | Not text calls; own clients, price tables and spend caps in `src/marketer/services/*`. Re-check OpenRouter's coverage before moving any |

Any new exception needs an ADR that supersedes this table.

## Status of the move

Decision models call OpenRouter from the start (decisions modules). Pointing agent chat and backend text calls
(ideation, scripts, QA, articles) at OpenRouter, and metering on its returned `usage.cost` instead of the curated
price table, is step 3 of the plan in `docs/research/EVALUATION.md` and is not done by the rails work.

## Consequences

- A decision model is an optimization, never a dependency: every call has a timeout and a rule-based fallback; with no
  key configured everything behaves exactly as before (decisions modules, owned separately from the rails).
- The rails make no model calls at all (ADR 0002).
