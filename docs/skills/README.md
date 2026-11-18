# Marketer's in-app skills

Marketer's agents load **runtime skills**: short procedures in `agent/src/skills/<name>/SKILL.md` that an agent
activates when a request matches. This pack adds 20 marketing skills in the shape gstack uses for engineering work
(a role, trigger phrases, a hard gate, a produced artifact, memory lookups), written for Marketer's
plan → make → distribute → measure loop. The structure is borrowed; the text is our own.

A skill is **instructions, not permission**. Mounting one adds no tool and changes no risk tier, approval, cap or
rail. What an agent can do is decided by its tools and the guarded tool pipeline (`docs/rails/README.md`).

## The pack

"Owner" is the agent that runs the skill with its own tools. Marketer and the orchestrator (the leads) mount every
skill: they run their own and hand the rest to the owner with `delegate_task`.

| Command | Role | Owner | Produces | Acting tools it may call (all others are reads) |
|---|---|---|---|---|
| `/brief` | Head of marketing | Marketer | Marketing Brief | none (saves memory after the person confirms) |
| `/positioning-review` | CMO | Strategist | Positioning review with proposed brief edits | none |
| `/plan-campaign` | Strategist | Marketer | Campaign plan | none (delegates after one confirmation) |
| `/brand-voice` | Brand designer | Strategist | Brand kit proposal | `update_brand_kit` (HIGH, waits for the person) |
| `/hook-lab` | Creative director | Content producer | Ranked hook shortlist | none |
| `/content-batch` | Content producer | Content producer | Content batch report | `create_video`, `create_carousel`, `remix_template` (credits) |
| `/seo-brief` | SEO editor | SEO editor | Article brief | none |
| `/repurpose` | SEO editor | SEO editor | Verified post drafts per channel | `repurpose_article` (metered, posts nothing) |
| `/calendar-fill` | Distribution manager | Distribution manager | Calendar proposal | `approve_video`, `approve_carousel` (HIGH, wait for the person) |
| `/creative-review` | Design reviewer | Content producer | Creative review scorecard | none |
| `/ad-test-plan` | Media buyer | Media buyer | Pre-registered ad test plan | `create_ad_campaign` (drafts only) |
| `/scale-winner` | Media buyer | Media buyer | Budget change proposal | `set_ad_budget` (CRITICAL, waits for the person) |
| `/budget-guard` | Spend warden | Marketer | Spend freeze report | none itself; delegates pauses and lower caps |
| `/launch` | Launch manager | Marketer | Launch readiness checklist | none itself; delegates `start_campaign` |
| `/comment-triage` | Community manager | Analyst | Triage list with reply drafts | none |
| `/competitor-watch` | Analyst | Marketer | Competitor change log | none (public web reads, memory writes) |
| `/audit-site` | SEO auditor | Marketer | Ranked site fix list | none |
| `/retro` | Analyst | Analyst | Retro and new Learnings | none (memory writes) |
| `/learn` | Memory keeper | Marketer | Memory review | `forget_note` (permanent, confirmed first) |
| `/report` | Reporter | Analyst | Stakeholder report | none |

### Who loads what

| Agent | Skills |
|---|---|
| Marketer (`assistant`) and the orchestrator | all 20, plus one instruction line that maps slash commands to owners |
| Strategist | `/positioning-review`, `/brand-voice` |
| Content producer | `/hook-lab`, `/content-batch`, `/creative-review` |
| SEO editor | `/seo-brief`, `/repurpose` |
| Media buyer | `/ad-test-plan`, `/scale-winner` (with `paid-media-safety`) |
| Distribution manager | `/calendar-fill` |
| Analyst | `/comment-triage`, `/retro`, `/report` |
| Copilot, background worker, persistent agent | none |

The mapping lives in one place, `agent/src/skills/marketing.ts` (`MARKETING_SKILLS`, `marketingSkillsFor`,
`useMarketingSkills`). Agents call `useMarketingSkills(...)` next to `useCustomSkills()`.

### How the skills pass work to each other

- `/brief` writes the **Marketing Brief**. Every other skill reads it with `recall_entity` ("marketing-brief").
- `/retro`, `/hook-lab` and `/ad-test-plan` write **Learnings** (entity "marketing-learnings"). `/plan-campaign`,
  `/content-batch`, `/creative-review` and `/scale-winner` read them. `/learn` reviews, corrects and retires them.
- `/competitor-watch` writes competitor facts that `/positioning-review` is handed.
- `/plan-campaign` → `/hook-lab` → `/content-batch` → `/creative-review` → `/calendar-fill` → `/launch` → `/retro` is
  the usual order. Paid: `/ad-test-plan` → `/scale-winner`, with `/budget-guard` at any time.

### What the skills cannot do today

The skills only name tools that exist, so some describe a limit instead of a step:

- **No web tools in departments.** Only Marketer holds `web_search`, `fetch_url_markdown` and `browse_page` (and only
  when their keys are set). That is why `/competitor-watch` and `/audit-site` are owned by Marketer, and why
  `/seo-brief` and `/positioning-review` take search and competitor findings from the task brief or mark them
  "not researched".
- **No comment or DM text.** Tools return engagement counts. `/comment-triage` sorts text it is handed and otherwise
  only ranks which posts to look at. No tool sends replies.
- **No kill-switch or account-cap tool.** `/budget-guard` pauses and lowers through the departments and tells the
  person what only they can set in the app.
- **No Core Web Vitals measurement, no PDF export, no decision-model score tool.** `/audit-site` lists speed as "not
  measured", `/report` returns the report for the lead to render, and `/hook-lab` shows a platform score only when one
  is attached.

## Shape of a skill

```markdown
---
name: scale-winner                       # = directory name = slash command
description: "What it does. Use for /scale-winner, 'trigger phrase', ..."   # ≤ 400 chars, says when to use it
allowed-tools: list_ad_accounts get_ad_campaign set_ad_budget              # tools the OWNER runs itself
metadata:
  command: /scale-winner
  role: Media buyer
  owner: media-buyer                     # a department id, or "marketer"
  artifact: Budget change proposal
---
# /scale-winner: title
**Role:** … **Runs in:** … **Produces:** … **Hard gate:** …
## When to use
## When not to use
## Inputs            (table: input → the tool that fetches it)
## Steps
## Output
## Guardrails        (ends with the three shared lines)
## Done when
```

`allowed-tools` is documentation the tests check; the harness does not enforce it. Enforcement is the agent's own
tool list, the delegation grant and the rails.

## Safety rules for skill text

1. No skill tells an agent to get past an approval, a cap, the firewall or a rail, to treat anything but the person's
   decision as approval, to retry or split a change to get under a threshold, or where the tenant comes from.
2. Every skill carries the shared guardrails, including "Never invent metrics; read them with tools."
3. Every snake_case word in a skill is a real tool name (statuses go in quotes, e.g. "needs_input").
4. Every tool in `allowed-tools` is one the owner holds. Money tools appear only in the media buyer's skills, and a
   skill that lists an approval-gated tool says that the call waits for the person.
5. No secrets, no customer data, no model names.

`agent/test/skills.test.ts` enforces all of this for every runtime skill directory, plus valid frontmatter (the
harness's own parser), unique names and a size cap (6 KB for the pack, 8 KB for any skill). The scanner flags the
forbidden phrases unless the same sentence negates them first ("never …", "do not …"); a few phrases are flagged
even when negated.

## Add a skill

1. Create `agent/src/skills/<name>/SKILL.md` from the shape above. Keep it under 6 KB. Name tools exactly; check them
   in `agent/src/marketer/tools/*`.
2. Pick the owner: the department whose tools the steps use. If the steps need tools from several departments, the
   owner is "marketer" and the skill delegates.
3. Register it in `agent/src/skills/marketing.ts`: import the `SKILL.md` and add a `MARKETING_SKILLS` entry whose
   `owner`, `role` and `produces` match the frontmatter `metadata`.
4. Add the name to `PLAN` in `agent/test/skills.test.ts`, its expected acting tools in the "read-only and plan-only"
   test, and its row to the tables above.
5. Run `cd agent && pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

A skill that every agent should load (a house rule, not a department procedure) goes through `customSkills` in
`agent/agent-starter.config.ts` and `agent/src/skills/custom.generated.ts` instead, as `marketing-operating-procedure`
and `paid-media-safety` do. A skill that needs a new capability needs the tool first: add it with the
`agent-starter-tools-and-firewall` skill, with a risk tier and tests, then reference it.
