---
name: onboarding-review
description: Score any onboarding (built with this framework or not) against RULES.md and DESIGN.md, producing a scorecard with pass/fail per rule, the biggest time-to-value losses, and a recommended mode (replace vs. optimize). Use to baseline an existing flow, audit a PR that touches onboarding, or decide where to start.
---

# Review

Produce `onboarding/REVIEW.md`: an honest, evidence-based scorecard. Use the running app wherever possible: walk the flow and take screenshots. Code reading alone misses what users actually see.

## Procedure

1. **Walk the flow** as two or three realistic users (for example: one with a business email who uses the main integration, one on a personal email, one who "doesn't do this yet"). Time every screen. Screenshot every screen in both themes if supported.
2. **Inventory:** every screen, every field asked, every connector shown, what happens on connect, what the first dashboard shows.
3. **Score each rule group.** Every line gets pass, partial or fail, plus evidence (a screenshot, file:line or timing).

| Group | Checks (RULES / DESIGN ids) |
|---|---|
| Purpose | R1.1 configured + running + proof at the dashboard · R1.3 every screen has an effect · R1.4 no settings visit needed |
| Intent | R2.1 first question is about workflow/goal · R2.2 multiple choice + pre-selection · R2.3 only intent-implied connectors · R2.4 one primary, ≤ 1 secondary · R2.5 a "not yet" path |
| Information | R3.2 no deferrable fields asked · R3.3 inferred before asked · R3.4 asked in context · R3.6 no marketing questions |
| Activation | R4.2 work starts at verify · R4.3 progress visible · R4.4 outbound gated · R4.5 verified = connected |
| Proof | R5.1 proof from own data · R5.2 decisions on a real example · R5.3/5.4 dashboard continues with proof, no empty state |
| Speed | R6.1 screens / seconds / time to proof within budget |
| Trust | R7.1 plain scopes · R7.2 ledger + undo · R7.4 skippable optional steps |
| Design | DESIGN D1–D20 and the §5 anti-patterns, compared side by side with `design/references/` |
| Measurement | RULES §9: standard events present? |

4. **Score:** pass = 1, partial = 0.5, fail = 0. Report the percentage overall and per group.
5. **Recommend a mode:** below 50% → **replace**; 50–85% → **optimize**; above 85% → tune with optimize once data exists.

## REVIEW.md structure

```markdown
# Onboarding review: <product>, <date>
Score: <n>% (Purpose x · Intent x · Information x · Activation x · Proof x · Speed x · Trust x · Design x · Measurement x)
Recommended mode: replace | optimize. <one line why>
## Walkthrough (persona → screens → seconds → what they saw at the dashboard)
## Biggest time-to-value losses (top 5, with evidence and estimated seconds lost)
## Rule-by-rule results
## Design gaps (screenshot vs. reference)
## Quick wins (≤ 1 day each)
```

When reviewing a **pull request**, scope the review to the screens and rules the diff touches. Block on any RULES MUST violation or DESIGN §5 anti-pattern.
