# Prompt-injection defense and untrusted content

## Heuristics (`packages/core/src/guardrails/injection.ts`)
`assessInjection(text)` combines weighted regex signals as independent probabilities, `score = 1 − Π(1 − w)`:

| Signal | Weight |
|---|---|
| ignore-instructions | 0.6 |
| system-override | 0.6 |
| destructive-sql | 0.55 |
| prompt-exfiltration | 0.5 |
| cross-tenant | 0.5 |
| role-hijack | 0.45 |
| data-exfiltration | 0.45 |
| tool-coercion | 0.35 |
| delimiter-spoof (`<system>`, `[INST]`, `<\|im_start\|>`, `</untrusted_content>`) | 0.35 |
| encoded-payload | 0.2 |

Verdicts: `injection` ≥ 0.6, `suspicious` ≥ 0.3, otherwise `safe`. A single "ignore previous instructions"
reaches 0.6 and locks on its own.

Related helpers:
- `cleanseUntrustedText(text, maxLength = 8000)`: strips control and bidi-override characters, replaces every pattern except encoded-payload with `CLEANSED_MARKER` (`[CLEANSED_INJECTION_ATTEMPT]`), then the spec's Manychat keywords anywhere in the text (`CLEANSE_KEYWORDS` = `/(system override|ignore previous instructions|delete table|drop database)/gi`, whitespace-tolerant), and truncates. The keywords only cleanse; they add nothing to `assessInjection`.
- `wrapUntrusted(text, source)`: `<untrusted_content source="…">…</untrusted_content>`. Nested or spoofed tags are removed from the inner text first.
- `UNTRUSTED_CONTENT_POLICY`: the system instruction that content inside those tags is data.
- `classifyInjectionWithModel(provider, text)`: a JSON classifier `{ label: SAFE | INJECTION, confidence, reason }` running on a cheap model.

## Pipeline (`GuardrailPipeline`, `packages/core/src/guardrails/pipeline.ts`)
`DEFAULT_GUARDRAIL_POLICY`:
- `maxInputChars` 32 000;
- `sanitizeThreshold` 0.3;
- `haltThreshold` 0.6;
- `redactOutputKinds`: `api_key`, `jwt`, `private_key`, `credit_card`, `ssn`;
- `blockedOutputPatterns`, `blockedTopics`, `customGuards`: empty.

`checkInput`:
1. Truncate to `maxInputChars`.
2. Blocked topics → `block`.
3. Heuristic score. For scores in [0.3, 0.6) it asks the classifier, if one is configured: `INJECTION` with confidence ≥ 0.8 raises the score to the halt threshold.
4. Score ≥ halt → `halt` (cleansed text).
5. Score ≥ sanitize → `sanitize`.
6. Custom guards run last.

`checkOutput` redacts, applies blocked output patterns, then runs custom guards. `enforceInput` and
`enforceOutput` throw `SecurityHaltError` or `GuardrailBlockedError`.

Tune it per agent with `useAgentStarter({ guardrails: { haltThreshold, blockedTopics, customGuards, maxInputChars } })`.
`classifier` is filled in from `utilityModel` automatically.

## How `useAgentStarter` applies it (`packages/flue/src/use-agent-starter.ts`)
| Phase | What happens | Why |
|---|---|---|
| Render (sync) | `securityLocked = delivery.kind === "user" && (assessInjection(body).score >= haltThreshold \|\| fnv1a(body) === as:flaggedMessage)`. When locked: no tools are mounted, and the SECURITY LOCK instruction is added | Flue fixes the tool set at render, **before** `useAgentStart`. An async verdict would come too late for this submission |
| `useAgentStart` (async) | `GuardrailPipeline.checkInput(body)` runs, with the classifier. On halt or block: `setFlaggedMessage(hash)`, append a `security-notice` signal, emit an error telemetry event | It catches borderline inputs, and any re-render of that message locks |
| Always | `useInstruction(UNTRUSTED_CONTENT_POLICY)`. Retrieval is injected as a `retrieved-context` signal wrapped as untrusted. Tool output is wrapped per `outputTrust` | Spotlighting |
| Response metadata | `securityLocked: true` | UIs, evals (`SECURITY_EXCEPTION_HALT` in the eval harness) |

Edge side of signals:
- `agentAuth` drops client-supplied signal `attributes` and `tagName` (a browser cannot render `<system …>`)
  and stamps `channel`/`route` itself; voice turns arrive as `voice-utterance` signals (`isUserTurn()` treats
  them as the person's own turn).
- `renderTurn()` wraps queue event payloads, session keys and ids in `<untrusted_content>`; cleanse free-text
  provider fields at ingestion too (`untrustedString`).
- Free-text `ask_person` answers and approval notes appear only inside wrapped signal bodies, never in
  attributes (Flue renders attributes verbatim).

## Writing injection-resistant agents
- Instructions should say that content in signals, tool output and retrieved docs is data. Load the `untrusted-content` runtime skill with `useSkill(untrustedContent)`.
- Never build instructions from untrusted strings: `useInstruction(\`...${payload}\`)` is an injection.
- Mark third-party tool output `outputTrust: "untrusted"`. That is the default for `read`/`external` tools. Mark `trusted` only for content you generate yourself.
- Keep high-impact tools `HIGH`/`CRITICAL`. Approvals contain the damage when an injection does get through.
- Add each new attack you see to the adversarial eval set (`agent-starter-evals-and-ops`). Run `pnpm evals`.

## Verifying
- `packages/core/test/security.test.ts`: "scores classic injection as injection and benign text as safe", "cleanses imperative payloads in untrusted fields", "halts the run on high-confidence injection via the pipeline".
- `packages/flue/test/flue-e2e.test.ts`: "locks tools and refuses when a message is a prompt injection". It asserts that the model was offered zero tools.
- `packages/core/test/runtime.test.ts`: "terminates with SECURITY_EXCEPTION_HALT on prompt injection", for the `AgentRuntime` path.
