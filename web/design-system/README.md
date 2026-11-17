# Marketer design system

This is the only design system the app uses. Everything visual in
`app/(app)`, `app/(onboarding)` and `components/{shell,chat,home,…}` comes
from here:

```ts
import { Button, PageHeader, Column, KpiCard, Composer } from "@/design-system";
```

The marketing site (`app/(marketing)`, `marketing/`) has its own look and is
out of scope.

**The reference screens in [`references/`](./references) are the target.**
If a screen and the code disagree, the code is wrong. Podium
(`mosnin/podium`) supplied the component engineering: shader, motion and
press feedback. The look comes from the references.

`npm run ds:guard` enforces the mechanical rules below. It runs in CI, so a
page that breaks them fails the build.

---

## 1. The references and what each one defines

| File | Defines | Used by |
|---|---|---|
| `01-home-composer-bento.jpg` | A shader backdrop, a centered brand name, one large composer, and a glass bento of small cards underneath | `/home` |
| `02-chat-agent-panel-plan.jpg` | The chat layout: a breadcrumb header, user bubble, assistant header, "Worked for…", sources, a **plan card** (Dismiss / Edit / Approve & Run), "Agent is working" chips, a composer with an "Orchestrator · Routes each request" strip, and a **right agent panel** (trace). Also the sidebar: Home / Activity segmented, Tools with coloured icons, Chat recents | `/sessions/*`, sidebar |
| `03-marketplace.jpg` | Collection with a hero banner (gradient + prompt pills), then app rows: logo, name, one line, a Connect button | `/integrations` |
| `04-plan-choice.jpg` | Choice cards: a gradient header, title, price, features, CTA | Billing in `/settings`, plan pickers |
| `05-analytics-dashboard.jpg` | The dashboard: a 48px header, filter pills, KPI cards with mini bars, a line chart card, a breakdown list, a bar list, an "Ask" pill. Also the sidebar's **Awaiting action** box and **Getting started n of 5** | `/analytics`, Paid and Distribution summaries |
| `06-chat-question-card.jpg` | The agent asks a question: numbered options, "Something else", "↑↓ to navigate · Enter to select" | Agent questions in chat and in Activity |
| `07-collection-page.jpg` | A centered column: 22px title, one muted line, a segmented control, sections of bordered cards | Tools, Deliverables, Activity, Brand, Settings |

Open the image before you build or change a screen that uses it.

## 2. Principles

1. **One window.** A sidebar and a main area separated by one hairline, with nothing floating. Panels inside main, like the right agent panel, are also separated by hairlines.
2. **Dark first.** Dark is the default (`.ds`). Light (`.ds.ds-light`) is the same design with the values inverted. The app sets the theme itself through the `marketer-theme` cookie, never with Tailwind `dark:`.
3. **Near monochrome.** Gray on gray. Colour appears only where it means something:
   - blue `ds-accent`: links, chart lines, focus, "New"
   - green `positive`: up, connected, done
   - red `negative`: down, failed, destructive
   - orange `attention`: waiting on you
   - red `count`: count badges
   - the six tool gradients, one per tool and the same everywhere
4. **Small and dense.** Base text is 13px, rows are 28px, buttons are 28px rounded rectangles (6px corners), and page headers are 48px. Titles are medium weight, never bold.
5. **Conversation first.** Every page has a way to ask the agent about what you're looking at: a scoped composer, an `AskPill`, or "Ask about this". Data pages show the data. They don't explain the feature.
6. **Nothing decorative moves.** No pulsing dots, glowing borders, bouncing badges or gradient text. Motion is limited to press feedback (`ds-press`), enter (`ds-enter`), popovers (`ds-pop`), the chat shimmer on "Agent is working", and the home shader.

## 3. Tokens (`tokens.css`)

Use these only through Tailwind utilities.

| Utility | Meaning | Dark | Light |
|---|---|---|---|
| `bg-ds-bg` | main area | #171717 | #ffffff |
| `bg-ds-sidebar` | sidebar | #1a1a1a | #f9f9f8 |
| `bg-surface` | cards, composer | 11% | white |
| `bg-surface-2` | inputs, pills, hover | 13% | 97% |
| `bg-surface-3` | current row, chips, segmented thumb | 16% | 94% |
| `bg-overlay` | menus, popovers, right panel | 12.5% | white |
| `border-hairline` / `-strong` | every border and divider | 16.5% / 22% | 91% / 85% |
| `text-fg` / `-fg-muted` / `-fg-faint` | text | 93 / 64 / 45% | 9 / 42 / 58% |
| `bg-ds-primary` + `text-ds-primary-fg` | the white (light: black) primary button | | |
| `text-ds-accent`, `text-positive`, `text-negative`, `text-attention`, `bg-count` | meaning only | | |
| `rounded-ds-xs/sm/md/lg/xl` | 4 / 6 / 8 / 12 / 16 px | | |
| `shadow-ds-float` / `shadow-ds-modal` | menus / dialogs only | | |

Radii by role:
- **xs**: tags, inline code
- **sm**: buttons, rows, menu items
- **md**: inputs, small cards, filter boxes
- **lg**: cards, lists, tables
- **xl**: composer, dialogs, hero banners
- **full**: avatars, chips, send button, count badges

Type sizes in use:

| Size | Use |
|---|---|
| 12px | labels, meta |
| 13px | body, rows, buttons |
| 13.5px | chat text, header crumbs |
| 14px | header title, section titles |
| 15px | hero composer |
| 22px | Column title |
| 26–28px | KPI values |
| 30px | home brand |

## 4. Components

All of these live in `components/` and are exported from `index.ts`.

### Layout (`layout.tsx`)

| Component | Reference | Notes |
|---|---|---|
| `WorkspaceRow` | 05, 07 | Logo, name and chevrons, with actions |
| `SidebarRow` | 05 | 28px; current row is `surface-3` |
| `SidebarSection` | 05 | 12px faint title |
| `SidebarAttention` | 05 | Bordered "Awaiting action" box with static bullets, max 3, plus Show more |
| `SidebarTextRow` | 02 | Chat recents |
| `SidebarProgress` | 05 | "Getting started 3 of 5" |
| `PageHeader` | 05, 02 | 48px; `title` or `crumbs`, plus `actions` |
| `Toolbar` | 05 | Filter pills left, actions right |
| `Canvas` | 05 | Dashboard body: 16px gutters, cards in grids |
| `Column` | 07 | Centered column: title, description, control, then sections. `width` is sm 560, md 720 or lg 960 |
| `Section` | 07 | Section title with an optional action |
| `Card`, `List`/`ListRow`, `EmptyLine` | 05, 07 | Bordered surfaces. An empty state is one quiet line, never an illustration |

### Primitives (`primitives.tsx`)

| Component | Reference | Notes |
|---|---|---|
| `Button`/`ButtonLink` | 02, 05 | Variants: primary (white), secondary, ghost, danger, accent. Sizes: sm 24, md 28, lg 36 |
| `IconButton` | | Always labelled |
| `CountBadge` | 02 | Red count |
| `NewBadge` | 03 | Blue "New" |
| `StatusBadge` | | Tones: neutral, positive, negative, attention, accent |
| `Delta` | 05 | Signed % with arrow, green or red |
| `Kbd`, `NumberKey` | | |
| `ToolIcon` | 02, 05 | Tool gradients a–f. Use `TOOL_ICON` in `components/shell/sidebar.tsx`, the one mapping |
| `IconTile`, `AgentGlyph`, `PersonAvatar`, `WorkspaceLogo` | | |
| `ProgressRing`, `StepMark`, `Bullet` | | Bullets are static, never animated |
| `Segmented` | 02, 07 | Home / Activity, tabs inside a page |
| `FilterPill` | 05 | "Last 30 days ▾" |
| `Menu`, `MenuItem`, `MenuButton` | | |
| `Input`, `Textarea`, `Select`, `Field`, `Switch` | | |
| `Modal` | | Native `<dialog>` with a footer slot |

### Kit (`kit.tsx`)

| Component | Notes |
|---|---|
| `Chip` | Selectable pill (ref 03 prompts) |
| `Notice` | One line: ok or error |
| `Callout` | One important sentence |
| `CopyButton`, `CodeBlock`, `SecretOnce` | |
| `MoneyInput`, `TagInput`, `Meter`, `ConfirmModal` | |
| `Table` | Rows, with a header in 12px faint text; numbers right-aligned and tabular |
| `Thumb` | Media thumbnail |
| `Skeleton`, `Facts` | Key/value rows for detail pages |

### Data (`data.tsx`)

| Component | Reference | Notes |
|---|---|---|
| `KpiCard` | 05 | Label, 26px value, `Delta`, `MiniBars` |
| `ChartCard` + `LineChart` | 05 | Current is a solid accent line, compare is dashed. Gridlines, hover tooltip |
| `BreakdownList` | 05 | Label, value, share |
| `BarList` | 05 | Rows with a filled bar behind the label |
| `Sparkline`, `Heatmap`, `StatBlock`, `DataLabel` | | |

### Agent (`agent.tsx`)

| Component | Reference | Notes |
|---|---|---|
| `Composer` | 01, 02 | Header strip: agent glyph, name and "Routes each request". Then the textarea, "+", and a round send button. `size="hero"` on Home |
| `UserBubble`, `AssistantHeader`, `WorkedFor`, `SourceChips` | 02 | |
| `AgentChips` | 02 | "Agent is working" |
| `Trace` | 02 | Right panel steps |
| `PlanCard` | 02 | Steps, with Dismiss / Edit / Approve & Run. Use it for **every** approval: chat plans, inbox items, scheduled posts, ad changes |
| `QuestionCard` | 06 | |
| `AskPill` | 05 | |
| `Markdown` | | Agent text |

### Surfaces (`surfaces.tsx`)

| Component | Reference | Notes |
|---|---|---|
| `Backdrop` + `Shader` | 01 | Home only, plus first-run moments |
| `GlassCard` | 01 | Bento cards over the shader |
| `HeroBanner` | 03 | Gradient banner with prompt pills |
| `AppRow` | 03 | |
| `CollectionCard` | 07 | |
| `PlanOption` | 04 | |

## 5. Page templates: every route, one template

The product is one marketing department you talk to. Pages are views of its
work. They are not separate apps.

| Route | Template | What's on it |
|---|---|---|
| `/home` | **Home** (01) | Brand, hero composer, bento: activity heatmap, recent sessions, waiting count, what shipped, this month |
| `/sessions/new`, `/sessions/[id]` | **Chat** (02, 06) | Breadcrumb header. A 720px chat column with the composer pinned to the bottom. Right agent panel, 320px and toggleable: agents, trace, sources. Approvals render as `PlanCard`, questions as `QuestionCard` |
| `/analytics` | **Dashboard** (05) | Toolbar of `FilterPill`s (range, channel, compare). A KPI row. A line `ChartCard`. A breakdown and a bar list. "Ask about this data" `AskPill` |
| `/activity`, `/inbox` | **Column** (07) | Segmented control: "Needs you n" / "Everything". "Needs you" shows `PlanCard`s (approve, edit, dismiss). "Everything" is a day-grouped list of what agents did |
| `/plan` | **Dashboard** (05) | Toolbar: Week / Month segmented control, channel `FilterPill`. A calendar grid of scheduled items in a `Card`. "Ask to fill the gaps" `AskPill` |
| `/library` (Deliverables) | **Column lg** (07) | Segmented control: All / Videos / Articles / Ads / Posts. A grid of `Thumb` cards |
| `/playbooks`, `/content`, `/seo`, `/paid`, `/distribution` (Tools) | **Tool**: Column lg (07) | `ToolIcon` + 22px title + one line. A scoped `StartSession` ("Ask the Content agent…"). For Paid and Distribution, a KPI row (05). Then sections of the tool's work as `List`/`Table`/`CollectionCard` |
| Tool detail (`/seo/[id]`, `/paid/campaigns/[id]`, …) | **Detail** | `PageHeader` crumbs (Tool / Item) with actions, then a Column with `Facts`, the content and an `AskPill` |
| `/integrations` | **Marketplace** (03) | `HeroBanner` ("Connect where you publish"), then grouped `AppRow`s. Agent access and webhooks are sections below |
| `/brand` | **Column md** (07) | Sections: voice, audience, visual kit. Forms use `Field` |
| `/settings` | **Column md** (07) | Segmented control: General / Billing / Team. Billing uses `PlanOption` (04) |
| `/admin` | **Dashboard** (05) | `Table`s |
| `/onboarding` | Intent-driven onboarding (`.intent-onboarding/DESIGN.md`) built from these tokens and components | |

## 6. Rules (enforced by `npm run ds:guard`)

In `app/(app)`, `app/(onboarding)`, `components/{shell,chat,home,app}` and `design-system`:

- **No hard colours.**
  - No hex, `rgb(` or `hsl(` literals in class names.
  - No `bg-white`, `bg-black`, `text-white` or `text-black`.
  - No old tokens (`bg-muted`, `text-muted-foreground`, `bg-card`, `border-border`, `bg-subtle`, `text-foreground`, `bg-background`).
  - Raw colour is allowed only inside `tokens.css` and `shader.tsx`.
- **No `dark:` variants.** The theme comes from tokens.
- **No off-system corners.** Use only `rounded-ds-*`, `rounded-full` or `rounded-none`. No `rounded-lg`, `rounded-[14px]` and similar.
- **No animated status decoration.**
  - No `animate-pulse`, `animate-ping` or `animate-bounce`.
  - No "live dot" components.
  - Bullets are static.
- **No old kits.** Nothing under `components/mk`, `components/ui`, `components/square` or `components/podium` is imported from app routes. Everything comes from `@/design-system`.
- **No illustrations in empty states.** Use `EmptyLine`.

If you need something the system doesn't have, add it here (component +
README row + reference), then use it. Never fork a one-off copy in a page.

## 7. Checking a screen

1. Open the matching reference next to the screen.
2. Check the screen in dark and light (`?theme=light` on `/preview/app/...`), at 1280px and 390px.
3. Run `npm run ds:guard`, `npx tsc --noEmit` and `npm run build`.
