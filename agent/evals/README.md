# Eval datasets

`promptfoo.config.yaml` loads every `*.yaml` file in this folder (`tests: file://evals/*.yaml`):

| File | What it asserts |
| --- | --- |
| `security.yaml` | Prompt-injection halt (`TERMINATED` + `SECURITY_EXCEPTION_HALT`), secret exfiltration refusal |
| `module-<name>.yaml` | Per-module cases for the agents of that module (only the selected modules' suites are generated): first tool chosen (tool selection), structured outputs (JSON contract, OpenUI program), idempotency on reconnect (`replay: 2`), sandbox escape probes for `run_code`, delegation/room selection (`multi-agent`), read-first browsing and approval-gated submits (`computer-use`), spoken style and `end_call` (`voice`) |
| `r2.tests.yaml` | Gold dataset CI pulls from R2 (`evals/promptfoo.tests.yaml` in the workspace bucket); not committed |

Every case targets one agent with `vars.agent` (default: the project's first HTTP agent) and gets the
harness output as `output`: `executionStatus`, `finalState` (the workflow FSM state the run ended in, when the
agent has a workflow), `finalText`, `summary` (starts with `ExecutedState: <finalState or status>`), `turnCount`,
`accumulatedCost`, `toolCalls[] {tool, status}`, `deliveries`, `deduplicatedDeliveries`, `errorCode`.

Generate more cases from the built-in datasets of `@agent-starter/evals`:

```ts
import {
  BUDGET_CASES, IDEMPOTENCY_CASES, PROMPT_INJECTION_CASES, SANDBOX_ESCAPE_CASES,
  STRUCTURED_OUTPUT_CASES, TENANT_ISOLATION_CASES, TOOL_SELECTION_CASES, toPromptfooTests,
} from "@agent-starter/evals";
console.log(JSON.stringify(toPromptfooTests([...TOOL_SELECTION_CASES, ...STRUCTURED_OUTPUT_CASES, ...PROMPT_INJECTION_CASES]), null, 2));
```

Assertion types (`EvalCase.expect`): `status`, `finalState`, `maxTurns`, `maxCost`, `toolCalled`, `toolNotCalled`,
`firstTool`, `maxToolExecutions`, `jsonOutput` (zod schema → Promptfoo `is-json` with a JSON Schema),
`openuiProgram`, `textIncludes`, `textExcludes`, `errorCode`.

Shadow deploys: `runShadowComparison()` forks a production event into a live run and a shadow run
(mutating tools simulated) and `diffTrajectories()` flags regressions before you promote a prompt/model change.
