<!--
  GENERATED FILE - DO NOT EDIT BY HAND.
  Source: packages/react/src/generative/library.tsx (defaultLibrary, generativeUISystemPrompt()).
  Regenerate: pnpm --filter @agent-starter/react gen:components
  packages/react/test/components-md.test.ts fails when this file is out of date.
-->

# OpenUI components: the contract

This is the exact component library that `AgentChat`, `ChatWidget` and `AgentSidebar` render (library id `agent-starter-default`, root component `Stack`).
Only these 12 components exist: `Stack`, `Card`, `Row`, `Text`, `Stat`, `Table`, `List`, `Button`, `Callout`, `ProgressBar`, `KeyValue`, `BarChart`.
Any other component name, a prop that is not listed, or an enum value that is not listed fails to parse, and the chat shows your raw text instead of UI.

## Syntax in one minute

1. In chat, wrap the program in a fenced block whose info string is `openui-lang`. Text outside the fence is shown as normal chat text.
2. One statement per line: `identifier = Expression`. The first line must be `root = Stack([...])`.
3. Arguments are positional, in the order of the props tables below. Named arguments (`title: "x"`) are not supported.
4. Optional (`?`) arguments may be omitted from the end. To skip an optional argument in the middle, pass `null`.
5. Values: strings in double quotes (backslash escapes), numbers, `true` / `false`, `null`, arrays `[...]`, objects `{key: value}`, component calls, or references to identifiers defined on other lines.
6. Every identifier except `root` must be reachable from `root`, or it is silently dropped.
7. `ActionExpression` props take one step (`@ToAssistant("message", context?)` or `@OpenUrl("https://...")`) or several in `Action([...])`. A `Button` without an action sends its label to the assistant.
8. Only render values you got from tools or the conversation. Never invent data.

## Components

### Layout

#### `Stack`

Root layout: blocks stacked vertically (or in a row).

```text
Stack(children: (Card | Row | Text | Stat | Table | List | Button | Callout | ProgressBar | KeyValue | BarChart)[], direction?: "column" | "row")
```

| # | Prop | Type | Required | Description |
|---|------|------|----------|-------------|
| 1 | `children` | `(Card \| Row \| Text \| Stat \| Table \| List \| Button \| Callout \| ProgressBar \| KeyValue \| BarChart)[]` | yes | Top-level blocks |
| 2 | `direction` | `"column" \| "row"` | no | Layout direction; default column |

Example:

```openui-lang
root = Stack([lead, kpis], "column")
lead = Text("Here is this week at a glance.")
kpis = Row([open, solved])
open = Stat("Open tickets", 42)
solved = Stat("Solved", 118, "+9%", "up")
```

#### `Card`

A titled panel grouping related content.

```text
Card(title: string, children: (Text | Stat | Table | List | Button | Callout | ProgressBar | KeyValue | BarChart | Row)[], subtitle?: string)
```

| # | Prop | Type | Required | Description |
|---|------|------|----------|-------------|
| 1 | `title` | `string` | yes | Card heading |
| 2 | `children` | `(Text \| Stat \| Table \| List \| Button \| Callout \| ProgressBar \| KeyValue \| BarChart \| Row)[]` | yes | Card body |
| 3 | `subtitle` | `string` | no | Secondary heading text |

Example:

```openui-lang
root = Stack([card])
card = Card("Acme Corp", [facts, next], "Enterprise plan")
facts = KeyValue([{key: "Owner", value: "Ada"}, {key: "Renewal", value: "2026-03-01"}])
next = Button("Draft renewal email", @ToAssistant("Draft a renewal email for Acme Corp"))
```

#### `Row`

Horizontal group, e.g. several Stats or Buttons.

```text
Row(children: (Text | Stat | Table | List | Button | Callout | ProgressBar | KeyValue | BarChart)[])
```

| # | Prop | Type | Required | Description |
|---|------|------|----------|-------------|
| 1 | `children` | `(Text \| Stat \| Table \| List \| Button \| Callout \| ProgressBar \| KeyValue \| BarChart)[]` | yes | Items laid out side by side (wraps on narrow screens) |

Example:

```openui-lang
root = Stack([row])
row = Row([mrr, seats])
mrr = Stat("MRR", "$12.0k")
seats = Stat("Seats", 40, "+4", "up", "since last month")
```

### Content

#### `Text`

A paragraph of prose.

```text
Text(content: string, tone?: "default" | "muted" | "strong")
```

| # | Prop | Type | Required | Description |
|---|------|------|----------|-------------|
| 1 | `content` | `string` | yes | Paragraph text |
| 2 | `tone` | `"default" \| "muted" \| "strong"` | no | Emphasis |

Example:

```openui-lang
root = Stack([t])
t = Text("Your export finished; 3 rows were skipped.", "muted")
```

#### `List`

A bulleted or numbered list of short items.

```text
List(items: string[], ordered?: boolean, title?: string)
```

| # | Prop | Type | Required | Description |
|---|------|------|----------|-------------|
| 1 | `items` | `string[]` | yes | List items |
| 2 | `ordered` | `boolean` | no | Numbered list when true |
| 3 | `title` | `string` | no | Heading above the list |

Example:

```openui-lang
root = Stack([steps])
steps = List(["Verify the domain", "Invite teammates", "Connect billing"], true, "Next steps")
```

#### `KeyValue`

Labelled fields of one record (status, owner, dates).

```text
KeyValue(items: {key: string, value: string | number | boolean | any}[], title?: string)
```

| # | Prop | Type | Required | Description |
|---|------|------|----------|-------------|
| 1 | `items` | `{key: string, value: string \| number \| boolean \| any}[]` | yes | Label/value pairs |
| 2 | `title` | `string` | no | Heading |

Example:

```openui-lang
root = Stack([kv])
kv = KeyValue([{key: "Status", value: "Active"}, {key: "Seats", value: 40}, {key: "SSO", value: true}], "Workspace")
```

#### `Callout`

A highlighted notice: info, success, warning or error.

```text
Callout(title: string, body?: string, tone?: "info" | "success" | "warning" | "error")
```

| # | Prop | Type | Required | Description |
|---|------|------|----------|-------------|
| 1 | `title` | `string` | yes | Headline |
| 2 | `body` | `string` | no | Supporting text |
| 3 | `tone` | `"info" \| "success" \| "warning" \| "error"` | no | Severity |

Example:

```openui-lang
root = Stack([c])
c = Callout("Payment failed", "The card on file was declined. Ask the customer to update it.", "error")
```

### Data

#### `Stat`

A single headline metric with optional change indicator.

```text
Stat(label: string, value: string | number, delta?: string, trend?: "up" | "down" | "neutral", caption?: string)
```

| # | Prop | Type | Required | Description |
|---|------|------|----------|-------------|
| 1 | `label` | `string` | yes | Metric name |
| 2 | `value` | `string \| number` | yes | Metric value, formatted or raw number |
| 3 | `delta` | `string` | no | Change vs. previous period, e.g. "+12%" |
| 4 | `trend` | `"up" \| "down" \| "neutral"` | no | Direction of the change |
| 5 | `caption` | `string` | no | Short footnote |

Example:

```openui-lang
root = Stack([s])
s = Stat("Churn", "2.1%", "-0.3 pts", "down", "trailing 30 days")
```

#### `Table`

Tabular data for comparisons and records.

```text
Table(columns: string[], rows: (string | number | boolean | any)[][], caption?: string)
```

| # | Prop | Type | Required | Description |
|---|------|------|----------|-------------|
| 1 | `columns` | `string[]` | yes | Column headers |
| 2 | `rows` | `(string \| number \| boolean \| any)[][]` | yes | Rows of cell values, one value per column |
| 3 | `caption` | `string` | no | Table caption |

Example:

```openui-lang
root = Stack([t])
t = Table(["Invoice", "Amount", "Paid"], [["INV-101", 1200, true], ["INV-102", 640, false], ["INV-103", 90, null]], "Open invoices")
```

#### `BarChart`

A simple bar chart comparing a few categories.

```text
BarChart(labels: string[], values: number[], title?: string, unit?: string)
```

| # | Prop | Type | Required | Description |
|---|------|------|----------|-------------|
| 1 | `labels` | `string[]` | yes | Category labels |
| 2 | `values` | `number[]` | yes | One non-negative value per label |
| 3 | `title` | `string` | no | Chart title |
| 4 | `unit` | `string` | no | Unit suffix, e.g. "%" or " ms" |

Example:

```openui-lang
root = Stack([chart])
chart = BarChart(["Mon", "Tue", "Wed"], [12, 30, 18], "Tickets per day", null)
```

#### `ProgressBar`

Progress toward a goal or a quota usage meter.

```text
ProgressBar(label: string, value: number, max?: number, tone?: "default" | "success" | "warning" | "error")
```

| # | Prop | Type | Required | Description |
|---|------|------|----------|-------------|
| 1 | `label` | `string` | yes | What is progressing |
| 2 | `value` | `number` | yes | Current amount |
| 3 | `max` | `number` | no | Total amount; default 100 |
| 4 | `tone` | `"default" \| "success" \| "warning" \| "error"` | no | Color |

Example:

```openui-lang
root = Stack([p])
p = ProgressBar("API quota", 7400, 10000, "warning")
```

### Actions

#### `Button`

A clickable action: ask the assistant something or open a link.

```text
Button(label: string, action?: ActionExpression, variant?: "primary" | "secondary" | "danger")
```

| # | Prop | Type | Required | Description |
|---|------|------|----------|-------------|
| 1 | `label` | `string` | yes | Button text |
| 2 | `action` | `ActionExpression` | no | What the click does; defaults to sending the label to the assistant |
| 3 | `variant` | `"primary" \| "secondary" \| "danger"` | no | Visual weight |

Example:

```openui-lang
root = Stack([actions])
actions = Row([details, docs, both])
details = Button("Show details", @ToAssistant("Show details", {orderId: 42}), "primary")
docs = Button("Open docs", @OpenUrl("https://example.com/docs"))
both = Button("Read and summarize", Action([@OpenUrl("https://example.com/changelog"), @ToAssistant("Summarize the changelog")]))
```

## Full example

A short lead-in sentence, then one focused block:

Here is the account summary you asked for.

```openui-lang
root = Stack([summary, accounts])
summary = Row([revenue, churn])
revenue = Stat("Revenue", "$48.2k", "+12% MoM", "up")
churn = Stat("Churn", "2.1%", "-0.3 pts", "down")
accounts = Card("Top accounts", [table, draft])
table = Table(["Account", "Plan", "MRR"], [["Acme", "Enterprise", 12000], ["Globex", "Team", 4200]])
draft = Button("Draft renewal emails", @ToAssistant("Draft renewal emails for the top accounts"))
```

## Appendix: the exact system prompt

Verbatim output of `generativeUISystemPrompt()` from `@agent-starter/react` (inline mode, default library). It is the authoritative wording of the rules summarized above.

````text
You are an assistant embedded in a product UI. Answer in concise plain text (light markdown is fine). When structured output would help the user — metrics, comparisons, records, progress, or choices they can click — also render generative UI written in openui-lang, the declarative UI language described below.

## Syntax Rules

1. Each statement is on its own line: `identifier = Expression`
2. `root` is the entry point — every program must define `root = Stack(...)`
3. Expressions are: strings ("..."), numbers, booleans (true/false), null, arrays ([...]), objects ({...}), or component calls TypeName(arg1, arg2, ...)
4. Use references for readability: define `name = ...` on one line, then use `name` later
5. EVERY variable (except root) MUST be referenced by at least one other variable. Unreferenced variables are silently dropped and will NOT render. Always include defined variables in their parent's children/items array.
6. Arguments are POSITIONAL (order matters, not names). Write `SomeComp([children], "row", "l")` NOT `SomeComp([children], direction: "row", gap: "l")` — colon syntax is NOT supported and silently breaks
7. Optional arguments can be omitted from the end
- Strings use double quotes with backslash escaping

## Component Signatures

Arguments marked with ? are optional. Sub-components can be inline or referenced; prefer references for better streaming.
Props typed `ActionExpression` accept one @step, or Action([@steps...]) for several. See the Action section for available steps (@ToAssistant, @OpenUrl).

### Layout
Stack(children: (Card | Row | Text | Stat | Table | List | Button | Callout | ProgressBar | KeyValue | BarChart)[], direction?: "column" | "row") — Root layout: blocks stacked vertically (or in a row).
Card(title: string, children: (Text | Stat | Table | List | Button | Callout | ProgressBar | KeyValue | BarChart | Row)[], subtitle?: string) — A titled panel grouping related content.
Row(children: (Text | Stat | Table | List | Button | Callout | ProgressBar | KeyValue | BarChart)[]) — Horizontal group, e.g. several Stats or Buttons.

### Content
Text(content: string, tone?: "default" | "muted" | "strong") — A paragraph of prose.
List(items: string[], ordered?: boolean, title?: string) — A bulleted or numbered list of short items.
KeyValue(items: {key: string, value: string | number | boolean | any}[], title?: string) — Labelled fields of one record (status, owner, dates).
Callout(title: string, body?: string, tone?: "info" | "success" | "warning" | "error") — A highlighted notice: info, success, warning or error.

### Data
Stat(label: string, value: string | number, delta?: string, trend?: "up" | "down" | "neutral", caption?: string) — A single headline metric with optional change indicator.
Table(columns: string[], rows: (string | number | boolean | any)[][], caption?: string) — Tabular data for comparisons and records.
BarChart(labels: string[], values: number[], title?: string, unit?: string) — A simple bar chart comparing a few categories.
ProgressBar(label: string, value: number, max?: number, tone?: "default" | "success" | "warning" | "error") — Progress toward a goal or a quota usage meter.

### Actions
Button(label: string, action?: ActionExpression, variant?: "primary" | "secondary" | "danger") — A clickable action: ask the assistant something or open a link.

## Action — Button Behavior

An action wires a button click to operations. Pass one @-prefixed step bare, e.g. Button("Ask", @ToAssistant("Tell me more")). Put several steps in Action([...]), e.g. Button("Read", Action([@OpenUrl("https://example.com"), @ToAssistant("Summarize this page")])). Steps execute in order.
Buttons without an action automatically send their label to the assistant (equivalent to @ToAssistant(label)).

Available steps:
- @ToAssistant(message: string, context?: any) — Send a message to the assistant (for conversational buttons like "Tell me more", "Explain this"). The optional context is any value (object, array, string, number) passed to the assistant as hidden data, e.g. @ToAssistant("Show details", {orderId: 42})
- @OpenUrl(url: string) — Navigate to a URL

Example — simple nav:
```
viewBtn = Button("View", @OpenUrl("https://example.com"))
```

- An action can be assigned to a variable or inlined: Button("Go", onSubmit) and Button("Go", Action([...])) both work

## Hoisting & Streaming (CRITICAL)

openui-lang supports hoisting: a reference can be used BEFORE it is defined. The parser resolves all references after the full input is parsed.

During streaming, the output is re-parsed on every chunk. Undefined references are temporarily unresolved and appear once their definitions stream in. This creates a progressive top-down reveal — structure first, then data fills in.

**Recommended statement order for optimal streaming:**
1. `root = Stack(...)` — UI shell appears immediately
2. Component definitions — fill in as they stream
3. Data values — leaf content last

Always write the root = Stack(...) statement first so the UI shell appears immediately, even before child data has streamed in.

## Examples

```openui-lang
root = Stack([summary, accounts])
summary = Row([revenue, churn])
revenue = Stat("Revenue", "$48.2k", "+12% MoM", "up")
churn = Stat("Churn", "2.1%", "-0.3 pts", "down")
accounts = Card("Top accounts", [table, draft])
table = Table(["Account", "Plan", "MRR"], [["Acme", "Enterprise", 12000], ["Globex", "Team", 4200]])
draft = Button("Draft renewal emails", @ToAssistant("Draft renewal emails for the top accounts"))
```


## Inline Mode

You are in inline mode. You can respond in two ways:

### 1. Code response (when the user wants to CREATE or CHANGE the UI)
Wrap openui-lang code in triple-backtick fences. You can include explanatory text before/after:

Here's your dashboard:

```openui-lang
root = RootComp([header, content])
header = SomeHeader("Title")
content = SomeContent("Hello world")
```

I created a simple layout with a header.

### 2. Text-only response (when the user asks a QUESTION)
If the user asks "what is this?", "explain the chart", "how does this work", etc. — respond with plain text. Do NOT output any openui-lang code. The existing dashboard stays unchanged.

### Rules
- When the user asks for changes, output ONLY the changed/new statements in a fenced block
- When the user asks a question, respond with text only — NO code. The dashboard stays unchanged.
- The parser extracts code from fences automatically. Text outside fences is shown as chat.
## Important Rules
- Choose components that best represent the content (tables for comparisons, charts for trends, forms for input, etc.)

## Final Verification
Before finishing, walk your output and verify:
1. root = Stack(...) is the FIRST line (for optimal streaming).
2. Every referenced name is defined. Every defined name (other than root) is reachable from root.

- Prefer a short sentence of text plus one focused UI block over large dashboards.
- Use Table for more than three records, Stat for headline numbers, KeyValue for a single record's fields.
- Never invent data: only render values you obtained from tools or the conversation.
````
