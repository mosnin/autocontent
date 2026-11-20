/** Execution rails, agent side. Read docs/rails/README.md first. */
export { canonicalHash, canonicalJson, railsArgsHash } from "./canonical.ts";
export { enforceAgentDispatch, evaluateAgentDispatch, IndeterminateOutcomeError, isDefiniteRejection, KILL_SWITCH_ENV, parseKillSwitch } from "./enforce.ts";
export type { AgentDispatch, RailsCallContext, RailsVerdict } from "./enforce.ts";
export { RAILS_MAX_DAILY_BUDGET_USD, RAILS_TOOLS, railsEntry } from "./registry.ts";
export type { KillScope, RailsTier, RailsToolEntry } from "./registry.ts";
