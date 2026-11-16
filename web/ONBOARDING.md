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
- **UI**: `components/mk/onboarding/flow.tsx`, route
  `app/(onboarding)/onboarding` (full screen, no sidebar), preview at
  `/preview/onboarding`.

## The flow

1. **Confirm**: brand and website inferred from the email domain, one tap
   "Looks right" or edit in place (personal domains ask).
2. **Intent**: "How do you get attention today?" (numbered, keyboard), plus
   one sentence about what they market. Activation starts here: draft a
   playbook, create it with approve-before-post on, start the first video or
   article. Nothing posts.
3. **Connect** (only if implied): channels for short video, ad accounts for
   paid. Verified by polling the API, never by the redirect.
4. **Rehearsal** on the real first piece: ask before posting or post on
   schedule (the only decision that unlocks outbound), and cadence.
5. **Handoff**: the dashboard opens on that same piece (`/content/videos/:id`,
   `/seo/:id`, or a Media buyer session for paid).

New workspaces (no playbooks, no videos, no brand) are sent here from the app
layout. Failures never dead-end: a failed draft falls back to a playbook built
from the sentence, and a failed first run (e.g. no credits) says so and moves on.

Known gaps: no website scan yet (so the `website` pre-select signals in the
spec never fire), and no PostHog instrumentation of the standard event schema.
