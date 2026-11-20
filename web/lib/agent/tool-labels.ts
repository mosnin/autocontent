// Maps the agent's tool calls to plain language and the department doing the
// work, so a transcript reads "Content producer · Queued a TikTok video"
// instead of "enqueue_job". Tool names come from agent/src/marketer/tools/*.

import { DEPARTMENTS, type Department, type DepartmentId } from "@/lib/departments";

const RULES: { test: RegExp; dept: DepartmentId }[] = [
  { test: /(^|_)(ad|ads)(_|$)|budget|media_buy|ad_account|ad_campaign|ad_approval/, dept: "paid" },
  { test: /article|seo|serp|keyword|repurpose/, dept: "seo" },
  { test: /video|job|carousel|image_post|remix|library|template|clip/, dept: "content" },
  { test: /calendar|schedule|ayrshare|channel|campaign|distribut|post_/, dept: "distribution" },
  { test: /overview|performance|metric|spend|analytic|insight|activity/, dept: "analytics" },
  { test: /playbook|niche|brand|kit|strategy|positioning/, dept: "strategy" },
];

export function departmentForTool(toolName: string, input?: unknown): Department | undefined {
  const name = toolName.toLowerCase();
  if (name === "delegate_task" || name === "check_delegation") {
    const agent = typeof input === "object" && input && "agent" in input ? String((input as { agent: unknown }).agent) : "";
    return DEPARTMENTS.find((d) => d.agent === agent || agent.includes(d.id));
  }
  const rule = RULES.find((r) => r.test.test(name));
  return rule ? DEPARTMENTS.find((d) => d.id === rule.dept) : undefined;
}

const VERBS: Record<string, string> = {
  list: "Looked at",
  get: "Read",
  create: "Created",
  enqueue: "Queued",
  generate: "Started",
  retry: "Retried",
  approve: "Approved",
  reject: "Rejected",
  decide: "Decided",
  update: "Updated",
  set: "Updated",
  draft: "Drafted",
  start: "Started",
  pause: "Paused",
  change: "Changed",
  connect: "Connected",
  remix: "Remixed",
  repurpose: "Repurposed",
  delegate: "Handed off to",
  plan: "Planned",
  workspace: "Read",
};

export function describeTool(toolName: string, input?: unknown): string {
  if (toolName === "delegate_task") {
    const d = departmentForTool(toolName, input);
    const task = typeof input === "object" && input && "task" in input ? String((input as { task: unknown }).task) : "";
    return `Handed off to the ${d?.agentName ?? "team"}${task ? `: ${task.slice(0, 80)}` : ""}`;
  }
  if (toolName === "ask_person") return "Asked you a question";
  if (toolName === "plan_goals") return "Made a plan";
  if (toolName === "update_goal") return "Updated the plan";
  const parts = toolName.split(/[_\-.]/).filter(Boolean);
  const verb = VERBS[parts[0] ?? ""];
  const rest = (verb ? parts.slice(1) : parts).join(" ").replace(/\bniches?\b/, "playbooks").replace(/\bjobs?\b/, "videos").replace(/\bimage posts?\b/, "carousels");
  return verb ? `${verb} ${rest}` : rest.replace(/^\w/, (c) => c.toUpperCase());
}
