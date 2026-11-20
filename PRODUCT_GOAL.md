# Product goal: Marketer is a marketing department, not a set of dashboards

Status: active. Owner: this branch (`claude/lucid-albattani-nen4g7`).

## The problem

Marketer shipped as a "suite": Content, SEO, Ads, Campaigns and Suite, each with
its own sidebar and dashboard. The engines underneath are deep (a ten-step video
pipeline, an eight-step article pipeline, carousels, fail-closed paid ads,
campaign orchestration, a media library, an MCP server and SDK), but the
product on top is a pile of disconnected forms. Nothing joins the departments:
there is no single place that says what needs you, what moved, or what to do
next, and no one you can just ask.

## The thesis

Marketer is **a senior marketing department you talk to**. It plans, makes,
distributes, buys and measures, and it works the same way for its two users:

1. **An AI agent** doing marketing and distribution for a product. It reaches
   Marketer through the MCP server, the REST API, the SDK or the agent harness,
   with the same tools, budgets and approvals a person gets.
2. **A person who wants AI to do their distribution.** They talk to Marketer
   like ChatGPT or Claude, approve what matters, and see all the data in one
   place.

So the product is built around one conversation and one source of truth:

- **Ask.** One composer on Home and in every session. Marketer (the
  orchestrator) routes work to its departments: Strategy, Content, SEO,
  Paid media, Distribution, Analytics. Each department is a specialist agent
  with tools over the real engines.
- **Approve.** Anything that spends money or publishes goes through one inbox.
  Videos, carousels and ad changes waiting on you live together, and the agent
  pauses on the same approvals in chat.
- **See.** One analytics view across organic video, articles and paid ads:
  spend, output, reach, and what moved, with "Ask Marketer" on every chart.
- **Run on its own.** A persistent agent wakes on a schedule, reads the
  numbers, and proposes the next moves as a plan you approve.

## Information architecture

```
Sidebar
  [brand switcher]                      search · collapse
  [ Home | Activity ]                   segmented
  + New session
  Analytics · Plan · Library · Inbox(dot)
  Departments: Content · SEO · Paid media · Distribution
  Awaiting you: up to 3 live approval rows, "Show more"
  Recents: chat sessions
  ──
  Playbooks · Brand · Integrations · Settings
  Getting started  (n of 5 ring)
```

- **Home**: time-of-day shader greeting, the composer, suggested asks drawn
  from real state, then cards: Awaiting you, Recent sessions, This week, What
  moved.
- **Session**: the conversation with Marketer. Department chips show who is
  working; plan cards ("Run creative pipeline, 7 steps") approve and run;
  question cards offer numbered answers; a right panel shows the active
  department's trace.
- **Departments** are workspaces over the engines (Content: videos, carousels,
  library, templates; SEO: articles; Paid media: accounts, campaigns,
  guardrails; Distribution: calendar, channels, campaigns). Each opens with an
  "Ask the <department>" composer that starts a scoped session.
- **Playbooks** (formerly niches): who to talk to, how to sound, what to make,
  where to post.

## Design

The app takes Podium's design DNA (see `web/DESIGN.md`): floating panels on a
canvas, a quiet 256px sidebar, Home/Activity segmented control, dots not
badges, pill buttons, one blue accent, gradient shader banners, isometric
empty states, motion under 300ms, light and dark as equals.

Onboarding follows the intent-driven doctrine from onboarding-starter
(`web/ONBOARDING.md`): infer the brand, ask how they distribute today,
connect only what that implies, start working, and open the dashboard on
proof.

## Agent harness

`agent/` is generated from agent-starter (Cloudflare Workers + Flue) with the
chat, multi-agent, background, in-app and persistent modules, and follows its
skills and definition of done. Every tool is a guarded `defineAgentTool` over
the Marketer REST API, called with the service token plus a server-derived
tenant (`x-tenant-id`), never an id from the model. Publishing and spending
tools are HIGH risk and go through approvals.

## Acceptance

- [ ] One shell, one sidebar, no product switcher; old routes redirect.
- [ ] Home answers "what needs me, what moved, what next" with real data and
      a working composer.
- [ ] Sessions stream from the agent harness, render plan, question and
      approval cards, and degrade to a clear offline state when the harness
      isn't configured.
- [ ] One inbox approves videos, carousels and ad changes.
- [ ] One analytics view joins organic, articles and paid.
- [ ] Every department page is reachable in two clicks and has an ask entry.
- [ ] Backend: workspace overview, inbox and activity endpoints with tests;
      agent service-token delegation with tests.
- [ ] Agent harness: typecheck, lint, test pass; tools covered by tests.
- [ ] Web builds; screenshots checked in light and dark at desktop and phone.
