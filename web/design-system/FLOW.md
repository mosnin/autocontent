# StepFlow: one thing at a time

Sign-up, sign-in, recovery, onboarding and the code flow on the plan screen all
ask for one thing per screen and move between screens the same way. That
behaviour lives in one place, `components/flow.tsx`, so every flow feels the
same. Don't build a multi-field form for these surfaces, and don't hand-roll a
transition: use these.

| Piece | What it does |
|---|---|
| `useStepFlow(order, { initial, history })` | Which step shows, the direction of travel (+1 forward, -1 back), `go(step, { replace, lock })`, `back()`, `canBack`. With `history` (default) each step after the first is a browser history entry, so the browser's Back steps back. The entry the page loaded on is never rewritten (rewriting it makes Next re-request the page). `lock` makes a step the floor: an account was created, a code redeemed, so the steps before it can't be returned to |
| `<StepFlow step direction>` | Shows the current step. The new step slides in 28px from the side it came from with a 6px blur that clears; the old one leaves the other way, faster (160ms), so the two never read as overlapping text. The height glides between steps, so nothing below jumps. Focus moves to the new step's `[data-autofocus]`, else its first field, else the selected option, else its heading |
| `<Step title subtitle onSubmit primary secondary eyebrow>` | One screen: 26px title, one 15px line, the control, one `xl` primary button, at most a quiet row of `StepLink`s. It is a `<form>`, so Enter advances. Its parts arrive 40ms apart (`.ds-stagger`) |
| `<StepBack flow>` / `<StepProgress index count>` | The back arrow (keeps its space when there's nowhere to go) and the quiet progress marks. Never "Step 2 of 5" on screen; the progress bar carries it for screen readers |
| `<CodeInput>` | Six boxes over one real input: paste, `one-time-code` autofill and screen readers see a single field. Calls `onComplete` when the last digit lands |
| `<OptionList>` | Numbered single choice: ↑/↓ move and select, number keys pick (when not typing), Enter on a row submits the step |
| `Input inputSize="lg"`, `Button size="xl"` | The 44px field and action every step uses |

## Motion

- Easing is `--ds-ease-out` (`cubic-bezier(0.22, 1, 0.36, 1)`) everywhere; enter 320 to 460ms, exit 160ms, stagger 40ms.
- Only `transform`, `opacity`, `filter` and the container's height animate.
- Reduced motion: a plain 150 to 200ms crossfade. No travel, no blur, no stagger (the token rule in `tokens.css` collapses the CSS parts).
- Nothing bounces. Steps are keyboard-driven and repeated, so they stay quick.

## Where it's used

| Flow | File |
|---|---|
| Sign-up: email, password, code | `components/auth/sign-up-form.tsx` |
| Sign-in: email, password or SSO, verify, two-factor | `components/auth/sign-in-form.tsx` |
| Verify email, forgot password, reset password | `components/auth/recovery-forms.tsx` |
| Two-factor, accept invitation | `components/auth/two-factor-challenge.tsx`, `accept-invitation.tsx` |
| Onboarding: confirm, intent, offer, connect, rehearsal | `components/app/onboarding/flow.tsx` |
| Plan screen: plans, code kind, code, unlocked | `components/app/plans/plans-view.tsx` |
