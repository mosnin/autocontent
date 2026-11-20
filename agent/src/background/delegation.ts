import type { DelegationRosterEntry } from "@agent-starter/flue";
import { departmentToolNames } from "../marketer/tools/index.ts";

/**
 * Who a background job may hand work to (the flagship chain: webhook → queue → job → cheap router →
 * analyst query or browser VM → report). Entries whose agent is not part of the project drop out at
 * render (src/lib/delegation.ts `composedRoster`), so a background-only project has no `delegate_task`
 * and the worker does everything with its own tools.
 *  - analyst (multi-agent module): Marketer's read-only analytics tools (overview, spend, metrics, performance);
 *  - operator (computer-use module): browser work in a dedicated VM; `browser_submit` stays HIGH risk and
 *    waits for a human on the operator's side. Shell and file tools are never delegated from a job.
 * The worker's grant is `requester grant ∩ these tools` (enforced on the worker at execution time).
 * Delegation needs the tenant feature flag `multiAgentGroupChat`; the operator also needs `computerUse`
 * and `autonomousBrowserUse`.
 */
/** The analyst's read-only Marketer analytics tools (src/marketer/tools/analytics.ts). */
export const ANALYST_TOOLS: readonly string[] = departmentToolNames("analyst");

export const OPERATOR_BROWSER_TOOLS = ["browser_navigate", "browser_extract", "browser_screenshot", "browser_click", "browser_type", "browser_scroll", "run_browser_automation", "browser_submit"] as const;

export const BACKGROUND_DELEGATES: readonly DelegationRosterEntry[] = [
  {
    id: "analyst",
    agent: "analyst-agent",
    description: "Marketing analyst with read-only performance and spend data across organic video, articles and paid ads; use mode consult for numbers",
    tools: [...ANALYST_TOOLS],
  },
  {
    id: "operator",
    agent: "computer-operator",
    description: "Computer operator that does browser work in a dedicated VM (open a portal, read a page, fill a form; submits wait for human approval)",
    tools: [...OPERATOR_BROWSER_TOOLS],
  },
];

/** Authority a background job hands on through delegation (on top of its own tools). */
export const DELEGABLE_TOOLS: readonly string[] = [...ANALYST_TOOLS, ...OPERATOR_BROWSER_TOOLS];

/** Job workflow tools for delegation: consult in EVALUATE, act in EXECUTE. */
export const DELEGATION_TOOLS = ["delegate_task", "check_delegation"] as const;
