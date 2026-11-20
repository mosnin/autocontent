---
name: onboarding-discover
description: Audit a host codebase before designing intent-driven onboarding. Finds the product's core loop, what "working" means, existing auth/OAuth/integrations, data models, any existing onboarding flow, analytics already in place, and customer/ICP data that can drive pre-selection. Use as the first step of build or replace mode. Produces onboarding/DISCOVERY.md.
---

# Discover

Goal: learn enough about the product and its users to write a spec where most users only **confirm** instead of type, and where the first proof comes from their own data. Read `skills/intent-onboarding/SKILL.md` first if you haven't.

## 1. Product core loop

Find out, from code first and docs second:
- **What the product does for a user**, in one sentence (it becomes `product.promise`).
- **What "working" means**: the first artifact or action that delivers value (leads found, ads launched, tickets answered, report generated). Look at jobs, agents, cron tasks and the main dashboard queries.
- **Which external accounts that work depends on**: existing OAuth providers, API clients, MCP servers, webhooks. List each with the scopes already requested and the cheapest call that proves the connection works.
- **What can run read-only right after connecting**: an existing sync, scan or analysis job you can trigger as activation. Note how long a first result takes.

## 2. Existing onboarding (replace and optimize modes)

Inventory every current step and field. For each, record:

| Step / field | Purpose today | Can it be inferred? From what? | Tier (blocking / workflow / deferrable) | Verdict (keep / infer+confirm / move into rehearsal / defer / delete) |
|---|---|---|---|---|

Also record where users land after onboarding, what's empty there, and what settings users typically change in their first session (look at settings routes and audit logs).

## 3. Customer and ICP data (optional, never blocking, always checked)

First **ask the human**: "Do you have data on your customers or ICP (segments, what retained customers use, interview notes, a CRM export)?"

Then **check the codebase and connected tools yourself**, whatever the answer:
- **Database:** user/account/workspace tables, their industries and plans, which integrations accounts actually connected, which features retained accounts use (query counts and do not copy personal data into files).
- **Analytics:** PostHog/Segment/Amplitude SDK usage, existing event names, funnels already defined. If a PostHog MCP server or API key is available, pull aggregate stats.
- **Billing:** Stripe plans or prices, and who converts.
- **Docs:** `icp.md`, personas, research notes, onboarding copy docs.

Turn what you find into **priors**, for example:
- "68% of paying accounts connected Meta; 41% Google; 9% TikTok" → option order and `preselectWhen: { source: 'icp', segmentShareAtLeast: 0.5 }`
- "Retained accounts ran a competitor scan in week 1" → candidate proof
- "Agencies (multiple ad accounts) churn without team invites" → `blockingWhen` for invites in that segment

Record aggregates only. Never write personal data (emails, names) into DISCOVERY.md.

## 4. Enrichment signals available at signup

List what's knowable before the user types anything: the OAuth profile (name, avatar, email), the email domain, the website (scan for product, industry, currency, and **detected tech**: tracking pixels, embeds, platform), UTM/referrer, browser timezone and locale.

## 5. Write `onboarding/DISCOVERY.md`

Use this structure:

```markdown
# Discovery: <product>
## Promise
## What "working" means (candidate proofs, ranked)
## Connectors (id, auth, scopes in use, verify call, time to first result)
## Activation candidates (job, read-only?, est. seconds)
## Existing onboarding inventory (replace/optimize only)
## Customer / ICP priors (aggregates + source)
## Enrichment signals
## Open questions for the human
## Recommended mode: build | replace | optimize, with one-line reasoning
```

Next: `onboarding-spec` (build/replace) or `onboarding-review` (optimize).
