# Onboarding

Marketer's first run follows the intent-driven framework from
`mosnin/onboarding-starter`, vendored in `/.intent-onboarding` (doctrine:
`RULES.md`, visual bar: `DESIGN.md`, skills in `/.claude/skills/onboarding-*`).

- **Spec**: `/onboarding/spec.ts` (aha, proof, capabilities, fields, budget).
  `npx tsx .intent-onboarding/packages/spec/src/cli.ts onboarding/spec.ts --paths`
  must stay at 0 errors, 0 warnings.
- **Personas**: `/onboarding/personas.ts`, replayed with
  `npx tsx .intent-onboarding/packages/testing/src/cli.ts onboarding/personas.ts`;
  every persona must pass with zero doctrine violations.
- **UI**: `components/app/onboarding/flow.tsx` (built from `@/design-system`), route
  `app/(onboarding)/onboarding` (full screen, no sidebar), preview at
  `/preview/onboarding`.

## The flow

One question per screen, on the design system's StepFlow
(`design-system/FLOW.md`): the step slides in from the side it came from,
focus moves to its control, Enter continues, Esc and the browser's Back go
back, and the preview on the right keeps changing as they answer.

1. **Confirm**: brand and website inferred from the email domain, one tap
   "Looks right" or edit in place (personal domains ask).
2. **Intent**: "How do you get attention today?" (numbered, keyboard).
3. **Offer**: one sentence about what they market (the intent screen's second
   beat in the spec). Activation starts here: draft a playbook, create it with
   approve-before-post on, start the first video or article. Nothing posts.
4. **Connect** (only if implied): channels for short video, ad accounts for
   paid. Verified by polling the API, never by the redirect.
5. **Rehearsal** on the real first piece: ask before posting or post on
   schedule (the only decision that unlocks outbound), with cadence as a
   detail of the schedule.
6. **Plan screen**, only for a workspace with nothing to run on (billing on,
   no credit, no code): `/plans` (`docs/billing/access-codes.md`). The
   playbook is drafted and saved first, the first piece starts there once
   there's credit, and the dashboard opens on it.
7. **Handoff**: the dashboard opens on that same piece (`/content/videos/:id`,
   `/seo/:id`, or a Media buyer session for paid).

New workspaces (no playbooks, no videos, no brand) are sent here from the app
layout, and workspaces with nothing to run on are sent to `/plans`. Failures
never dead-end: a failed draft falls back to a playbook built from the
sentence, and a failed first run says so and moves on.

Known gaps: no website scan yet (so the `website` pre-select signals in the
spec never fire), and no PostHog instrumentation of the standard event schema.
