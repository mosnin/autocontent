# DESIGN.md (the app)

How Marketer's app looks, moves and feels. It carries Podium's design DNA
(`mosnin/podium` DESIGN.md) into a marketing product. The code is the source
of truth: tokens in `app/globals.css` (the `.mk-app` block), primitives in
`components/mk/`. If this file and the code disagree, fix one of them in the
same change. The marketing site (`app/(marketing)`) keeps its own look.

## The idea

Marketer is a marketing department you talk to. The interface is a quiet,
well-lit room: near-monochrome, precise, calm. Colour appears only where
something is alive:

- something is live or done (`floor` green), needs you (`queued` orange dot),
  or is new (`accent` blue dot)
- an agent is present: every department's agent owns a colour field
  (`lib/departments.ts` → `palette`), the same on every avatar, chip and card
- first visits, banners and openings (gradient shader light)
- Home greets you on light that follows the time of day

Everything else is neutral gray on white, or gray on near-black.

## Consistency is a requirement

- **Reuse the primitive, don't restyle by hand.** Buttons are `Button` /
  `ButtonLink`, icon tiles `IconTile`, agents `AgentAvatar`, people
  `PersonAvatar`, nested sections `Panel`, headers `PageHeader` + `PageIntro`,
  section labels `SectionTitle`, lists `List` + `Row`, cards `Card` /
  `TitledCard`, KPIs `Stat` + `Sparkbars` + `Delta`, empties `Empty` /
  `EmptyNote` / `EmptyState`, choices `Chip` / `Segmented` / `Switch`,
  forms `Field` + `Input` / `Textarea` / `Select`, dialogs `Modal`.
  If a primitive can't do it, extend the primitive.
- **Tokens only on neutral surfaces**: `bg-card`, `bg-muted`, `bg-subtle`,
  `bg-canvas`, `text-muted-foreground`, `text-faint`, `border-border`. Never
  `bg-white`, `bg-black`, `text-zinc-*`, hex or the old `cat-*`/`brand`
  tokens on chrome, cards or text. Raw colour belongs only on media, shaders
  and scrims.
- **Corners**: 8px (rows, small controls, tiles: `rounded-lg`), 14px (inputs,
  list groups, panels: `rounded-[14px]`), 20px (cards, dialogs, banners:
  `rounded-[20px]`), full (pills, avatars, dots). Nothing else.
- **Type**: Inter. Headings are medium (500), never bold. Page intro 26px,
  card titles 15px, body 14–15px, section labels 13px `muted-foreground`,
  meta 12–13px. `tabular` on every number that counts or updates; Geist Mono
  (`font-mono`) for ids, keys and model names.
- **Check both themes** at desktop (1440) and phone (390) before calling a
  screen done. No horizontal scroll on phones (`min-w-0` on grid children).

## Page anatomy

Every page under `app/(app)` is:

```tsx
<PageHeader icon={<Icon />} title="Content">{actions}</PageHeader>
<PageBody width="5xl">
  <PageIntro title="…" action={…}>One sentence about this place.</PageIntro>
  …sections with SectionTitle, List/Row, TitledCard, Panel…
</PageBody>
```

- Pages are a thin async server component that fetches (with
  `lib/workspace-server.ts` `safe()` or `lib/api.ts`) and renders a pure
  **view component** in `components/mk/<area>/` that takes data as props.
  Every view gets a fixture entry in `app/preview/app/[[...slug]]/views-*.tsx`
  so it can be screenshotted without auth.
- Fetch failures render an `Empty` with a sentence, never a 500.
- Each department page opens with an **ask entry**: `<StartSession scope="content" lockScope suggestions={dept.asks} />`
  so you can hand the work to the department's agent from where you are.
- Mutations from client components go through `/api/proxy/...` (see
  `components/mk/inbox/inbox-row.tsx`) or existing server actions in
  `lib/actions.ts`, then `router.refresh()`.

## Colour tokens (`.mk-app`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `canvas` | #f5f5f5 | #1c1c1c | The floor panels sit on |
| `background` / `card` | white | #242424 | Panels and cards |
| `subtle` | 98% | 16% | Insets |
| `muted` | #ededed | #292929 | Current row, segmented track, chips |
| `border` / `border-strong` | 92.5% / 84% | 18.5% / 26% | Hairlines |
| `foreground` / `muted-foreground` / `faint` | 6% / 40% / 65% | 94% / 69% / 36% | Text |
| `primary` | near-black | near-white | Primary pill |
| `accent` | blue | blue | Focus, links, selection, unread, checks, the main chart line |
| `floor` | green | green | Live, done, connected |
| `queued` | orange | orange | Needs you |
| `destructive` | red | red | Delete, failed, reject |
| `sky` | sky | sky | Empty-state illustrations only |

Tinted fills are 10–12% (`bg-floor/12`) with full-strength text.

## Components

- **Buttons** are pills. `primary` black (white in dark) for the one main
  action per view; `secondary` white with a hairline shadow; `ghost` for
  quiet actions; `danger` only for destructive confirms. Every button presses
  to 0.97.
- **Dots, not badges** for state in lists: `Dot tone="warn"` needs you,
  `accent` new, `live` running. `Badge` for a word of status on a row.
- **Lists** are rows inside one card divided by hairlines (`List`, `Row`),
  52px min height, an `IconTile` or `AgentAvatar` on the left, title 14px
  medium, a 13px muted second line, actions right.
- **KPI tiles** (`Stat`): 13px label, 22px number, `Delta`, `Sparkbars`.
- **Charts**: one accent line for the current period, a muted line for the
  comparison; hairline grid; tabular axis labels; no legends when one line.
  Use the existing `components/charts` line chart or plain SVG.
- **Shader banners** (`Shader` from `components/mk/shader.tsx`) on Home, the
  agent offline card, onboarding and department openings only. Never in
  tables, lists or settings. Wrap in a sized, `overflow-hidden` rounded box.
- **Empty states**: `Empty art="…"` (isometric sky figures) with one sentence
  and, when the person must act, one primary action. No dashed boxes.
- **Agents**: `AgentAvatar` with the department palette and the asterisk
  badge, so agents are never told apart by colour alone.

## Motion

Tokens: `--ease-out`, `--ease-in-out`, `--ease-drawer`, durations 120 / 150 /
250 / 350 / 500ms. UI motion under 300ms; enter with `t-enter` /
`t-stagger`, popovers `t-pop`, working text `t-shimmer`. Only transform,
opacity and filter animate. Everything collapses under reduced motion.

## Copy

Short, human, specific to the user's data ("3 things need you. Views up 28%
this week."). Sentence case. No "Welcome aboard!", no emoji, no "Step 3 of
7". Agents speak in the first person only when reporting work they did.
Call niches **playbooks**, jobs **videos**, image posts **carousels**.

## Onboarding

Follows `ONBOARDING.md` (from mosnin/onboarding-starter): split frame, one
question per screen, inferred brand, proof before the dashboard.
