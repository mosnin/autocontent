---
name: onboarding-instrument
description: Instrument onboarding with the framework's standard event schema in PostHog (or another analytics tool via the same names), and set up the funnels, insights, feature flags and dashboard needed to measure time to first proof, time to aha, aha rate, intent match and first-session reconfiguration. Use after implementing, before optimizing, or to add measurement to any existing onboarding.
---

# Instrument

The optimization loop can only use data captured here. Event names and properties are fixed by `packages/spec/src/events.ts` (`ONBOARDING_EVENTS`), and metric definitions by `ONBOARDING_METRICS`. Don't invent alternatives.

## 1. Setup

Use the adapter in `packages/analytics`; don't hand-roll capture calls:

```ts
import { posthogAdapter, variantFromFlag } from '@intent-onboarding/analytics';
// Browser (posthog-js):
const analytics = posthogAdapter(posthog, { validate: process.env.NODE_ENV !== 'production' });
const variant = variantFromFlag(posthog); // 'onboarding-flow' flag → every event carries `variant`
createOnboarding({ spec, variant, adapters: { analytics, ...rest } });
// Server (posthog-node): posthogAdapter(client, { distinctId: () => userId })
```

The engine already emits every standard event at the right moment. Your remaining job is identity, the variant, and `ob.settingChanged(setting)` from the host's settings code.

- Reuse the host's PostHog client if one exists. Otherwise install `posthog-js` (client) and `posthog-node` (server) and initialize them with the project key from env. Never hard-code keys.
- Fire **server-side** for anything the server knows authoritatively: `connector_verified`, `activation_started`, `proof_rendered` (with the computed `value`), `aha_reached`, `setting_changed`. Fire client-side for views and interactions.
- Identify the user at signin. Attach `flow_version` and `variant` as super-properties so every event can be split by experiment.

## 2. Events (all required)

| Event | When | Key properties |
|---|---|---|
| `onboarding_started` | First onboarding screen | flow_version, variant, entry |
| `context_inferred` | Each field resolved without asking | field, source, confidence |
| `confirm_shown` / `confirm_corrected` | Confirm card shown / user edited an inferred value | fields / field, source |
| `intent_answered` | Intent question submitted | question, options, preselected, preselected_kept, other_text |
| `screen_viewed` / `screen_completed` | Every derived screen | screen_id, kind, purpose, index / duration_ms, skipped |
| `connector_started` / `connector_verified` / `connector_failed` | Connect lifecycle | connector, capability, duration_ms / reason |
| `activation_started` | Job enqueued | capability, activation, ms_since_start |
| `proof_rendered` | First proof value shown | proof_id, value, source (own/public/sample), ms_since_start |
| `decision_made` | Each rehearsal decision | capability, decision, option, default_kept |
| `onboarding_completed` | Handoff | screens, duration_ms, primary, secondary, deferred |
| `dashboard_first_load` | First dashboard render | proof_items, ms_since_start |
| `aha_reached` + the spec's `aha.event` | User clicks the proof CTA | aha_event, proof_id, ms_since_start |
| `setting_changed` | Any settings edit | setting, set_by_onboarding, first_session |

`ms_since_start` is measured from `onboarding_started` and stored on the server.

## 3. In PostHog, create

- **Funnel:** onboarding_started → intent_answered → connector_verified → proof_rendered → aha_reached, broken down by `variant` and by the primary capability.
- **Trends:** median time to first proof and median time to aha (from `ms_since_start`), weekly.
- **Insight per metric** in `ONBOARDING_METRICS`: proof acceptance by `proof_id`, preselection accuracy, inference accuracy by `field`, first-session reconfiguration by `setting`.
- **Dashboard:** "Onboarding: time to value", containing the above.
- **Feature flag:** `onboarding-flow` (control / intent), used by replace mode and by every optimization experiment.

If the PostHog MCP server is available to you, create these through it. Otherwise document the exact definitions in `onboarding/ANALYTICS.md` so a human can create them in a few minutes.

## 4. Verify

Run through the flow once per representative path. Confirm in PostHog's live events that every event fires once, with correct properties and in the right order. Check `proof_rendered.source` is `own` when a connector was used.
