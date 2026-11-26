# The plan screen's light

The plan screen (`/plans`, `components/app/plans/plans-view.tsx`) is where a new
workspace chooses how to start, after onboarding and before the dashboard
(`docs/billing/access-codes.md`). It is the one place outside Home and the
onboarding preview where shader light sits on a choice.

## What it is

Each credit pack is a `PlanOption` (ref 04) whose header is a `Shader` field,
with the pack's name and price set on the light in ink. Three packs, three
palettes (`lagoon`, `dusk`, `ember`); the recommended pack is lifted (stronger
hairline, `shadow-ds-float`) and carries the solid action. On hover (pointer
devices only) a card rises 2px and its light drifts closer (scale 1.04 over
700ms). On a phone the recommended pack comes first.

## Why it exists

This screen asks for money. A plain list of prices would make the most
important decision in the first session look like a settings page. The light
gives each pack an identity you remember after one look, and puts the price
where the eye lands first. Everything else on the screen stays quiet: one
title, one line, three cards, one quiet way in with a code.

## Rules

1. **Only on the plan choice.** The plan cards on `/plans` (and Billing in
   Settings, which uses the same `PlanOption`). Not on the code flow, not on
   success states, not on auth.
2. **Ink on light.** Text on the shader is `on-fill-ink`, never white: the
   palettes are light, and contrast is against the fill in both themes.
3. **Prices come from the server** (`GET /api/v1/billing/access` → `packs`);
   the words come from `PLAN_COPY` in `lib/billing-access.ts`. Two to four
   packs, one recommended, three plain points each. No feature matrix.
4. **Codes stay secondary.** "Have an invite or pilot code?" is a quiet text
   button under the cards. It turns the screen into its own StepFlow (which
   kind, enter it, what it unlocked), never a dropdown or a field on the cards.
5. **Reduced motion** gets one still frame of light (the `Shader` does this
   itself) and no hover travel.
