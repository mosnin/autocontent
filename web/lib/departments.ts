// Marketer's departments. One registry feeds the sidebar, department pages,
// session chips, the composer's "Ask the …" scoping and the agent identities
// in agent/ (keep `agent` in sync with the specialist identities there).
//
// Pure + client-safe: plain data only.

import type { Palette } from "@/design-system";

export type DepartmentId = "strategy" | "content" | "seo" | "paid" | "distribution" | "analytics";

export interface Department {
  id: DepartmentId;
  /** Sidebar + page name. */
  label: string;
  /** The specialist agent who runs it (shown on chips and traces). */
  agentName: string;
  /** Agent identity in agent/src/agents (multi-agent specialists). */
  agent: string;
  /** The colour field this department's agent owns, everywhere. */
  palette: Palette;
  href: string;
  /** One line under the page title. */
  summary: string;
  /** Composer placeholder when a session is scoped to this department. */
  placeholder: string;
  /** Suggested asks for this department. */
  asks: string[];
}

export const DEPARTMENTS: Department[] = [
  {
    id: "strategy",
    label: "Strategy",
    agentName: "Strategist",
    agent: "strategist",
    palette: "dusk",
    href: "/playbooks",
    summary: "Positioning, audiences and the playbooks every other department works from.",
    placeholder: "Ask the Strategist to sharpen positioning or plan a launch…",
    asks: ["Draft a playbook for my newest product", "Who should we be talking to that we aren't?", "Plan a 30-day launch across organic and paid"],
  },
  {
    id: "content",
    label: "Content",
    agentName: "Content producer",
    agent: "content-producer",
    palette: "bloom",
    href: "/content",
    summary: "Short-form video, carousels and remixes, made from your playbooks and posted on schedule.",
    placeholder: "Ask the Content producer for videos, carousels or a remix…",
    asks: ["Make three hooks to test this week", "Turn last week's best video into a carousel", "Why did yesterday's video fail QA?"],
  },
  {
    id: "seo",
    label: "SEO",
    agentName: "SEO editor",
    agent: "seo-editor",
    palette: "lagoon",
    href: "/seo",
    summary: "Long-form articles researched against what ranks, then repurposed into social.",
    placeholder: "Ask the SEO editor for an article or a content cluster…",
    asks: ["Write an article on our highest-intent keyword", "Repurpose my last article into five posts", "What topics are competitors ranking for?"],
  },
  {
    id: "paid",
    label: "Paid media",
    agentName: "Media buyer",
    agent: "media-buyer",
    palette: "ember",
    href: "/paid",
    summary: "Google and Meta campaigns run by an agent, inside budgets you set and approvals you control.",
    placeholder: "Ask the Media buyer to launch, scale or pause a campaign…",
    asks: ["Should we scale our best ad set?", "Launch a $20/day test for the new offer", "Where is our CPA going up?"],
  },
  {
    id: "distribution",
    label: "Distribution",
    agentName: "Distribution manager",
    agent: "distribution-manager",
    palette: "sky",
    href: "/distribution",
    summary: "Channels, the calendar and campaigns that coordinate everything going out.",
    placeholder: "Ask the Distribution manager about the calendar or a channel…",
    asks: ["What's going out this week?", "Fill the gaps in next week's calendar", "Connect TikTok and Instagram"],
  },
  {
    id: "analytics",
    label: "Analytics",
    agentName: "Analyst",
    agent: "analyst",
    palette: "sunrise",
    href: "/analytics",
    summary: "Spend, output and reach across organic, articles and paid, with what moved and why.",
    placeholder: "Ask the Analyst what moved and why…",
    asks: ["What worked best this month?", "Where are we wasting spend?", "Compare organic and paid cost per view"],
  },
];

/** The orchestrator people talk to. */
export const MARKETER = { name: "Marketer", palette: "dusk" as Palette };

export function departmentById(id: string | null | undefined): Department | undefined {
  return DEPARTMENTS.find((d) => d.id === id);
}

export function departmentForPath(pathname: string): Department | undefined {
  return DEPARTMENTS.find((d) => pathname === d.href || pathname.startsWith(`${d.href}/`));
}
