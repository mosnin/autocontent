import type { Metadata } from "next";

import {
  ReliabilityBand,
  SurfaceCards,
  WindowsBand,
} from "@/components/marketing/features/automation-sections";
import { Note } from "@/components/marketing/features/detail-a/note";
import { SpecCards } from "@/components/marketing/features/detail-a/spec-cards";
import { CodeSample } from "@/components/marketing/features/detail-c/code-sample";
import { FactCards } from "@/components/marketing/features/detail-c/fact-cards";
import { Panel } from "@/components/marketing/features/detail-c/panel";
import { StageRail } from "@/components/marketing/features/detail-c/stage-rail";
import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionCta } from "@/components/marketing/system";
import {
  Band,
  CardGrid,
  MediaCard,
  Section,
  SectionHead,
  Stats,
} from "@/components/site/sections";

const DESCRIPTION =
  "REST API, typed Python SDK, the marketer CLI, and an MCP server with cost-aware tools. Agents create channels, enqueue videos, and publish inside your caps.";

export const metadata: Metadata = {
  title: "Automation & agents · marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "Automation & agents · marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/automation" },
};

/**
 * The same operation on each of the four surfaces. Every line is real:
 * the SDK is `MarketerClient`, the CLI is stdlib argparse with the
 * subcommand groups shown, and both read the same two env vars.
 */
const REST_SAMPLE = [
  "# One token, one base URL. The same pair every surface reads.",
  '$ curl -s "$MARKETER_API_BASE_URL/api/v1/jobs" \\',
  '    -H "Authorization: Bearer $MARKETER_API_TOKEN" \\',
  '    -H "Content-Type: application/json" \\',
  '    -d \'{"niche_id": "...", "platform": "tiktok"}\'',
];

const SDK_SAMPLE = [
  "from marketer.sdk import MarketerClient",
  "",
  "# today_spend() returns a model, not a dict: a total and a",
  "# per-niche breakdown, both as decimals.",
  "async with MarketerClient() as c:",
  "    spend = await c.today_spend()",
  "    if spend.total_usd < budget:",
  "        job = await c.enqueue_job(",
  '            niche_id=niche.id, platform="tiktok",',
  "        )",
];

const CLI_SAMPLE = [
  "# Tables by default, --json when something downstream is reading.",
  "$ marketer niches list",
  "$ marketer spend today --json | jq .total_usd",
  "$ marketer jobs enqueue --niche-id ... --platform tiktok",
  "$ marketer articles generate --niche-id ...",
];

/**
 * How the MCP tool descriptions are written. The strings quoted here are
 * the shape of the real descriptions in `mcp_server.py` - every
 * spend-affecting tool states its cost and asks for confirmation.
 */
const TOOL_CLASSES = [
  {
    name: "Read-only tools",
    chips: ["cheap"],
    copy: "Listing niches, reading a job, fetching an article's markdown, checking today's spend. Described as cheap and read-only so a model doesn't treat them as decisions.",
  },
  {
    name: "Spend-affecting tools",
    chips: ["expensive", "confirm first"],
    copy: "Enqueueing a video or generating an article is labelled expensive in the description itself, with a rough dollar figure and an instruction to confirm with the user before calling it.",
  },
  {
    name: "Money-moving tools",
    chips: ["governed"],
    copy: "Ad budget and status changes go through the same fail-closed guard and approval queue a person's changes do. An agent can propose; it cannot commit.",
  },
  {
    name: "Resources, not tools",
    chips: ["marketer://"],
    copy: "Niches, jobs and articles are also exposed as MCP resources, so a model can read context without spending a tool call to do it.",
  },
];

/** Publishing a hand-authored post, and the three guards against doubles. */
const DISPATCH = [
  {
    label: "A slot is authored the way you think about it",
    copy: "“Every Monday at 09:00, my time.” Not an offset from an epoch - a weekday and a wall-clock time in a named zone.",
  },
  {
    label: "It is expanded in local calendar terms",
    copy: "Each occurrence is built in its own zone and converted to UTC one at a time, so a slot doesn't drift by an hour for half the year when the clocks change.",
    tag: "dst-correct",
  },
  {
    label: "Due posts are claimed atomically",
    copy: "Selection and claim are a single statement, so two dispatchers on the same tick can't both take the same post. The loser gets zero rows, not a duplicate.",
  },
  {
    label: "Each platform is claimed separately",
    copy: "A post that half-landed re-sends only the platforms that never went out, rather than reposting to the ones that did.",
  },
  {
    label: "And a durable key catches the rest",
    copy: "One key per post, platform and scheduled instant. Moving the post rewrites the instant - which is exactly the action that means “send this again”.",
    tag: "idempotent",
  },
];

/** Things that happen without anyone at a keyboard. */
const UNATTENDED = [
  {
    kicker: "Retries",
    title: "Transient only",
    copy: "Connection trouble, timeouts, rate limits and 5xx get retried. A content-policy refusal or a malformed request fails immediately, because retrying it three times just costs three times as long to learn the same thing.",
  },
  {
    kicker: "Reaping",
    title: "No zombies",
    copy: "A run that stops making progress is failed on a timer, which is what makes it retryable and visible to alerts. A job parked for your approval is deliberately exempt - waiting for you is not being stuck.",
  },
  {
    kicker: "Concurrency",
    title: "Bounded everywhere",
    copy: "One job per niche at a time, a small fixed number per account, and a ceiling across the whole deployment. Autopilot has a top speed by construction.",
  },
  {
    kicker: "Webhooks",
    title: "Signed and fail-open",
    copy: "Job and article outcomes are POSTed to your endpoint, HMAC-signed over the timestamp and body. A webhook that fails never breaks the run that fired it.",
  },
];

export default function AutomationFeaturePage() {
  return (
    <main>
      <FeatureHero
        highlight="Walk away."
        illustration={
          <MediaCard
            kind="video"
            label="Agent demo - MCP call to shipped campaign"
            ratio="16/9"
          />
        }
        kicker="Automation & agents"
        lede="Everything a person can do here, an agent can do through the REST API, the typed Python SDK, the marketer CLI, or the MCP server. Inside the caps you set."
        magneticPrimary
        secondary={{ label: "Read the API docs", href: "/resources/api" }}
        titleText="Point your agents at it. Walk away."
        variant="sky"
      />

      <SurfaceCards />

      {/* The same call, four ways */}
      <Section label="The same call, four ways">
        <SectionHead
          eyebrow="One token, one base URL"
          heading="Every surface reads the same two environment variables."
          highlight="the same two"
          lede="A personal access token and a base URL. The SDK, the CLI and the MCP server all take them from the environment or from an argument, and all three end up on the same authenticated HTTP API - there is no second, less-guarded path in."
        />
        <CardGrid className="os-mt-48" cols={2}>
          <CodeSample lines={REST_SAMPLE} title="rest" />
          <CodeSample lines={SDK_SAMPLE} title="python sdk" />
        </CardGrid>
        <CodeSample className="os-mt-16" lines={CLI_SAMPLE} title="marketer cli" />
        <Note title="The CLI is deliberately boring.">
          No framework, no colour library, no spinner. Tables are formatted by
          hand so the output pipes cleanly, and every command takes a JSON
          flag for when something downstream is reading instead of someone.
        </Note>
      </Section>

      {/* MCP */}
      <Section label="The MCP server">
        <div className="os-split">
          <SectionHead
            eyebrow="MCP"
            heading="A tool description is the only warning a model gets."
            highlight="the only warning"
            lede="An agent decides whether to call something from its description and nothing else. So the descriptions here say what an action costs and what it touches, in the text the model actually reads - not in documentation it will never open."
          />
          <MediaCard
            kind="image"
            label="MCP tool call - cost-aware tool description"
          />
        </div>
        <SpecCards className="os-mt-48" cols={2} items={TOOL_CLASSES} />
      </Section>

      <Panel
        body="Agent tools do not reach into the database. They call the same HTTP API your browser does, with your token, so every call an agent makes is metered to the ledger, checked against the niche cap, the global cap and the prepaid balance, and refused on the same terms your own would be."
        bullets={[
          "A token is shown once and stored only as a hash. Lists show a short hint, never the secret.",
          "Nothing an agent can call bypasses the approval gate on a niche that has one.",
          "There is an opt-in path for an agent to top its own credit up over HTTP 402 - off by default, bounded per top-up, and inert until a deploy configures it.",
        ]}
        eyebrow="The important part"
        heading="An agent gets your permissions. It does not get an exception."
        highlight="It does not get an exception."
        label="Agent authority"
      />

      <WindowsBand />

      {/* Scheduled posts */}
      <Section label="Scheduled publishing">
        <div className="os-split">
          <SectionHead
            eyebrow="Publishing"
            heading="Running the dispatcher twice must not post twice."
            highlight="must not post twice."
            lede="Double-posting is the single worst failure a scheduler has, and it is the failure that unattended systems produce most easily. Three independent guards stand in the way, and the recurring-slot maths is built around never emitting the same instant twice either."
          />
          <MediaCard
            kind="illustration"
            label="Dispatch - claim, per-platform claim, idempotency key"
          />
        </div>
        <StageRail className="os-mt-48" steps={DISPATCH} />
        <Note title="A bulk import is all-or-nothing.">
          Every row of an uploaded schedule is validated before any row is
          written. One bad row and nothing is created, because the only sane
          response to a partial import is to fix the file and upload it again
          - and a re-upload whose good rows already landed duplicates every
          one of them.
        </Note>
      </Section>

      {/* Unattended */}
      <Section label="Running unattended">
        <SectionHead
          eyebrow="Unattended"
          heading="The queue has to survive the night on its own."
          highlight="on its own."
          lede="Autopilot is only worth having if it doesn't need a person to unstick it. These four behaviours are what make leaving it alone reasonable rather than optimistic."
        />
        <FactCards className="os-mt-48" cols={2} items={UNATTENDED} />
      </Section>

      <ReliabilityBand />

      {/* Fleet */}
      <Band
        bullets={[
          "Scheduled work is spread across the week rather than fired at the top of it.",
          "Every spawned job and article carries its origin, so cost and output roll up without anyone tagging anything.",
          "A failure inside one unit of scheduled work is contained and logged; the pass moves on to the next.",
        ]}
        eyebrow="At rest"
        flip
        heading="Nothing here waits for you to press a button."
        highlight="waits for you"
        label="Scheduled work"
        lede="Between the posting windows on a niche and the recurring passes that spawn work, the normal state of the system is producing on its own. Your involvement is the caps you set and the approvals you keep, not the trigger."
        media={
          <MediaCard
            kind="illustration"
            label="Posting schedule - per-niche windows"
          />
        }
      />

      <Section label="Automation by the numbers" size="tight">
        <Stats
          items={[
            { value: "4", label: "surfaces: REST, Python SDK, CLI, and MCP" },
            { value: "3", label: "independent guards against a double post" },
            { value: "5", label: "signed outbound events for jobs and articles" },
          ]}
        />
      </Section>

      <SectionCta
        headline="Give your agents a marketing arm."
        highlight="a marketing arm."
        kicker="Get started"
        sub="Four surfaces, one platform. Your agents brief, produce, and publish while the caps hold."
      />
    </main>
  );
}
