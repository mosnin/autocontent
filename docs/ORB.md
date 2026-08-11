# The agent mark — Cosmic Orb

The product's AI agent identity. Wherever an agent is thinking, acting, or
waiting to be given a face, this is what represents it.

It is a WebGL sphere — starfield, nebula bands, aurora, pulsar, meteors,
and a chromatic lens — rendered in a single fragment shader. The source is
the Originkit "Cosmic Orb" component, used as delivered apart from the
four changes listed under [Modifications](#modifications).

**Source of truth: [`web/components/orb.tsx`](../web/components/orb.tsx).**
This document explains how to use it and why the modifications exist; it
does not duplicate the ~450 lines of shader. Read the component for that.

---

## Usage

### `AgentMark` — use this almost always

```tsx
import { AgentMark } from "@/components/orb";

<AgentMark size={28} />                        // beside a label
<AgentMark size={64} label="Agent thinking" /> // standing alone
```

`AgentMark` is the right call anywhere the orb sits next to text. It is
`aria-hidden` by default — the adjacent label already names the thing, and
a screen reader announcing "image" twice is noise. Pass `label` **only**
when the orb stands alone with no text beside it; that flips it to
`role="img"` with a real accessible name.

It also avoids a real trap: `Orb`'s default size is **320px**. Dropping a
bare `<Orb />` into a 24px slot renders a 320px canvas that overflows its
container.

### `Orb` — the full component

```tsx
import Orb from "@/components/orb";

<Orb size={320} />
<Orb size={200} archetype="nebula" speed={30} spin={20} />
<Orb
  size={140}
  palette={{ anchor: "#6A3CFF", colorA: "#3CE0FF", colorB: "#A24BFF", colorC: "#FF5EA8" }}
/>
```

| Prop | Default | Notes |
| --- | --- | --- |
| `size` | `320` | Pixels. The orb is always square. |
| `archetype` | `"auto"` | `spiral` · `nebula` · `core` · `deep`. `auto` derives one from the phase constant, so it is stable across renders rather than random. |
| `background` | `"#000000"` | Behind the sphere, inside the circle. |
| `palette` | brand green | `{ anchor, colorA, colorB, colorC }`. |
| `speed` | `50` | `50` is 1×; the value is divided by 50. |
| `spin` | `50` | Same scale. |
| `lens` | `true` | Chromatic edge refraction. |
| `lensAmount` | `45` | 0–100, scaled to a 0–0.2 shader value. |

The shipped preset is the brand palette — greens against black
(`#3CFF8C` anchor, `#3CFF48` / `#D3FF4B` / `#5EFF60`). Passing `palette`
overrides it wholesale; there is no partial merge.

---

## Where it is used

| Surface | Why |
| --- | --- |
| `settings/personas` | A persona with no locked visual reference. The orb is the "not yet given a face" state, which is exactly what it depicts. |
| Agent-authored provenance | Marks output an agent produced rather than a human. |
| Long-running agent work | The waiting state for pipelines, ad runs, and design plans. |

Reach for it when an **agent** is the subject. It is not a generic
spinner, and it is not decoration — using it for ordinary loading would
dilute the one thing it means.

---

## Modifications

Four changes to the delivered source, each marked `ADDED` inline.

### 1. `prefers-reduced-motion`

The orb animates continuously. A viewer who has asked their OS for less
motion now gets a **single rendered frame** instead of a `requestAnimationFrame`
loop — the mark still reads, without the thing the setting exists to
prevent. It also listens for changes, so toggling the OS setting takes
effect without a reload.

### 2. A live-context budget

Browsers cap simultaneous WebGL contexts (commonly ~16) and **silently
evict the oldest** past the limit. Without a budget, a list of twenty
agent rows would blank out the orbs at the top of the page with no error
and nothing in the console.

`MAX_LIVE_CONTEXTS = 6` leaves headroom for the app's charts, which want
contexts too. Past the budget, later orbs render a CSS-gradient standin in
the same silhouette and palette.

### 3. Explicit context release

The cleanup calls `WEBGL_lose_context`. Dropping the canvas alone leaves
the context alive until the GC gets to it, so navigating between routes
would drain the budget and later orbs would silently fall back.

### 4. A fallback instead of a hole

No WebGL, over budget, or a permanently lost context now renders the
gradient standin rather than an empty circle.

---

## Cost

One orb is one WebGL context and one full-screen fragment shader per
frame. The shader is not cheap — it evaluates a three-octave starfield,
dual-layer refraction, and a three-tap chromatic lens per pixel — so it
is bounded in two ways already: `MAX_DPR = 2` and `MAX_PX = 1280` cap the
backing store, and the shader itself fades detail below ~200px so a small
orb does less work than a large one.

Practical guidance: **a few orbs per page, not dozens.** For a dense list,
use `AgentMark` at a small size, or one orb in the header rather than one
per row.

---

## Provenance

Originkit "Cosmic Orb", obtained as component source. The shader body,
uniform set, and animation model are unmodified; the React wrapper carries
the four changes above. If you re-pull the component from Originkit,
re-apply them — every one is a real bug in a production app, not a
preference.
