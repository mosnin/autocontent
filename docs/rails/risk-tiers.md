# Risk tiers

A risk tier says how bad it is if an action happens when it should not have. It decides who may do it and how.

| Tier | Meaning | Who may do it | Examples |
|---|---|---|---|
| LOW | Reads | Any agent, freely | `get_workspace_inbox`, `list_ad_campaigns` |
| MEDIUM | Spends content credits or creates drafts; nothing goes public, no ad money moves | Departments on their own (the media buyer still waits: `maxAutonomousTier: "LOW"`) | `create_video`, `create_ad_campaign`, `pause_campaign` |
| HIGH | Publishes, approves, rejects, starts spend on a budget the person set, edits brand identity or caps | Only with a person's approval of that exact call | `approve_video`, `start_campaign`, `update_brand_kit`, `pause_ad_campaign` |
| CRITICAL | Moves real ad money | Only with a person's approval, every time (`requiresApproval`), plus the backend guard | `set_ad_budget`, `activate_ad_campaign`, `decide_ad_approval` |

Why tiers are fixed in code: a tier is a risk decision a person makes in review, with a test that changes with it.
Nothing at runtime lowers one: not tenant config (the harness takes the stricter of agent and tenant autonomy), not a
model (ADR 0002), not a recipe (ADR 0007).

## The three tables

1. **`EXPECTED_RISK`** in `agent/test/marketer-tools.test.ts`: the tier of every Marketer tool. The test fails if a
   tool's declared tier differs.
2. **`RAILS_TOOLS`** in `agent/src/marketer/rails/registry.ts`: every HIGH and CRITICAL tool, with the backend action it
   reaches, its kill-switch scopes, whether it only reduces exposure, and its argument caps. `writeTool` refuses to
   define a HIGH/CRITICAL tool missing from it, one whose tier differs, or a CRITICAL one without `requiresApproval`.
   `agent/test/marketer-rails.test.ts` checks it covers exactly the HIGH/CRITICAL tools.
3. **`ACTIONS`** in `src/marketer/rails/actions.py`: every HIGH and CRITICAL backend action, with tier, kill-switch
   scopes and `reduces_exposure`. `enforce_dispatch` refuses an unregistered action. `tests/test_rails_core.py` checks
   that every `backendAction` in `RAILS_TOOLS` exists here and that CRITICAL tools reach only CRITICAL actions.

## Scopes and "reduces exposure"

- `publish`: posting to a social channel (approving content, the post step, starting a campaign).
- `spend`: starting or raising spend (budget changes, activation, executing an approved ad change, starting a campaign,
  raising a playbook spend cap).
- `reduces_exposure` / `reducesExposure`: pausing, ending, rejecting. Never blocked by a kill switch or by an unknown
  outcome on the target, because being able to wind down is the point.

## Changing a tier on purpose

1. Write down why (an ADR if it lowers a tier or changes what a person must approve).
2. Change the tool's `risk` in `agent/src/marketer/tools/<department>.ts`.
3. Change `EXPECTED_RISK`, `RAILS_TOOLS` and, if the backend action changes, `ACTIONS`.
4. Run `cd agent && pnpm typecheck && pnpm lint && pnpm test` and `pytest tests/test_rails_core.py`.

Raising a tier needs only steps 2 to 4. Lowering one needs all four and a second reviewer.

## Adding a HIGH or CRITICAL action

See [runbooks.md](runbooks.md#add-a-high-or-critical-action).
