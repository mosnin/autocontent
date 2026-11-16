# RULES: Intent-Driven Onboarding Doctrine

These rules are **non-negotiable** for any onboarding built with this kit. They apply to humans and coding agents alike. *MUST* and *MUST NOT* items are enforced by `checks/` (the spec linter and persona replays) wherever possible.

**The one sentence:** onboarding exists to set the product up around what this user is trying to do, and to prove it works on their real data, before they first see the dashboard.

---

## 1. Purpose

1.1 Onboarding **MUST** end with the product configured for the user's actual workflow, already running, and showing proof.
1.2 Onboarding **MUST NOT** be a form that happens before the product. If removing the AI would leave you with a normal step-by-step wizard, the design has failed.
1.3 Every screen **MUST** declare exactly one purpose: `gather` (collects context that changes the setup), `setup` (connects or configures something), or `prove` (shows a real result). A screen with no purpose **MUST NOT** ship.
1.4 Being fast without the user understanding the product is a failure. If the user would need settings, docs or a tour in their first session, the onboarding did not do its job.

## 2. Intent first

2.1 The first substantive question **MUST** be about the user's workflow or goal ("How do you follow up with leads today?"), not about the product ("Which integrations do you want?").
2.2 Intent questions **MUST** be multiple choice first (single or multi select), with free text only as an optional "Other". Options **MUST** be ranked, and **SHOULD** be pre-selected, from enrichment (for example, tracking pixels or integrations detected on the user's website) and ICP/customer data when available. The user **MUST** be able to see and change every pre-selection.
2.3 Connectors, steps and options **MUST** be generated from the selected capabilities. A connector the user's intent did not imply **MUST NOT** render during onboarding.
2.4 There is one **primary** capability, set up fully, and at most **one** optional secondary step. Everything else is deferred to the dashboard as a suggestion.
2.5 If the user's intent is "I don't do this today", the kit **MUST** route to the capability that gets them value with the least setup, not to a catalog.

## 3. Information: smart, not minimal

3.1 Every field **MUST** declare a tier:
- **blocking**: the system cannot run correctly or legally without it (sender name, timezone, consent)
- **workflow**: changes how the product behaves for this user (channels, tone, approval mode, cadence)
- **deferrable**: everything else

3.2 Blocking and workflow fields **MUST** be collected before the dashboard. Deferrable fields **MUST NOT** be asked during onboarding unless a selected capability makes them blocking (for example, a team-routing capability makes invites blocking; a lead-facing profile makes the photo blocking).
3.3 Every field **MUST** be resolved in this order: **infer** (signup, OAuth profile, domain, connector data), then **confirm** (one tap when confidence is 0.8 or higher), then **ask in context**.
3.4 "Ask in context" means at the moment the field visibly matters. Ask for the name inside a signature preview, the timezone inside the send-window preview, the photo where the lead would see it. A bare "Enter your name" field **SHOULD NOT** exist.
3.5 Low-confidence inferences **MUST NOT** drive actions without confirmation.
3.6 Marketing questions (attribution, company size, "how did you hear about us") **MUST NOT** appear before the dashboard. Infer them from UTM/enrichment or ask after the aha.

## 4. Activation: it works before they arrive

4.1 Every capability **MUST** define `activate()` and `proof`.
4.2 `activate()` **MUST** start within 2 seconds of its connector verifying, run as a durable background job, and keep running while the user continues.
4.3 Activation progress **MUST** be visible on the screen where it started (counts, items found) and **MUST** carry through to the dashboard.
4.4 Activation **MUST** be read-only or reversible by default. Outbound or destructive actions (sending messages, deleting, publishing) **MUST NOT** run until the user has explicitly chosen that mode during the rehearsal.
4.5 A connector counts as "connected" only after its first successful authenticated call.

## 5. Proof and understanding

5.1 Before the dashboard, the user **MUST** see at least one proof item drawn from **their own data** ("9 leads in your Instagram DMs"). Sample data **MUST** be clearly labeled, and is only allowed when no connector was possible.
5.2 The product's core decisions (at most 3) **MUST** be made in a **rehearsal**: on a real example from the user's data (a real lead, a real draft), not as abstract settings.
5.3 The first dashboard view **MUST** continue the last onboarding screen: the same objects, the same wording, and the obvious next action ("Review 14 drafts", "Start following up").
5.4 The first dashboard load **MUST** contain at least one proof item and **MUST NOT** be an empty state.
5.5 Product tours and checklists **MUST NOT** stand in for rehearsal.

## 6. Speed budget

6.1 Default budget: **≤ 6 screens and ≤ 120 seconds** to the dashboard, and **≤ 90 seconds** to the first proof. Products may tighten these, and may loosen them only with a written justification in the spec.
6.2 The planner **MUST** enforce the budget. Anything that doesn't fit becomes a dashboard item, never an extra screen.
6.3 Slow work (syncs, scans, model calls) **MUST** run in parallel with user input, never block it. Prefetch during OAuth redirects.

## 7. Trust and control

7.1 The scopes the agent requests **MUST** be shown in plain language before it acts on them.
7.2 Everything the agent configures **MUST** be written to a setup ledger the user can view, and undo where possible.
7.3 Inferred facts **MUST** show their source when the user asks ("from your Google account", "from kw.com").
7.4 Every optional step **MUST** be skippable without breaking the flow. Blocking steps **MUST** explain why they're needed in one line.

## 8. Design

8.1 Use the kit's design tokens: monochrome interface, hairline borders, both themes. Color is reserved for brand logos, status and selection.
8.2 One primary action per screen, and keyboard-first (number keys, Enter, Esc).
8.3 The right-hand panel (or its mobile equivalent) **MUST** show the user's workspace or activation changing in real time as they answer.
8.4 Copy is short and specific to the user. Use their lead's name and their channel; never "Step 3 of 7".

## 9. Measurement

9.1 Every implementation **MUST** emit the standard event schema (`packages/spec/src/events.ts`) so that these can be computed: Time to First Proof, Time to Aha (the user *acts on* a proof), Time to Configured, aha rate, proof acceptance, intent match, screen yield, inference and pre-selection accuracy, and first-session reconfiguration.
9.2 Speed alone is never the success metric. A faster flow that lowers aha rate or raises first-session reconfiguration is a regression.
9.3 Optimization **MUST** be human-approved: data produces recommendations, a person or agent applies a spec change behind a feature flag, and an experiment decides. The flow **MUST NOT** rewrite itself in production.
9.4 Customer and ICP data **SHOULD** be used when available (option ranking, defaults, proof choice, personas) and is **never** required.

## 10. Definition of done (checked before shipping)

- [ ] Spec lints clean (`checks/lint`)
- [ ] Persona replays pass: each persona sees only screens tied to their intent, gets proof in 90 seconds or less, and reaches the dashboard in 120 seconds or less
- [ ] No blocking field is missing at the dashboard; no deferrable field was asked
- [ ] The first dashboard load shows a proof item and the obvious next action
- [ ] Outbound actions are gated by a rehearsal decision
- [ ] Standard events flow to the analytics adapter; TTFP, Time to Aha and first-session reconfiguration are visible
