---
name: intent-onboarding
description: Entry point for building, replacing, or optimizing a product's onboarding with the intent-driven framework. Use whenever a task touches signup, onboarding, first-run, activation, setup wizards, "aha moment", time-to-value, or the first dashboard experience. Explains the goal, picks the mode (build / replace / optimize), and sequences the other onboarding-* skills.
---

# Intent-driven onboarding: start here

## The goal (memorize this)

Onboarding exists to **set the product up around what this user is trying to do, and prove it works on their real data, before they first see the dashboard.** The target is top-1% time-to-value, but speed alone isn't the goal. The user must arrive at a product that is:

1. **Configured for their actual workflow**: only the channels and tools they use
2. **Already working**: something started running the moment they connected an account
3. **Proving it**: a concrete result from their own data ("I found 14 leads who went quiet", "6 competitor ads have run 60+ days")
4. **Understood**: they made the 1–3 core decisions on a real example, so the dashboard looks familiar
5. **Fast**: ≤ 6 screens, ≤ 120s to the dashboard, ≤ 90s to first proof

## What you must NOT build

Your default instinct will be a step-by-step form: name → company → role → bio → "how did you hear about us" → connect every integration → empty dashboard. **That is the exact failure this framework exists to prevent.** If removing the AI from your design would leave a normal wizard, start over.

Concretely, never:
- ask for anything the product can infer (name from OAuth, company from the email domain, ad platforms from site pixels)
- ask marketing questions (attribution, company size) before the dashboard
- show a connector or integration the user's answers didn't imply
- let "connected" be the end of a step; connecting **starts work**
- end on an empty dashboard, a tour, or a checklist
- ship a screen that looks like a default component-library template (see DESIGN.md)

## Required reading (in this order)

1. `RULES.md`: the doctrine (MUST/MUST NOT, with rule ids like R2.3). Enforced by the linter.
2. `DESIGN.md` and `design/references/`: the visual bar. Enforced by review.
3. `packages/spec/src/types.ts`: the spec format you will write.
4. One template as a worked example: `templates/followup-agent/spec.ts` or `templates/agentic-ads/spec.ts`.

## Pick the mode

Decide from the task and the codebase, and state your choice before you start:

| Mode | When | Skill sequence |
|---|---|---|
| **Build**: new product or no onboarding yet | Greenfield app, or an app with no first-run flow | discover → spec → ui → implement → instrument |
| **Replace**: swap an existing onboarding for this style | An onboarding exists but is form-style, generic, or slow | discover (with existing-flow inventory) → review (baseline) → spec → ui → implement **behind a feature flag** → instrument both → A/B → remove old |
| **Optimize**: improve an existing onboarding in place | The team wants gains without a rewrite, or one already built with this framework | review → instrument (if missing) → optimize → apply changes one experiment at a time |

Not sure? Run `onboarding-review` first. Its scorecard tells you which mode fits: below 50% means Replace, 50–85% means Optimize, above 85% means tune with Optimize.

## Skills

| Skill | Purpose | Output |
|---|---|---|
| `onboarding-discover` | Understand the host product, its integrations, existing onboarding and **available customer/ICP data** | `onboarding/DISCOVERY.md` |
| `onboarding-spec` | Turn discovery into a spec: aha → proof → capabilities → intent questions → fields | `onboarding/spec.ts`, lint-clean |
| `onboarding-ui` | Build or adapt screens to DESIGN.md | Screens that pass the UI checklist |
| `onboarding-implement` | Wire spec + UI + activation into the host's auth, DB, jobs and connectors | A working flow; persona paths verified |
| `onboarding-instrument` | Emit the standard events to PostHog, with funnels and dashboards | Events flowing; metrics visible |
| `onboarding-optimize` | Turn real data into ranked, specific changes and experiments | `onboarding/INSIGHTS.md` |
| `onboarding-review` | Score any onboarding against RULES + DESIGN | `onboarding/REVIEW.md` scorecard |

## Tools

```bash
# Lint a spec against RULES.md and print every derived path (screens, time, time-to-proof)
npx tsx <framework>/packages/spec/src/cli.ts onboarding/spec.ts --paths
```

A spec that doesn't lint clean is not done. Warnings need either a fix or a one-line justification in the spec's comments.

## Working agreement

- Write the **aha and proof first**, before any screen. If you can't name what the user will see from their own data, stop and ask the human.
- When a product decision is genuinely ambiguous (which capability is primary, what "working" means), ask the human. Don't guess.
- Keep host conventions (framework, styling system, file layout). The framework adapts to the host, not the other way around.
- Optimization is human-approved: recommend, put changes behind a flag, run an experiment. Never let the flow rewrite itself.
