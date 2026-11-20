---
name: onboarding-optimize
description: Analyze real onboarding data (PostHog) and produce ranked, specific, human-approvable recommendations to cut time to value and raise aha rate, each tied to a metric, a RULES.md rule and an exact spec change, plus the experiment to validate it. Use when onboarding is instrumented and has traffic, or when asked how to speed up or improve activation.
---

# Optimize

Data in, recommendations out. A human approves each one, it ships behind a flag, and an experiment decides. **Never change the live flow automatically.**

## Inputs

- At least ~100 `onboarding_started` events per variant for directional reads (say so when the sample is smaller).
- Access to PostHog through its MCP server, or the HogQL query API with a personal API key from env.
- `onboarding/spec.ts`, plus DISCOVERY.md for ICP priors.

## Run the insights CLI first

`packages/analytics` implements every analysis below, along with the INSIGHTS.md format:

```bash
# PostHog: needs POSTHOG_HOST, POSTHOG_PROJECT_ID, POSTHOG_API_KEY (personal key, query:read) in env
npx tsx <framework>/packages/analytics/src/cli.ts --spec onboarding/spec.ts --days 14 --out onboarding/INSIGHTS.md
# Or from an export
npx tsx <framework>/packages/analytics/src/cli.ts --spec onboarding/spec.ts --events events.jsonl --out onboarding/INSIGHTS.md
# No traffic yet? Preview the report from your persona suite
npx tsx <framework>/packages/analytics/src/cli.ts --personas onboarding/personas.ts --synthetic 400
```

See `docs/examples/INSIGHTS.example.md` for the output. Your job after running it:
1. Sanity-check the top recommendations against session replays.
2. Apply the approved spec changes on a branch and make sure it still lints.
3. Set up the experiment.

The queries below are what the CLI computes. Use them for ad-hoc digging in PostHog.

## Run these analyses, every time, in this order

Adjust the time window as needed. All queries use the standard schema.

**1. Headline metrics vs. targets**
```sql
SELECT
  quantile(0.5)(toFloat(properties.ms_since_start)) / 1000 AS median_s
FROM events
WHERE event = 'proof_rendered' AND properties.source = 'own' AND timestamp > now() - INTERVAL 14 DAY
```
Repeat for `aha_reached`. Compute the aha rate (users reaching `aha_reached` ÷ users with `onboarding_started`) and first-session reconfiguration. Compare each against the targets in PLAN §7.

**2. Time sinks**
```sql
SELECT properties.screen_id AS screen, count() AS n,
       quantile(0.5)(toFloat(properties.duration_ms)) / 1000 AS median_s
FROM events WHERE event = 'screen_completed' AND timestamp > now() - INTERVAL 14 DAY
GROUP BY screen ORDER BY median_s * n DESC
```
Typical fixes: pre-select instead of choose, infer instead of confirm, move into the rehearsal, defer to the dashboard, or speed up the activation's first result.

**3. Drop-off by screen.** Funnel over `screen_viewed` in index order. Flag any step losing more than 15%.

**4. Proof effectiveness**
```sql
SELECT properties.proof_id AS proof,
       countIf(event = 'proof_rendered') AS shown,
       countIf(event = 'aha_reached') AS acted
FROM events WHERE event IN ('proof_rendered', 'aha_reached') AND timestamp > now() - INTERVAL 30 DAY
GROUP BY proof ORDER BY acted / shown DESC
```
Promote proofs that convert, rewrite or replace ones that don't, and check D7 retention by proof.

**5. Intent paths.** Group `intent_answered.options` against aha rate. Which answers stall? That usually points to a slow activation or a weak proof for that capability.

**6. Inference and pre-selection quality.** `confirm_corrected` by field; `preselected` vs. `preselected_kept`. A high correction rate means: fix the enricher, lower confidence, or switch to ask-in-context.

**7. Reconfiguration hotspots.** `setting_changed` where `set_by_onboarding` and `first_session`, by setting. Each hotspot is a decision that belongs in the rehearsal, or a default that's wrong.

**8. Segment gaps.** Split the aha rate by ICP segment (from person properties). Low segments may need a different primary capability or proof.

## Write `onboarding/INSIGHTS.md`

```markdown
# Onboarding insights: <date range>, n=<users>
## Headline (metric · current · target · trend)
## Recommendations (ranked by expected impact × confidence ÷ effort)
### 1. <one-line change>
- Evidence: <numbers, query>
- Metric it moves: <metric>, expected <direction / rough size>
- Rule: <RULES id>
- Spec change: <exact diff to onboarding/spec.ts>
- Experiment: flag `onboarding-flow` variant <name>, success = <metric threshold>, guardrail = aha rate / reconfiguration
## Watch list (signals too weak to act on yet)
```

Rules for recommendations:
- Every one has evidence, a target metric, a rule id and a concrete spec change. "Improve the UX" isn't a recommendation.
- Speed changes **must** name aha rate and first-session reconfiguration as guardrails. Faster with a lower aha rate is a regression (RULES §9.2).
- Proposed spec changes must still lint clean. Run the linter on a copy.
- Ship one experiment per surface at a time.
