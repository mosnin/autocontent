# Recipes (design only)

**Nothing on this page is built.** It is the design that ADR 0007 accepts as a direction, written down so that when it
is built it fits the rails instead of going around them.

## The idea

When a multi-step task works, the agent proposes saving it as a recipe: a named, declarative list of existing guarded
tool calls with fixed parameters and a narrower rule. Example: `boost_winner` raises a campaign's daily budget by at most
10%, only for campaigns at or above target ROAS for the last 7 days.

Why: people repeat the same moves. Re-planning each time costs tokens and drifts. A saved, narrower rule is easier for
a person to trust once than to approve from scratch every time.

## Shape

```json
{
  "name": "boost_winner",
  "version": 1,
  "owner": "user_…",
  "access_state": "approval_required",
  "inputs": { "campaignId": { "type": "uuid" } },
  "preconditions": [
    { "fact": "campaign.roas_7d", "op": ">=", "value": { "ref": "playbook.target_roas" } }
  ],
  "steps": [
    { "tool": "get_ad_campaign", "args": { "campaignId": { "ref": "inputs.campaignId" } } },
    {
      "tool": "set_ad_budget",
      "args": {
        "campaignId": { "ref": "inputs.campaignId" },
        "dailyBudgetUsd": { "compute": "min(current * 1.10, account.daily_cap_usd)" },
        "reason": "boost_winner: ROAS at or above target for 7 days"
      }
    }
  ]
}
```

`compute` is a small arithmetic expression evaluated in code, never by a model.

## Rules (how recipes stay on the rails)

1. **Only existing tools.** A step names a tool in `DEPARTMENT_TOOLS`; recipes add no new side-effect path.
2. **Every inner call passes the enforcement point** (`enforceAgentDispatch`, then `enforce_dispatch`) with its own
   tier, kill switch, caps, unknown-outcome check and idempotency key.
3. **No new authority.** A recipe's access state is at most as loose as its tightest inner tool. A CRITICAL step
   keeps a per-execution approval bound to that step's computed arguments; approving the recipe is not approving the
   spend.
4. **Preconditions are facts computed in code** (ROAS over a window, current budget), read at execution, never cached
   from when the recipe was saved.
5. **Indeterminate stops the recipe.** No later step runs after an unknown outcome; a Required Action is raised.
6. **Versioned and owned.** Editing a recipe creates a new version; executions record which version ran.
7. **Proposed by the agent, saved by a person.** Saving is HIGH.

## What to build first, when it is time

Store and validator for the JSON above; a runner that executes steps through the existing `ToolExecutor`; a recipe
access state per tenant; context-impact reporting (tokens saved versus re-planning). Code-mode programs in an isolate
only if declarative recipes prove too rigid.
