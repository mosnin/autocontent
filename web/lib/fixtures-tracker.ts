// Tracker fixtures for /preview/app/tracker/*: a content calendar, an A/B test
// log and a campaign tracker for "Pasta Club", with live Marketer items linked.
import type { Choice, MarketerObject, Member, TemplateInfo, TrackerField, TrackerRow, TrackerTable, TrackerTableSummary, TrackerView } from "./tracker";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-11-20T10:00:00Z";

export const FX_TRACKER_MEMBERS: Member[] = [
  { id: "person_sam", name: "Sam Rivera", email: "sam@pastaclub.co" },
  { id: "person_ana", name: "Ana Okafor", email: "ana@pastaclub.co" },
  { id: "person_lee", name: "Lee Chen", email: "lee@pastaclub.co" },
];

export const FX_TRACKER_OBJECTS: MarketerObject[] = [
  { kind: "video", id: id(901), title: "Cacio e pepe in 60 seconds", status: "done", platform: "tiktok", at: "2026-11-24T17:00:00Z", href: "/content/videos/v1", metrics: { views: 48200, likes: 3900 } },
  { kind: "video", id: id(902), title: "The one pan carbonara", status: "awaiting_approval", platform: "reels", at: "2026-11-28T17:00:00Z", href: "/content/videos/v4", metrics: {} },
  { kind: "video", id: id(903), title: "Why your sauce splits", status: "rendering", platform: "shorts", at: null, href: "/content/videos/v9", metrics: {} },
  { kind: "article", id: id(911), title: "How to make fresh pasta without a machine", status: "done", platform: null, at: "2026-11-18T09:00:00Z", href: "/seo/a1", metrics: { words: 1840 } },
  { kind: "article", id: id(912), title: "The 7 pasta shapes worth owning", status: "writing", platform: null, at: "2026-11-25T09:00:00Z", href: "/seo/a2", metrics: {} },
  { kind: "carousel", id: id(921), title: "5 sauces from one pantry", status: "done", platform: "carousel", at: "2026-11-22T12:00:00Z", href: "/content/carousels/c1", metrics: {} },
  { kind: "campaign", id: id(931), title: "Holiday gift boxes", status: "running", platform: null, at: "2026-11-15T00:00:00Z", href: "/distribution/campaigns/c1", metrics: { budget_usd: "1200.00" } },
  { kind: "campaign", id: id(932), title: "January reset", status: "draft", platform: null, at: "2027-01-02T00:00:00Z", href: "/distribution/campaigns/c2", metrics: { budget_usd: "600.00" } },
];

const choices = (...items: [string, string, string][]): Choice[] => items.map(([cid, label, color]) => ({ id: cid, label, color }));
const field = (table: string, n: number, name: string, type: TrackerField["type"], options: TrackerField["options"] = {}, primary = false): TrackerField => ({ id: id(n), table_id: table, name, type, options, position: n % 100, is_primary: primary });
const view = (table: string, n: number, name: string, type: TrackerView["type"], extra: Partial<TrackerView> = {}): TrackerView => ({ id: id(n), table_id: table, name, type, config: {}, filters: [], filter_type: "and", sorts: [], hidden_fields: [], position: n % 100, ...extra });
const row = (table: string, n: number, pos: number, values: TrackerRow["values"], updated = at): TrackerRow => ({ id: id(n), table_id: table, position: pos, values, created_by: "person_sam", updated_by: "person_sam", created_at: at, updated_at: updated });

// ---------------------------------------------------------------- content calendar
export const CAL = id(100);
const STATUS = choices(["s1", "Idea", "gray"], ["s2", "Drafting", "blue"], ["s3", "In review", "orange"], ["s4", "Scheduled", "purple"], ["s5", "Published", "green"]);
const CHANNEL = choices(["c1", "TikTok", "pink"], ["c2", "Instagram", "purple"], ["c3", "YouTube", "red"], ["c4", "Blog", "teal"], ["c5", "Newsletter", "yellow"]);
const calFields = [
  field(CAL, 101, "Title", "text", {}, true),
  field(CAL, 102, "Status", "single_select", { choices: STATUS }),
  field(CAL, 103, "Channel", "multi_select", { choices: CHANNEL }),
  field(CAL, 104, "Publish date", "date"),
  field(CAL, 105, "Owner", "person"),
  field(CAL, 106, "Video", "marketer_link", { kind: "video" }),
  field(CAL, 107, "Article", "marketer_link", { kind: "article" }),
  field(CAL, 108, "Notes", "long_text"),
];
const [T, S, C, D, O, V, A, N] = calFields.map((f) => f.id) as string[];
export const FX_CALENDAR: TrackerTable = {
  id: CAL,
  name: "Content calendar",
  description: "Every piece from idea to published, on a calendar.",
  template: "content_calendar",
  created_at: "2026-11-01T09:00:00Z",
  updated_at: "2026-11-25T16:20:00Z",
  row_count: 9,
  fields: calFields,
  views: [view(CAL, 151, "All content", "grid"), view(CAL, 152, "By status", "board", { config: { group_field_id: S } }), view(CAL, 153, "Calendar", "calendar", { config: { date_field_id: D } }), view(CAL, 154, "Cards", "gallery")],
};
export const FX_CALENDAR_ROWS: TrackerRow[] = [
  row(CAL, 161, 1, { [T!]: "Cacio e pepe in 60 seconds", [S!]: "s5", [C!]: ["c1", "c2"], [D!]: "2026-11-24", [O!]: "person_ana", [V!]: id(901), [N!]: "Hook test winner: question hook." }),
  row(CAL, 162, 2, { [T!]: "Fresh pasta without a machine", [S!]: "s5", [C!]: ["c4", "c5"], [D!]: "2026-11-18", [O!]: "person_lee", [A!]: id(911) }),
  row(CAL, 163, 3, { [T!]: "5 sauces from one pantry", [S!]: "s5", [C!]: ["c2"], [D!]: "2026-11-22", [O!]: "person_ana" }),
  row(CAL, 164, 4, { [T!]: "The one pan carbonara", [S!]: "s3", [C!]: ["c2", "c3"], [D!]: "2026-11-28", [O!]: "person_sam", [V!]: id(902), [N!]: "Waiting on approval before it posts." }),
  row(CAL, 165, 5, { [T!]: "The 7 pasta shapes worth owning", [S!]: "s2", [C!]: ["c4"], [D!]: "2026-11-30", [O!]: "person_lee", [A!]: id(912) }),
  row(CAL, 166, 6, { [T!]: "Why your sauce splits", [S!]: "s2", [C!]: ["c1", "c3"], [D!]: "2026-12-02", [O!]: "person_ana", [V!]: id(903) }),
  row(CAL, 167, 7, { [T!]: "Gift box unboxing", [S!]: "s4", [C!]: ["c1", "c2"], [D!]: "2026-12-04", [O!]: "person_sam" }),
  row(CAL, 168, 8, { [T!]: "Holiday menu newsletter", [S!]: "s1", [C!]: ["c5"], [D!]: "2026-12-10", [O!]: "person_lee" }),
  row(CAL, 169, 9, { [T!]: "Nonna's ragù, slow version", [S!]: "s1", [C!]: ["c3"], [O!]: "person_ana" }),
];

// ---------------------------------------------------------------- A/B test log
export const AB = id(200);
const abFields = [
  field(AB, 201, "Test", "text", {}, true),
  field(AB, 202, "Hypothesis", "long_text"),
  field(AB, 203, "Variant A", "text"),
  field(AB, 204, "Variant B", "text"),
  field(AB, 205, "Metric", "single_select", { choices: choices(["m1", "Click-through rate", "blue"], ["m2", "Watch time", "purple"], ["m3", "Engagement rate", "pink"], ["m4", "Cost per acquisition", "orange"]) }),
  field(AB, 206, "Status", "single_select", { choices: choices(["a1", "Planned", "gray"], ["a2", "Running", "blue"], ["a3", "Concluded", "green"]) }),
  field(AB, 207, "Lift", "number", { decimals: 1, suffix: "%" }),
  field(AB, 208, "Winner", "single_select", { choices: choices(["w1", "A", "blue"], ["w2", "B", "purple"], ["w3", "No difference", "gray"]) }),
  field(AB, 209, "Decision", "single_select", { choices: choices(["d1", "Ship A", "blue"], ["d2", "Ship B", "purple"], ["d3", "Iterate", "orange"], ["d4", "Drop", "red"]) }),
  field(AB, 210, "Campaign", "marketer_link", { kind: "campaign" }),
  field(AB, 211, "Start date", "date"),
];
const ab = Object.fromEntries(abFields.map((f) => [f.name, f.id])) as Record<string, string>;
export const FX_AB: TrackerTable = {
  id: AB,
  name: "A/B test log",
  description: "Hypothesis, variants, the metric, the result and what you decided.",
  template: "ab_tests",
  created_at: "2026-11-03T09:00:00Z",
  updated_at: "2026-11-25T12:00:00Z",
  row_count: 4,
  fields: abFields,
  views: [view(AB, 251, "All tests", "grid"), view(AB, 252, "By status", "board", { config: { group_field_id: ab.Status } })],
};
export const FX_AB_ROWS: TrackerRow[] = [
  row(AB, 261, 1, { [ab.Test!]: "Question hook vs number hook", [ab.Hypothesis!]: "Opening with a question keeps more viewers past three seconds.", [ab["Variant A"]!]: "Ever wondered why…", [ab["Variant B"]!]: "3 ways to…", [ab.Metric!]: "m2", [ab.Status!]: "a3", [ab.Lift!]: 18.4, [ab.Winner!]: "w1", [ab.Decision!]: "d1", [ab["Start date"]!]: "2026-11-10" }),
  row(AB, 262, 2, { [ab.Test!]: "Gift box price in the first frame", [ab.Hypothesis!]: "Showing the price up front lifts clicks from qualified buyers.", [ab["Variant A"]!]: "Price shown", [ab["Variant B"]!]: "Price hidden", [ab.Metric!]: "m1", [ab.Status!]: "a2", [ab.Campaign!]: id(931), [ab["Start date"]!]: "2026-11-21" }),
  row(AB, 263, 3, { [ab.Test!]: "Carousel cover: dish vs hands", [ab.Hypothesis!]: "Hands in frame feel more human and earn more saves.", [ab["Variant A"]!]: "Plated dish", [ab["Variant B"]!]: "Hands kneading", [ab.Metric!]: "m3", [ab.Status!]: "a3", [ab.Lift!]: -2.1, [ab.Winner!]: "w3", [ab.Decision!]: "d3", [ab["Start date"]!]: "2026-11-05" }),
  row(AB, 264, 4, { [ab.Test!]: "Lookalike vs interest audience", [ab.Hypothesis!]: "A 1% lookalike lowers cost per order.", [ab["Variant A"]!]: "Lookalike 1%", [ab["Variant B"]!]: "Home cooks", [ab.Metric!]: "m4", [ab.Status!]: "a1", [ab.Campaign!]: id(932) }),
];

// ---------------------------------------------------------------- campaign tracker (small, a link target)
export const CAMP = id(300);
const campFields = [
  field(CAMP, 301, "Campaign", "text", {}, true),
  field(CAMP, 302, "Marketer campaign", "marketer_link", { kind: "campaign" }),
  field(CAMP, 303, "Stage", "single_select", { choices: choices(["g1", "Planning", "gray"], ["g2", "Live", "green"], ["g3", "Paused", "orange"], ["g4", "Wrapped", "blue"]) }),
  field(CAMP, 304, "Budget", "number", { decimals: 2, prefix: "$" }),
  field(CAMP, 305, "Start", "date"),
  field(CAMP, 306, "Owner", "person"),
];
export const FX_CAMPAIGNS: TrackerTable = {
  id: CAMP,
  name: "Campaign tracker",
  description: "Your campaigns by stage, with goals, budgets and dates.",
  template: "campaigns",
  created_at: "2026-11-02T09:00:00Z",
  updated_at: "2026-11-19T09:00:00Z",
  row_count: 2,
  fields: campFields,
  views: [view(CAMP, 351, "By stage", "board", { config: { group_field_id: id(303) } }), view(CAMP, 352, "All campaigns", "grid")],
};
export const FX_CAMPAIGN_ROWS: TrackerRow[] = [
  row(CAMP, 361, 1, { [id(301)]: "Holiday gift boxes", [id(302)]: id(931), [id(303)]: "g2", [id(304)]: 1200, [id(305)]: "2026-11-15", [id(306)]: "person_sam" }),
  row(CAMP, 362, 2, { [id(301)]: "January reset", [id(302)]: id(932), [id(303)]: "g1", [id(304)]: 600, [id(305)]: "2027-01-02", [id(306)]: "person_ana" }),
];

export const FX_TRACKER_TABLES: TrackerTableSummary[] = [FX_CALENDAR, FX_AB, FX_CAMPAIGNS].map(({ fields: _f, views: _v, ...t }) => t);

export const FX_TRACKER_TEMPLATES: TemplateInfo[] = [
  { key: "content_calendar", name: "Content calendar", description: "Every piece from idea to published, on a calendar.", fields: ["Title", "Status", "Channel", "Publish date", "Owner", "Video", "Article", "Notes"], views: ["calendar", "board", "grid"] },
  { key: "social_posts", name: "Social post tracker", description: "Posts by platform and status, with captions and links.", fields: ["Post", "Platform", "Status", "Post date", "Caption", "Link", "Carousel", "Video", "Owner"], views: ["board", "calendar", "grid"] },
  { key: "ab_tests", name: "A/B test log", description: "Hypothesis, variants, the metric, the result and what you decided.", fields: ["Test", "Hypothesis", "Variant A", "Variant B", "Metric", "Status", "Result", "Winner", "Decision", "Start date", "End date", "Campaign", "Owner"], views: ["grid", "board", "grid"] },
  { key: "campaigns", name: "Campaign tracker", description: "Your campaigns by stage, with goals, budgets and dates.", fields: ["Campaign", "Marketer campaign", "Stage", "Goal", "Budget", "Start", "End", "Owner", "Channels"], views: ["board", "calendar", "grid"] },
  { key: "launch_checklist", name: "Launch checklist", description: "Everything that has to happen before, on and after launch day.", fields: ["Task", "Done", "Phase", "Due", "Owner", "Notes"], views: ["grid", "board", "calendar"] },
  { key: "creative_briefs", name: "Creative brief board", description: "Briefs from request to approved, with audience and key message.", fields: ["Brief", "Stage", "Format", "Audience", "Key message", "Due", "Owner", "Reference", "Campaign"], views: ["board", "gallery", "grid"] },
];

export const FX_TRACKER_PREVIEW = {
  rowsByTable: { [CAL]: FX_CALENDAR_ROWS, [AB]: FX_AB_ROWS, [CAMP]: FX_CAMPAIGN_ROWS },
  tablesById: { [CAL]: FX_CALENDAR, [AB]: FX_AB, [CAMP]: FX_CAMPAIGNS },
  objects: FX_TRACKER_OBJECTS,
};
