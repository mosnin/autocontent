---
name: onboarding-spec
description: Design an intent-driven onboarding spec (onboarding/spec.ts) from discovery. Works backwards from the aha and proof to capabilities, multiple-choice intent questions with pre-selection, field tiers with inference, activation and rehearsal, then lints it against RULES.md. Use after onboarding-discover, or when changing an existing spec.
---

# Spec

You are writing `onboarding/spec.ts`, which defines **what** happens. Screens are derived from it automatically (`derivePath`), so you never write a list of steps. Start from a template if one fits and tailor it. Each one ships `spec.ts` plus `personas.ts`: `agentic-ads`, `followup-agent`, `support-inbox-agent`, `analytics-copilot`, `devtool-agent`.

## Order of work (do not reorder)

### 1. Aha and proof first
Write `aha.statement` and, for each capability, a `proof.statement` about **their data** with a `{placeholder}`:
- ✅ "I found {count} leads in your inbox who went quiet, and drafted a follow-up for each."
- ✅ "{count} competitor ads have run 60+ days. Build 3 variations?"
- ❌ "Your account is connected." ❌ "Welcome to your dashboard!" ❌ "Setup complete."

The proof CTA's `event` is the aha. `aha.event` must equal one of them.

### 2. Capabilities
One per distinct value path, usually one per connector type. For each:
- `connectors` (usually one) and the `fields` it needs to run correctly
- `activation`: what starts **within 2s of verify**, read-only, with an honest `estSecondsToFirstResult`
- `rehearsal`: the real `example` from activation output, the `artifact` the user reacts to, and **≤ 3 decisions**. Any outbound or write behavior needs a decision with `gatesOutbound: true`.
- `priority` (1 = primary when several are selected)
- Mark one capability `zeroSetup` (or give it a `proof.fallback`) for users who "don't do this yet"

### 3. Intent questions
- Usually **one** question, about the user's **workflow** ("How do you follow up with leads today?", "Where do you run ads?"). Not about your product ("Which integrations do you want?").
- Multiple choice, ≤ 9 options, brand icons, plus an optional `allowOther`.
- `preselectWhen` on every option you can: website detections, OAuth provider, ICP share from discovery. Most users should only confirm.
- Include a "not yet / I don't" option that routes to the `zeroSetup` capability, and mark it `none: true`. It is exclusive, listed last, and never pre-selected by rules or a decision model.
- With a decision model configured (see `onboarding-implement`), options without a hard `preselectWhen` signal can still be pre-selected from the site's description. Write option labels a person would recognize, because the model reads them.
- Goals that change configuration are usually better as a **rehearsal decision** (e.g. "Protect CPA or push volume?") than as an extra question. Add a second question only if it selects capabilities or fills a workflow field and the budget allows.

### 4. Fields
For every piece of information:
- `tier`: blocking (can't run correctly without it), workflow (changes behavior), or deferrable (everything else)
- `category`: anything that serves your marketing team is `marketing`, and marketing must be `deferrable`
- `infer`: list every source, in order. Names come from `oauth_profile`. Companies come from `email_domain` / `website`. Currency and timezone come from `website` / `browser` / connector.
- `askInContext`: only where the field visibly matters (`{ on: 'rehearsal', surface: 'message signature preview' }`). No bare form fields.
- Invites and profile photos are `deferrable` unless a capability truly needs them. If one does, use `blockingWhen: ['that_capability']` with `askInContext` on the screen where it matters.

### 5. Budget
Keep the defaults (6 screens / 120s / 90s to proof / 1 secondary). Loosening them requires a `justification`.

## Lint until clean

```bash
npx tsx <framework>/packages/spec/src/cli.ts onboarding/spec.ts --paths
```

Read every derived path it prints. For each representative user, ask:
- Do they see **only** connectors their answer implied?
- Is there proof from their own data in ≤ 90s?
- Would they know how to use the product from the rehearsal alone?
- Is any screen there just because a form would have one?

Fix errors. Resolve or justify warnings in a comment. Then hand off to `onboarding-ui` and `onboarding-implement`.

## Replace mode

Map every step in DISCOVERY's existing-flow inventory to its verdict: infer+confirm, rehearsal decision, defer to dashboard, or delete. Add a comment block at the top of the spec listing what was removed and where each item went, so the team can see nothing critical was dropped.
