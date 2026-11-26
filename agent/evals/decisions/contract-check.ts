/**
 * Live contract check for the Decisions API: one tiny request per model through the production client, with one
 * question of each type. It answers "does the wire contract in docs/decisions/openrouter-contract.md still hold for
 * the model we pin?", which matters because the endpoint is alpha and its shape may change.
 *
 *   OPENROUTER_API_KEY=... node --experimental-strip-types evals/decisions/contract-check.ts [model ...]
 *
 * Run it before promoting a point and after changing DECISION_MODEL. It costs a small fraction of a cent, prints the
 * failure kind and never the key, and exits non-zero when any model fails. Without a key it fails: a check that did
 * not run is not a pass.
 */
import { decisionModel, requestDecision } from "../../src/marketer/decisions/client.ts";
import type { DecisionQuestion } from "../../src/marketer/decisions/questions.ts";

const QUESTIONS = {
  refund: { type: "yesno", instructions: "Is the customer in `ticket` asking for money back?" },
  team: { type: "choice", instructions: "Which team should handle `ticket`?", options: { billing: "Charges and refunds", technical: "Bugs and outages" } },
  urgency: { type: "score", instructions: "How urgent is `ticket`?", levels: ["can wait", "this week", "right now"] },
} as const satisfies Record<string, DecisionQuestion>;

const env = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_DECISIONS_URL: process.env.OPENROUTER_DECISIONS_URL,
  DECISION_MODEL: process.env.DECISION_MODEL,
};

const named = process.argv.slice(2);
const models = named.length ? named : [decisionModel(env)];
let failed = false;
for (const model of models) {
  const r = await requestDecision({ env }, { ticket: "I was charged twice this month." }, QUESTIONS, { timeoutMs: 8000, model });
  if (r.ok) {
    const types = `refund=${r.answers.refund.type} team=${r.answers.team.type} urgency=${r.answers.urgency.type}`;
    console.log(["ok  ", model, "->", r.model, `${r.ms} ms`, `${r.cost} USD`, `${r.tokens} tokens`, types].join(" "));
  } else {
    failed = true;
    const status = r.status ? ` (HTTP ${r.status})` : "";
    console.log(["FAIL", model, `${r.kind}${status}:`, r.message].join(" "));
  }
}
process.exit(failed ? 1 : 0);
