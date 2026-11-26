---
name: onboarding-implement
description: Wire an intent-driven onboarding spec into a host application. Connects intent answers to capabilities, resolves fields by infer/confirm/ask-in-context, triggers activation jobs on connector verify, streams proof into the UI, gates outbound actions on rehearsal decisions, and hands off to a proof-first dashboard. Use after onboarding-spec, in build or replace mode.
---

# Implement

Make the spec real inside the host app, using the host's own auth, database, job runner and integration code. The framework adapts to the host.

## Not a web app?

The engine is headless. `examples/cli-devtool/src/terminal.ts` renders the same spec as a terminal onboarding. Use it as the pattern for CLIs, desktop apps or chat surfaces: loop over `ob.view().screen`, render each kind, and call the same actions.

## Architecture to build (inside the host)

```
onboarding/
  spec.ts              ← from onboarding-spec (lint-clean)
  context.ts           ← context graph store: field → { value, source, confidence }
  enrich.ts            ← enrichers: oauth profile, email domain, website scan (+ tech detection), icp priors
  planner.ts           ← derivePath(spec, chosenOptions) + "next screen" from current state
  activation/          ← one job per capability; enqueued on connector verify
  proof.ts             ← reads activation output → ProofDef placeholders → feed item
  ledger.ts            ← every setup action + undo
  screens/             ← UI per derived screen kind (see onboarding-ui)
```

Use the headless engine in `packages/core` (`createOnboarding({ spec, adapters })`) rather than hand-rolling state. It already implements context, pre-selection, planning, activation-on-verify, proof, the outbound gate (`assertOutbound`), the ledger, the dashboard handoff and the standard events. Your job is the adapters: `connectors`, `jobs`, `enrichers` (add a website scanner), `analytics`, `storage`. `derivePath` from `packages/spec` is the planner's source of truth. The runtime may personalize copy, but it **must not add screens** beyond what `derivePath` returns for the user's answers.

## Steps

1. **Context and enrichment.** Persist the context graph per user. Start enrichment **at signin** (in parallel with the OAuth redirect): domain → company, website scan → product, currency, detected pixels and embeds. Free-mail domains get low confidence and fall back to asking for the website in the confirm card.
2. **Pre-selection.** Evaluate every option's `preselectWhen` against context and ICP priors before rendering the intent screen. Record `preselected` and `preselected_kept` for analytics.
3. **Connect, verify, activate.** Reuse the host's OAuth/integration code. "Connected" means the connector's `verify` call succeeded. On verify, **enqueue the capability's activation job within 2s**, in the host's job runner (queue, worker, cron, durable workflow). Never run it inline in the request.
4. **Stream progress.** Push activation progress (counts, first items) to the client using whatever the host already has (SSE, websockets, realtime DB, polling at 1s as a last resort). The connect screen and preview panel show it live.
5. **Rehearsal.** Choose the real example from activation output (the first good lead, the best ad). If activation hasn't produced one yet, show the artifact skeleton and swap it in when it arrives. Persist each decision as real product configuration, the same records the settings page edits.
6. **Outbound gate.** Activation is read-only. Sends, launches, writes and deletes stay blocked server-side until the gating decision allows them. Enforce this in the service layer, not just in the UI.
7. **Fields in context.** Resolve blocking and workflow fields by inferring, then confirming, then asking at the `askInContext.surface`. Deferrable fields go to a dashboard queue for progressive profiling after the aha.
8. **Ledger.** Write every configuration change made by onboarding to a ledger with undo. Show it at handoff ("Here's what I set up").
9. **Handoff.** The first dashboard load renders the proof as the top item with its CTA (the aha event), the decisions needing input, and deferred capabilities as suggestions. **No empty states.**
10. **Fallbacks.** If a connector fails, show a designed reconnect state and let the user continue. Use `proof.fallback` (public or **labeled** sample data) so they still arrive at proof.

## Optional: a decision model (Jev)

When the team has a TypeSafe or OpenRouter key, add Jev. It makes pre-selection, free-text answers and activation classification more accurate without slowing anything down:

1. **Server:** add a route that calls `handleDecisionsRequest(jevDecisions({ via }), body)` from `packages/decisions-jev`. `examples/nextjs-ads-demo/app/api/decisions/route.ts` is the pattern. Without a key, answer 503 and the engine uses rules.
2. **Client:** `adapters.decisions = httpDecisions('/api/decisions')`, imported from `@intent-onboarding/decisions-jev/http`, which keeps the SDK out of the browser bundle.
3. **Activation:** use `classifyItems` to decide which scanned items count toward the proof ("is this a lead who went quiet?"), and `rankItems` to choose the rehearsal example.
4. **Field inference:** use `decisionEnricher` for choice fields the site implies (market, business type).
5. **Tune thresholds with personas:** replay with `decisions: jevDecisions()` against a real key and adjust `preselectThreshold`. Probabilities differ by model.

Never make onboarding depend on the model. Everything must still work with `decisions` unset.

## Replace mode specifics

- Put the new flow behind a feature flag (PostHog flag if available). Keep the old flow intact as the control.
- Migrate nothing destructively. Existing users never see the new onboarding unless the team opts them in.
- After instrumenting both flows (see `onboarding-instrument`), compare aha rate, time to first proof and first-session reconfiguration. The old flow is removed only after the human approves the result.

## Verify before calling it done

- `cli.ts onboarding/spec.ts --paths` is still lint-clean.
- Write `onboarding/personas.ts` (see `templates/*/personas.ts`) for 3–6 realistic users, including a personal-email user, a "not yet" user and a failing connector, and run `npx tsx <framework>/packages/testing/src/cli.ts onboarding/personas.ts`. Zero doctrine violations.
- Walk each representative path from the linter output end to end, with real or sandbox connectors, and time it.
- Confirm no connector outside the user's answers ever renders. Confirm outbound actions are blocked until the gating decision. Confirm the dashboard opens on proof.
- Run the `onboarding-ui` self-review loop on every screen.
- Hand off to `onboarding-instrument`.
