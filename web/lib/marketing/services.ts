export type Service = {
  slug: string;
  title: string;
  metaTitle: string;
  description: string;
  lede: string;
  appHref: string;
  group: "create" | "distribute" | "control";
  points: { title: string; body: string }[];
};

export const SERVICES: Service[] = [
  {
    slug: "video",
    title: "Short-form video",
    metaTitle: "Short-form video",
    description:
      "Hook, script, keyframes, animation, voice, music, captions, QA, publish. Ten stages, no timeline to babysit.",
    lede: "One brief becomes a scripted, voiced, captioned vertical short for TikTok, Reels, and Shorts.",
    appHref: "/dashboard",
    group: "create",
    points: [
      {
        title: "Ten-stage pipeline",
        body: "Ideation through publish runs as one job. You review the output, not a timeline.",
      },
      {
        title: "On-model frames",
        body: "Characters and products stay consistent across scenes because the brief and references travel with every shot.",
      },
      {
        title: "Fails closed",
        body: "If the next stage would cross a spend cap, the job stops. Nothing is billed past the limit.",
      },
    ],
  },
  {
    slug: "articles",
    title: "SEO articles",
    metaTitle: "SEO articles",
    description:
      "Live research of what already ranks, a structured outline, sections written in parallel, then metadata and JSON-LD.",
    lede: "Long-form that starts from the SERP you actually have to beat, then writes, scores, and packages the page.",
    appHref: "/articles",
    group: "create",
    points: [
      {
        title: "Research first",
        body: "The outline is built from what already ranks, not a generic heading stack.",
      },
      {
        title: "Parallel draft",
        body: "Sections write together, then QA scores the draft before anyone sees it.",
      },
      {
        title: "Ship-ready metadata",
        body: "Title, description, Article JSON-LD, and a hero image come with the draft.",
      },
    ],
  },
  {
    slug: "ugc",
    title: "UGC ads",
    metaTitle: "UGC ads",
    description:
      "A script plus a few reference images becomes one vertical spokesperson ad.",
    lede: "Spokesperson creatives with the controls the chosen model actually supports — not a fake studio UI.",
    appHref: "/ugc",
    group: "create",
    points: [
      {
        title: "Reference-locked",
        body: "Face and wardrobe come from the stills you attach, so the speaker stays the same person.",
      },
      {
        title: "Script to take",
        body: "Write the line, pick a voice, render. The output is a vertical file you can run as an ad.",
      },
      {
        title: "Same ledger",
        body: "UGC draws down the same prepaid balance and the same daily caps as every other surface.",
      },
    ],
  },
  {
    slug: "dramas",
    title: "Micro-dramas",
    metaTitle: "Micro-dramas",
    description:
      "One idea becomes a screenplay, a locked cast, a shot list, and a stitched vertical short.",
    lede: "Serial storytelling with a cast that does not drift from shot to shot.",
    appHref: "/dramas",
    group: "create",
    points: [
      {
        title: "Locked cast",
        body: "Each character is bound to a reference so they look like themselves in every scene they appear in.",
      },
      {
        title: "Screenplay first",
        body: "The shot list is derived from the script, not improvised at render time.",
      },
      {
        title: "Stitched output",
        body: "Takes are assembled into one vertical short you can publish or cut into ads.",
      },
    ],
  },
  {
    slug: "motion",
    title: "Motion graphics",
    metaTitle: "Motion graphics",
    description:
      "Narration becomes timed beats, each with b-roll and kinetic type, composited into one video.",
    lede: "Explainers and kinetic type that stay on the plan — every beat has a line and a shot.",
    appHref: "/motion",
    group: "create",
    points: [
      {
        title: "Timed to voice",
        body: "Beats are cut to the narration, so type and b-roll land on the words.",
      },
      {
        title: "Plan kept",
        body: "The storyboard is the source of truth. Renders follow it instead of inventing a new cut.",
      },
      {
        title: "One composite",
        body: "The output is a single video, not a folder of loose layers.",
      },
    ],
  },
  {
    slug: "templates",
    title: "Templates & remix",
    metaTitle: "Templates",
    description:
      "Curated aesthetics with the exact prompt attached. Drop in your product photo.",
    lede: "Looks you can reuse. Add your product and get the same treatment without rewriting the prompt.",
    appHref: "/templates",
    group: "create",
    points: [
      {
        title: "Prompt attached",
        body: "Every look ships with the prompt that made it, so remixes stay honest.",
      },
      {
        title: "Your product in frame",
        body: "Swap the hero object. The lighting and grade stay with the template.",
      },
      {
        title: "Library, not a feed",
        body: "Templates live next to your own finals so a look is something you pick, not chase.",
      },
    ],
  },
  {
    slug: "headshots",
    title: "Headshots",
    metaTitle: "Headshots",
    description:
      "Consistent on-model stills for ads, UGC, and brand kits — the face the rest of the system locks to.",
    lede: "Generate the stills your spokesperson and ad surfaces need, then reuse them so the person does not change.",
    appHref: "/ads/headshots",
    group: "create",
    points: [
      {
        title: "On-model stills",
        body: "A small set of angles and lighting setups, not a random face each time.",
      },
      {
        title: "Feeds every surface",
        body: "UGC, dramas, and ad creatives can all lock to the same headshot set.",
      },
      {
        title: "Metered like everything else",
        body: "Renders hit the same ledger and the same caps as video and articles.",
      },
    ],
  },
  {
    slug: "ad-studio",
    title: "Ad studio",
    metaTitle: "Ad studio",
    description:
      "Produce paid creatives — stills and motion — that drop straight into campaigns.",
    lede: "A dedicated studio for ad units: sizes, copy variants, and files the campaign runner can actually spend against.",
    appHref: "/ad-creatives",
    group: "distribute",
    points: [
      {
        title: "Built for spend",
        body: "Outputs are campaign creatives, not leftover organic cuts.",
      },
      {
        title: "Variants on purpose",
        body: "Headlines and frames generate as a set so you can test without leaving the studio.",
      },
      {
        title: "Same brand kit",
        body: "Colors, type, and personas carry over from Suite so ads do not look like a second company.",
      },
    ],
  },
  {
    slug: "design",
    title: "Design agent",
    metaTitle: "Design agent",
    description:
      "An agent that iterates on ad layouts, type, and crop until the unit is ready to run.",
    lede: "Describe the change. The design agent revises the creative and keeps a history you can approve.",
    appHref: "/ads/design",
    group: "distribute",
    points: [
      {
        title: "Iterate in place",
        body: "Ask for a tighter crop, a louder headline, a cleaner badge — without opening a design tool.",
      },
      {
        title: "Approval trail",
        body: "Each revision is logged. Nothing spends until you (or your threshold) say so.",
      },
      {
        title: "Agent, not a filter",
        body: "It works through the same API and caps as every other agent surface.",
      },
    ],
  },
  {
    slug: "scheduling",
    title: "Scheduling & publishing",
    metaTitle: "Scheduling",
    description:
      "Per-niche posting windows, one agenda, a composer for eleven platforms, a dispatcher that cannot post twice.",
    lede: "Organic publishing on a calendar you can read, with a dispatcher that fails closed instead of double-posting.",
    appHref: "/scheduled",
    group: "distribute",
    points: [
      {
        title: "One agenda",
        body: "Video, articles, and ads share the same calendar so the week is visible.",
      },
      {
        title: "Windows, not guesses",
        body: "Each niche has posting hours. The dispatcher waits for the window.",
      },
      {
        title: "Exactly once",
        body: "A post that already went out cannot go out again. The job is idempotent.",
      },
    ],
  },
  {
    slug: "queue",
    title: "Production queue",
    metaTitle: "Production queue",
    description:
      "Every render, article, and creative job in one queue — status, cost, and retry without leaving the ledger.",
    lede: "See what is running, what is waiting on a cap, and what is ready for review.",
    appHref: "/queue",
    group: "distribute",
    points: [
      {
        title: "One list",
        body: "Studio, press, and ads jobs sit in the same queue so nothing hides in a tab.",
      },
      {
        title: "Cost on the row",
        body: "Each job shows the estimate and the actual drawdown after it finishes.",
      },
      {
        title: "Retry without re-briefing",
        body: "Failed stages retry from the last good checkpoint, still under the cap.",
      },
    ],
  },
  {
    slug: "campaigns",
    title: "Campaigns",
    metaTitle: "Campaigns",
    description:
      "A budget, a window, and lanes. An hourly runner paces each lane and completes the campaign when the budget is spent.",
    lede: "Run content, SEO, and ads together on one prepaid budget that stops when it is empty.",
    appHref: "/campaigns",
    group: "distribute",
    points: [
      {
        title: "Lanes",
        body: "Video, articles, and paid each get a lane and a share of the budget.",
      },
      {
        title: "Hourly runner",
        body: "Work is paced across the window so the whole budget does not fire on day one.",
      },
      {
        title: "Done means spent",
        body: "The campaign completes when the budget is used, not when a calendar says so.",
      },
    ],
  },
  {
    slug: "ads",
    title: "Paid ads",
    metaTitle: "Paid ads",
    description:
      "Paid campaigns across Google and Meta, driven by agents and governed by hard budget guardrails.",
    lede: "Real media spend with the same fail-closed caps you already use for generation.",
    appHref: "/ads",
    group: "distribute",
    points: [
      {
        title: "Agent-operated",
        body: "Campaigns can be created and adjusted through the same API and MCP tools.",
      },
      {
        title: "Hard budgets",
        body: "Spend that would cross the guard is refused. There is no 'warn and continue'.",
      },
      {
        title: "Approvals",
        body: "Above your threshold, a human has to sign off before money moves.",
      },
    ],
  },
  {
    slug: "niches",
    title: "Niches & spend caps",
    metaTitle: "Niches",
    description:
      "Audience, look, voice, models, posting windows, and a daily spend cap per niche.",
    lede: "The brief the rest of the system runs on — and the cap that stops it.",
    appHref: "/niches",
    group: "control",
    points: [
      {
        title: "One brief per niche",
        body: "Voice, audience, and look live on the niche so every job starts from the same place.",
      },
      {
        title: "Daily cap",
        body: "Checked before a call and re-checked after. Crossing it refuses the work.",
      },
      {
        title: "Global override",
        body: "An account-wide cap sits above every niche so a busy day cannot empty the balance.",
      },
    ],
  },
  {
    slug: "analytics",
    title: "Analytics & spend",
    metaTitle: "Analytics",
    description:
      "Views, watch time, and completion feed the next round, while every model call is metered.",
    lede: "The loop: what shipped, what it cost, and what the next brief should learn.",
    appHref: "/dashboard",
    group: "control",
    points: [
      {
        title: "Performance in",
        body: "Watch time and completion can feed the next ideation pass.",
      },
      {
        title: "Ledger out",
        body: "Every model call is a line item. You can see the day before it is over.",
      },
      {
        title: "No mystery invoice",
        body: "Prepaid credits and caps mean the number you see is the number you spent.",
      },
    ],
  },
  {
    slug: "automation",
    title: "Automation & agents",
    metaTitle: "Automation",
    description:
      "REST, Python SDK, CLI, and MCP — everything a person can do, an agent can do, behind the same caps.",
    lede: "First-class agent surfaces. Same rules, same ledger, same approvals.",
    appHref: "/settings/tokens",
    group: "control",
    points: [
      {
        title: "Four doors",
        body: "REST, SDK, CLI, and MCP all call the same mutations.",
      },
      {
        title: "Cost on the tool",
        body: "MCP tool descriptions carry estimates so an agent can refuse its own work.",
      },
      {
        title: "Tokens, not passwords",
        body: "Personal access tokens are scoped and revocable from Suite.",
      },
    ],
  },
  {
    slug: "library",
    title: "Media library",
    metaTitle: "Media library",
    description:
      "Finals, clips, images, and recuts on four shelves, filtered by niche.",
    lede: "The archive. Stitch new videos from old scenes without re-rendering the world.",
    appHref: "/library",
    group: "control",
    points: [
      {
        title: "Four shelves",
        body: "Finals, clips, stills, and recuts — findable by niche.",
      },
      {
        title: "Server-side stitch",
        body: "Build a new cut from scenes you already paid to render.",
      },
      {
        title: "Reuse is cheaper",
        body: "The library exists so you do not regenerate a face you already have.",
      },
    ],
  },
  {
    slug: "seo-audit",
    title: "SEO audit",
    metaTitle: "SEO audit",
    description:
      "Point it at a URL and get a scored audit with evidence and a recommendation behind every rule.",
    lede: "A diagnostic for pages you already shipped — or competitors you need to beat.",
    appHref: "/seo-audit",
    group: "control",
    points: [
      {
        title: "Weighted score",
        body: "Categories are scored, not just listed, so you know what to fix first.",
      },
      {
        title: "Evidence",
        body: "Every rule shows the snippet or signal that triggered it.",
      },
      {
        title: "Next article",
        body: "The audit can feed the articles pipeline so the next draft starts from the gap.",
      },
    ],
  },
  {
    slug: "brand",
    title: "Brand kit",
    metaTitle: "Brand kit",
    description:
      "Colors, type, voice, and references the rest of the suite reads before it renders.",
    lede: "Set the identity once. Video, articles, and ads pull from the same kit.",
    appHref: "/settings/brand",
    group: "control",
    points: [
      {
        title: "One identity",
        body: "Palette, type, and voice live here so surfaces do not invent a second brand.",
      },
      {
        title: "References",
        body: "Product shots and logo marks travel with every job that needs them.",
      },
      {
        title: "Editable without a redesign",
        body: "Change the kit and the next job picks it up. Finished work stays as-shipped.",
      },
    ],
  },
  {
    slug: "personas",
    title: "Personas",
    metaTitle: "Personas",
    description:
      "Named characters with locked references so UGC, dramas, and ads speak with the same face.",
    lede: "The people in your ads should be the same people tomorrow.",
    appHref: "/settings/personas",
    group: "control",
    points: [
      {
        title: "Named and reusable",
        body: "A persona is a record, not a prompt you hope to remember.",
      },
      {
        title: "Reference locked",
        body: "Stills attach to the persona so generation cannot swap the face.",
      },
      {
        title: "Shared across products",
        body: "Content, ads, and dramas all resolve the same persona id.",
      },
    ],
  },
];

export function getService(slug: string): Service | undefined {
  return SERVICES.find((service) => service.slug === slug);
}

export function servicesByGroup(group: Service["group"]): Service[] {
  return SERVICES.filter((service) => service.group === group);
}
