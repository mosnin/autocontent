# The wave

Marketer is quiet on purpose: gray on gray, nothing decorative moves (see README section 2). The wave is the one exception, and it is here on purpose.

**Do not remove it, and do not add more of it.** `npm run ds:guard` fails the build if a registered wave site loses its wave, if the wave appears anywhere unregistered, or if anything imports the engine directly.

## What it is

A wave of colour opens from the button a person just pressed. It bends the screen as it passes and carries the thing they reviewed into the thing that now exists.

- **Engine:** Distortion waves by Libraries.dev (MIT), vendored in `web/vendor/distortion-waves`. See `PROVENANCE.md` there.
- **The only way to use it:** `CommitWave` from `@/design-system` (`components/wave.tsx`).

## Why it exists

The product's promise is that you say yes and real work happens. Almost everything in the app is reading and reviewing, and that should stay calm. But a few times a person commits something that changes the world outside the app: money starts being spent, a post goes out. A plain button press undersells that. The interface should acknowledge it, once, at the moment it happens, and from the place the person touched.

That is the whole brief. The wave marks **commitment**. It is not decoration, not a page transition, and not a loading state.

## The three moments

| Moment | When | Character | Colour |
|---|---|---|---|
| `launch` | A campaign goes live: an ad campaign is activated, or a distribution campaign is started. | Unhurried, full swell, rises from the button. | The hue of the tool that launched (`--ds-wave-a…f` in `tokens.css`). Colour tells you which department just went to work. |
| `approve` | "Approve & Run" on a plan card, in chat or in Activity. | Quiet and quick: less bend, no colour fringe. It happens often, so it must never get tiring. | Near-monochrome. |
| `arrive` | Onboarding hands over to the product: the person's first piece is ready. | A ring opening from the brand mark. | Full colour. Once per workspace. |

The numbers for each character live in one table, `MOMENTS` in `components/wave.tsx`. Tune them there and nowhere else, so every instance of a moment feels identical.

## Rules

1. **Only for commitment by a person.** The trigger is a person pressing the control that makes something real. Never fire it for work the agent does on its own, for navigation, for opening a dialog, for saving a form, or for reads.
2. **Only on success paths the person chose.** Never on reject, dismiss, pause, delete or any destructive action. Those stay plain.
3. **It opens from what was pressed.** Pass the committing control as `source` and keep it inside `action`, so it stays live and sharp above the wave.
4. **It ends on a receipt.** `receipt` states what now exists ("Fresh pasta, Spring is live. Spending up to $40 a day"). If there is nothing true to say yet, there is no wave.
5. **Honest timing.** Send the wave when the server has accepted the action, not on click. If the request fails, there is no wave and the error shows as usual. If the outcome is unknown (see `docs/rails/failure-semantics.md`), there is no wave either: the person gets the "check this" item instead.
6. **One per screen, one at a time.** Two waves never run together.
7. **It degrades by itself.** Without WebGL 2, or when the person asks for reduced motion, the engine crossfades. Don't add a second fallback.
8. **Three moments, no fourth** without changing this file, `MOMENTS`, and the guard's site list in the same commit, with the reason written here.

## Where it is (the registered sites)

The guard holds this list in `guard.mjs` (`WAVE_SITES`). Keep the two in step.

| Site | File | Moment |
|---|---|---|
| Preview and tuning page | `app/preview/wave/wave-demo.tsx` | all |

Real screens are added to this table and to `WAVE_SITES` as they are wired.

## Using it

```tsx
const button = useRef<HTMLButtonElement>(null);

<CommitWave
  moment="launch"
  tone={TOOL_ICON.paid.tone}
  committed={campaign.status === "active"}   // set after the server says yes
  source={button}
  action={<Button ref={button} variant="primary" onClick={activate} loading={busy}>Launch campaign</Button>}
  receipt={<LiveReceipt campaign={campaign} />}
>
  <Review campaign={campaign} />
</CommitWave>
```

- Both views are ordinary DOM stacked in one box; the box takes the size of the larger. `CommitWave` gives the box an opaque `bg-surface` and `rounded-ds-lg`.
- Anything animating inside the views stands still while the wave passes. Put live things (the button, a spinner) in `action`.
- Images or fonts from another origin need CORS to appear in the picture.
- The Content-Security-Policy must allow `img-src data: blob:` and `font-src data:`.

## Checking it

`/preview/wave` shows each moment on real surfaces (add `?theme=light`). Check both themes, and check with reduced motion turned on.
