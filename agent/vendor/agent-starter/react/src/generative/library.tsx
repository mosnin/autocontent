import { action, createLibrary, defineComponent, useIsStreaming, useTriggerAction } from "@openuidev/react-lang";
import type { ComponentRenderProps, Library, PromptOptions } from "@openuidev/react-lang";
import { useId } from "react";
import { z } from "zod/v4";
import { cx, formatNumber } from "../internal/format.ts";

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type Scalar = z.infer<typeof scalar>;

function displayScalar(value: Scalar | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value;
}

// ---- Leaves ---------------------------------------------------------------

const textProps = z.object({
  content: z.string().describe("Paragraph text"),
  tone: z.enum(["default", "muted", "strong"]).optional().describe("Emphasis"),
});
function TextView({ props }: ComponentRenderProps<z.infer<typeof textProps>>) {
  return <p className={cx("as-gen-text", props.tone && `as-gen-text--${props.tone}`)}>{props.content}</p>;
}
const Text = defineComponent({ name: "Text", description: "A paragraph of prose.", props: textProps, component: TextView });

const statProps = z.object({
  label: z.string().describe("Metric name"),
  value: z.union([z.string(), z.number()]).describe("Metric value, formatted or raw number"),
  delta: z.string().optional().describe('Change vs. previous period, e.g. "+12%"'),
  trend: z.enum(["up", "down", "neutral"]).optional().describe("Direction of the change"),
  caption: z.string().optional().describe("Short footnote"),
});
function StatView({ props }: ComponentRenderProps<z.infer<typeof statProps>>) {
  const trend = props.trend ?? "neutral";
  const arrow = trend === "up" ? "▲" : trend === "down" ? "▼" : "•";
  return (
    <div className="as-gen-stat">
      <div className="as-gen-stat__label">{props.label}</div>
      <div className="as-gen-stat__value">{typeof props.value === "number" ? formatNumber(props.value) : (props.value ?? "—")}</div>
      {props.delta ? (
        <div className={`as-gen-stat__delta as-gen-stat__delta--${trend}`}>
          <span aria-hidden="true">{arrow}</span> {props.delta}
          {trend !== "neutral" ? <span className="as-sr-only">{trend === "up" ? " (increase)" : " (decrease)"}</span> : null}
        </div>
      ) : null}
      {props.caption ? <div className="as-gen-stat__caption">{props.caption}</div> : null}
    </div>
  );
}
const Stat = defineComponent({ name: "Stat", description: "A single headline metric with optional change indicator.", props: statProps, component: StatView });

const tableProps = z.object({
  columns: z.array(z.string()).describe("Column headers"),
  rows: z.array(z.array(scalar)).describe("Rows of cell values, one value per column"),
  caption: z.string().optional().describe("Table caption"),
});
function TableView({ props }: ComponentRenderProps<z.infer<typeof tableProps>>) {
  const columns = props.columns ?? [];
  const rows = props.rows ?? [];
  return (
    <div className="as-gen-table-wrap" role="region" aria-label={props.caption ?? "Table"} tabIndex={0}>
      <table className="as-gen-table">
        {props.caption ? <caption>{props.caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={index} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((_column, cellIndex) => {
                const cell = (row ?? [])[cellIndex];
                return (
                  <td key={cellIndex} className={typeof cell === "number" ? "as-num" : undefined}>
                    {displayScalar(cell)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const Table = defineComponent({ name: "Table", description: "Tabular data for comparisons and records.", props: tableProps, component: TableView });

const listProps = z.object({
  items: z.array(z.string()).describe("List items"),
  ordered: z.boolean().optional().describe("Numbered list when true"),
  title: z.string().optional().describe("Heading above the list"),
});
function ListView({ props }: ComponentRenderProps<z.infer<typeof listProps>>) {
  const titleId = useId();
  const items = (props.items ?? []).map((item, index) => <li key={index}>{item}</li>);
  return (
    <div className="as-gen-list">
      {props.title ? (
        <div className="as-gen-list__title" id={titleId}>
          {props.title}
        </div>
      ) : null}
      {props.ordered ? <ol aria-labelledby={props.title ? titleId : undefined}>{items}</ol> : <ul aria-labelledby={props.title ? titleId : undefined}>{items}</ul>}
    </div>
  );
}
const List = defineComponent({ name: "List", description: "A bulleted or numbered list of short items.", props: listProps, component: ListView });

const buttonProps = z.object({
  label: z.string().describe("Button text"),
  action: action().optional().describe("What the click does; defaults to sending the label to the assistant"),
  variant: z.enum(["primary", "secondary", "danger"]).optional().describe("Visual weight"),
});
function ButtonView({ props }: ComponentRenderProps<z.infer<typeof buttonProps>>) {
  const triggerAction = useTriggerAction();
  const streaming = useIsStreaming();
  return (
    <button
      type="button"
      className={cx("as-btn", `as-btn--${props.variant ?? "secondary"}`)}
      disabled={streaming}
      onClick={() => {
        void triggerAction(props.label, undefined, props.action);
      }}
    >
      {props.label}
    </button>
  );
}
const Button = defineComponent({ name: "Button", description: "A clickable action: ask the assistant something or open a link.", props: buttonProps, component: ButtonView });

const calloutProps = z.object({
  title: z.string().describe("Headline"),
  body: z.string().optional().describe("Supporting text"),
  tone: z.enum(["info", "success", "warning", "error"]).optional().describe("Severity"),
});
const CALLOUT_ICONS = { info: "i", success: "✓", warning: "!", error: "×" } as const;
function CalloutView({ props }: ComponentRenderProps<z.infer<typeof calloutProps>>) {
  const tone = props.tone ?? "info";
  return (
    <div className={`as-callout as-callout--${tone}`} role="note">
      <span className="as-callout__icon" aria-hidden="true">
        {CALLOUT_ICONS[tone]}
      </span>
      <div>
        <div className="as-callout__title">{props.title}</div>
        {props.body ? <div className="as-callout__body">{props.body}</div> : null}
      </div>
    </div>
  );
}
const Callout = defineComponent({ name: "Callout", description: "A highlighted notice: info, success, warning or error.", props: calloutProps, component: CalloutView });

const progressProps = z.object({
  label: z.string().describe("What is progressing"),
  value: z.number().describe("Current amount"),
  max: z.number().optional().describe("Total amount; default 100"),
  tone: z.enum(["default", "success", "warning", "error"]).optional().describe("Color"),
});
function ProgressView({ props }: ComponentRenderProps<z.infer<typeof progressProps>>) {
  const labelId = useId();
  const max = props.max && props.max > 0 ? props.max : 100;
  const value = Math.min(max, Math.max(0, props.value ?? 0));
  const percent = Math.round((value / max) * 100);
  return (
    <div className="as-gen-progress">
      <div className="as-gen-progress__head">
        <span id={labelId}>{props.label}</span>
        <span className="as-num">{percent}%</span>
      </div>
      <div
        className={cx("as-meter", props.tone && props.tone !== "default" && `as-meter--${props.tone}`)}
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${percent}%`}
      >
        <div className="as-meter__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
const ProgressBar = defineComponent({ name: "ProgressBar", description: "Progress toward a goal or a quota usage meter.", props: progressProps, component: ProgressView });

const keyValueProps = z.object({
  items: z.array(z.object({ key: z.string(), value: scalar })).describe("Label/value pairs"),
  title: z.string().optional().describe("Heading"),
});
function KeyValueView({ props }: ComponentRenderProps<z.infer<typeof keyValueProps>>) {
  return (
    <div className="as-gen-kv">
      {props.title ? <div className="as-gen-kv__title">{props.title}</div> : null}
      <dl>
        {(props.items ?? []).map((item, index) => (
          <div className="as-gen-kv__row" key={index}>
            <dt>{item?.key}</dt>
            <dd>{displayScalar(item?.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
const KeyValue = defineComponent({ name: "KeyValue", description: "Labelled fields of one record (status, owner, dates).", props: keyValueProps, component: KeyValueView });

const barChartProps = z.object({
  labels: z.array(z.string()).describe("Category labels"),
  values: z.array(z.number()).describe("One non-negative value per label"),
  title: z.string().optional().describe("Chart title"),
  unit: z.string().optional().describe('Unit suffix, e.g. "%" or " ms"'),
});
function BarChartView({ props }: ComponentRenderProps<z.infer<typeof barChartProps>>) {
  const titleId = useId();
  const labels = props.labels ?? [];
  const values = (props.values ?? []).slice(0, labels.length).map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
  const unit = props.unit ?? "";
  const width = 480;
  const height = 220;
  const top = 22;
  const bottom = 36;
  const side = 8;
  const innerHeight = height - top - bottom;
  const max = Math.max(...values, 0) || 1;
  const slot = values.length ? (width - side * 2) / values.length : 0;
  const barWidth = Math.max(4, Math.min(56, slot * 0.62));
  const short = (label: string) => (label.length > 12 ? `${label.slice(0, 11)}…` : label);
  return (
    <figure className="as-gen-chart">
      {props.title ? <figcaption id={titleId}>{props.title}</figcaption> : null}
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={props.title ? titleId : undefined} aria-label={props.title ? undefined : "Bar chart"}>
        <line x1={side} x2={width - side} y1={top + innerHeight} y2={top + innerHeight} className="as-gen-chart__axis" />
        {values.map((value, index) => {
          const barHeight = (value / max) * innerHeight;
          const x = side + slot * index + (slot - barWidth) / 2;
          const y = top + innerHeight - barHeight;
          const label = labels[index] ?? "";
          return (
            <g key={index}>
              <rect x={x} y={y} width={barWidth} height={Math.max(barHeight, 1)} rx={3} className="as-gen-chart__bar">
                <title>{`${label}: ${formatNumber(value)}${unit}`}</title>
              </rect>
              <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" className="as-gen-chart__value">
                {`${formatNumber(value)}${unit}`}
              </text>
              <text x={x + barWidth / 2} y={height - bottom + 18} textAnchor="middle" className="as-gen-chart__label">
                {short(label)}
              </text>
            </g>
          );
        })}
      </svg>
      <table className="as-sr-only">
        <caption>{props.title ?? "Chart data"}</caption>
        <tbody>
          {values.map((value, index) => (
            <tr key={index}>
              <th scope="row">{labels[index]}</th>
              <td>{`${formatNumber(value)}${unit}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
const BarChart = defineComponent({ name: "BarChart", description: "A simple bar chart comparing a few categories.", props: barChartProps, component: BarChartView });

// ---- Containers -----------------------------------------------------------

const leafRefs = [Text.ref, Stat.ref, Table.ref, List.ref, Button.ref, Callout.ref, ProgressBar.ref, KeyValue.ref, BarChart.ref] as const;

const rowProps = z.object({
  children: z.array(z.union(leafRefs)).describe("Items laid out side by side (wraps on narrow screens)"),
});
function RowView({ props, renderNode }: ComponentRenderProps<z.infer<typeof rowProps>>) {
  return <div className="as-gen-row">{renderNode(props.children)}</div>;
}
const Row = defineComponent({ name: "Row", description: "Horizontal group, e.g. several Stats or Buttons.", props: rowProps, component: RowView });

const cardProps = z.object({
  title: z.string().describe("Card heading"),
  children: z.array(z.union([...leafRefs, Row.ref])).describe("Card body"),
  subtitle: z.string().optional().describe("Secondary heading text"),
});
function CardView({ props, renderNode }: ComponentRenderProps<z.infer<typeof cardProps>>) {
  const titleId = useId();
  return (
    <section className="as-gen-card" aria-labelledby={titleId}>
      <header className="as-gen-card__header">
        <h3 className="as-gen-card__title" id={titleId}>
          {props.title}
        </h3>
        {props.subtitle ? <p className="as-gen-card__subtitle">{props.subtitle}</p> : null}
      </header>
      <div className="as-gen-card__body">{renderNode(props.children)}</div>
    </section>
  );
}
const Card = defineComponent({ name: "Card", description: "A titled panel grouping related content.", props: cardProps, component: CardView });

const stackProps = z.object({
  children: z.array(z.union([Card.ref, Row.ref, ...leafRefs])).describe("Top-level blocks"),
  direction: z.enum(["column", "row"]).optional().describe("Layout direction; default column"),
});
function StackView({ props, renderNode }: ComponentRenderProps<z.infer<typeof stackProps>>) {
  return <div className={cx("as-gen-stack", props.direction === "row" && "as-gen-stack--row")}>{renderNode(props.children)}</div>;
}
const Stack = defineComponent({ name: "Stack", description: "Root layout: blocks stacked vertically (or in a row).", props: stackProps, component: StackView });

/** The default components, for composing a custom library (`createLibrary({ components: [...] })` or `defaultLibrary.extend(...)`). */
export const defaultComponents = { Stack, Card, Row, Text, Stat, Table, List, Button, Callout, ProgressBar, KeyValue, BarChart } as const;

/**
 * The default OpenUI component library, styled with this package's `as-`
 * classes. Root component: `Stack`.
 */
export const defaultLibrary = createLibrary({
  id: "agent-starter-default",
  root: "Stack",
  components: Object.values(defaultComponents),
  componentGroups: [
    { name: "Layout", components: ["Stack", "Card", "Row"] },
    { name: "Content", components: ["Text", "List", "KeyValue", "Callout"] },
    { name: "Data", components: ["Stat", "Table", "BarChart", "ProgressBar"] },
    { name: "Actions", components: ["Button"] },
  ],
});

const DEFAULT_PREAMBLE =
  "You are an assistant embedded in a product UI. Answer in concise plain text (light markdown is fine). " +
  "When structured output would help the user — metrics, comparisons, records, progress, or choices they can click — " +
  "also render generative UI written in openui-lang, the declarative UI language described below.";

const DEFAULT_RULES = [
  "Prefer a short sentence of text plus one focused UI block over large dashboards.",
  "Use Table for more than three records, Stat for headline numbers, KeyValue for a single record's fields.",
  "Never invent data: only render values you obtained from tools or the conversation.",
];

const DEFAULT_EXAMPLE = [
  "root = Stack([summary, accounts])",
  'summary = Row([revenue, churn])',
  'revenue = Stat("Revenue", "$48.2k", "+12% MoM", "up")',
  'churn = Stat("Churn", "2.1%", "-0.3 pts", "down")',
  'accounts = Card("Top accounts", [table, draft])',
  'table = Table(["Account", "Plan", "MRR"], [["Acme", "Enterprise", 12000], ["Globex", "Team", 4200]])',
  'draft = Button("Draft renewal emails", @ToAssistant("Draft renewal emails for the top accounts"))',
].join("\n");

export interface GenerativeUIPromptOptions extends PromptOptions {
  /** Library to describe. Default `defaultLibrary`. */
  library?: Library;
}

/**
 * The component contract for agent instructions: `library.prompt()` with
 * defaults for chat. Inline mode is on by default, so agents answer in text
 * and wrap UI in ```openui-lang fences, which `<AgentChat />` renders with
 * `<GenerativeUI />`. Any `PromptOptions` field overrides the defaults.
 */
export function generativeUISystemPrompt(options: GenerativeUIPromptOptions = {}): string {
  const { library = defaultLibrary, ...prompt } = options;
  const inlineMode = prompt.inlineMode ?? true;
  const example = inlineMode ? `\`\`\`openui-lang\n${DEFAULT_EXAMPLE}\n\`\`\`` : DEFAULT_EXAMPLE;
  return library.prompt({
    preamble: DEFAULT_PREAMBLE,
    additionalRules: DEFAULT_RULES,
    ...(library === defaultLibrary ? { examples: [example] } : {}),
    ...prompt,
    inlineMode,
  });
}

/** The default example program (useful in tests and docs). */
export const defaultLibraryExample = DEFAULT_EXAMPLE;
