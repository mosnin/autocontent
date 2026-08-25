import * as React from "react";

import {
  Body,
  Card,
  CardGrid,
  CardLink,
  Frame,
  MediaCard,
  Section,
  SectionHead,
  Stats,
  Title,
} from "@/components/site/sections";

type FeatureEntry = {
  title: string;
  href: string;
  meta: string;
  copy: string;
};

type FeatureGroup = {
  id: string;
  eyebrow: string;
  heading: string;
  highlight: string;
  lede: string;
  entries: FeatureEntry[];
};

/**
 * The whole product, grouped by what each surface is for: making the work,
 * getting it out, and keeping it under control. Every entry links to its
 * own page.
 */
const GROUPS: FeatureGroup[] = [
  {
    id: "create",
    eyebrow: "Create",
    heading: "Six ways to turn a brief into finished work.",
    highlight: "finished work.",
    lede: "Each one starts from something you already have — a niche, a script, an idea, a look — and ends with a file you could publish.",
    entries: [
      {
        title: "Short-form video",
        href: "/features/video",
        meta: "Studio",
        copy: "One brief becomes a scripted, voiced, captioned vertical short: ideation, script, keyframes, animation, voice, music, edit, captions, QA, publish.",
      },
      {
        title: "SEO articles",
        href: "/features/articles",
        meta: "Press",
        copy: "Live research on what already ranks, a structured outline, sections drafted in parallel, and a QA score before anything ships.",
      },
      {
        title: "UGC ads",
        href: "/features/ugc",
        meta: "Spokesperson",
        copy: "A script plus a few reference images becomes one vertical spokesperson ad, with the controls the chosen model actually supports.",
      },
      {
        title: "Micro-dramas",
        href: "/features/dramas",
        meta: "Serial",
        copy: "One idea becomes a screenplay, a locked cast, a shot list, and a stitched vertical short — the same actor in every shot they appear in.",
      },
      {
        title: "Motion graphics",
        href: "/features/motion",
        meta: "Kinetic",
        copy: "Narration becomes timed beats, each with its own b-roll and its own line of kinetic type, composited into one video with the plan kept.",
      },
      {
        title: "Templates & remix",
        href: "/features/templates",
        meta: "Looks",
        copy: "Curated aesthetics with the exact prompt attached. Add your product photo and get the same look with your product in it.",
      },
      {
        title: "Headshots",
        href: "/features/headshots",
        meta: "Stills",
        copy: "On-model stills the rest of the suite locks to — UGC, dramas, and ads keep the same face.",
      },
    ],
  },
  {
    id: "distribute",
    eyebrow: "Distribute",
    heading: "Getting it out, on time, exactly once.",
    highlight: "exactly once.",
    lede: "Organic and paid, on a calendar you can read, inside budgets that stop the work rather than warn you about it.",
    entries: [
      {
        title: "Scheduling & publishing",
        href: "/features/scheduling",
        meta: "Calendar",
        copy: "Per-niche posting windows, one agenda across video, articles, and ads, a composer for eleven platforms, and a dispatcher that can't post twice.",
      },
      {
        title: "Campaigns",
        href: "/features/campaigns",
        meta: "Pushes",
        copy: "A budget, a window, and lanes. An hourly runner paces each lane across the week and completes the campaign when the budget is spent.",
      },
      {
        title: "Ads",
        href: "/features/ads",
        meta: "Paid",
        copy: "Paid campaigns across Google and Meta, driven by agents and governed by hard budget guardrails of their own.",
      },
      {
        title: "Ad studio",
        href: "/features/ad-studio",
        meta: "Creatives",
        copy: "Stills and motion built as campaign units, with variants the runner can spend against.",
      },
      {
        title: "Design agent",
        href: "/features/design",
        meta: "Iterate",
        copy: "Revise crop, type, and layout in place. Every change is logged and waits for approval when it should.",
      },
      {
        title: "Production queue",
        href: "/features/queue",
        meta: "Jobs",
        copy: "Every render and article in one list — status, cost, and retry without leaving the ledger.",
      },
    ],
  },
  {
    id: "control",
    eyebrow: "Control",
    heading: "What keeps it honest while you're not looking.",
    highlight: "while you're not looking.",
    lede: "The brief, the ledger, the archive, the agent surfaces, and the diagnostic that tells you whether a page is any good.",
    entries: [
      {
        title: "Niches & spend caps",
        href: "/features/niches",
        meta: "The brief",
        copy: "Audience, look, voice, models, posting windows, and a daily spend cap per niche that is re-checked after every logged cost.",
      },
      {
        title: "Analytics & spend",
        href: "/features/analytics",
        meta: "The loop",
        copy: "Views, watch time, and completion feed the next ideation round, while every model call is metered against caps that fail closed.",
      },
      {
        title: "Automation & agents",
        href: "/features/automation",
        meta: "Surfaces",
        copy: "REST API, a typed Python SDK, the marketer CLI, and an MCP server whose tool descriptions carry cost estimates.",
      },
      {
        title: "Media library",
        href: "/features/library",
        meta: "Archive",
        copy: "Finals, clips, images, and recuts on four shelves, filtered by niche, with a server-side stitch that builds new videos from old scenes.",
      },
      {
        title: "SEO audit",
        href: "/features/seo-audit",
        meta: "Diagnostic",
        copy: "Point it at a URL and get a score across weighted categories, with the evidence and a recommendation behind every rule.",
      },
      {
        title: "Brand kit",
        href: "/features/brand",
        meta: "Identity",
        copy: "Colors, type, voice, and references the rest of the suite reads before it renders.",
      },
      {
        title: "Personas",
        href: "/features/personas",
        meta: "Cast",
        copy: "Named characters with locked references so UGC, dramas, and ads keep the same face.",
      },
    ],
  },
];

function GroupSection({ group }: { group: FeatureGroup }) {
  return (
    <Section id={group.id} label={group.eyebrow}>
      <SectionHead
        eyebrow={group.eyebrow}
        heading={group.heading}
        highlight={group.highlight}
        lede={group.lede}
      />
      <CardGrid className="os-mt-48">
        {group.entries.map((entry) => (
          <Card href={entry.href} key={entry.href}>
            <p className="os-meta">{entry.meta}</p>
            <Title className="os-mt-12" size="sm">
              {entry.title}
            </Title>
            <Body className="os-mt-8">{entry.copy}</Body>
            <span className="os-mt-auto">
              <CardLink>Explore</CardLink>
            </span>
          </Card>
        ))}
      </CardGrid>
    </Section>
  );
}

export function FeatureIndex() {
  return (
    <>
      {GROUPS.map((group) => (
        <GroupSection group={group} key={group.id} />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* What every surface shares                                           */
/* ------------------------------------------------------------------ */

const SHARED = [
  {
    title: "One ledger",
    copy: "Every model call — text, image, video, speech — is metered to the same ledger as it happens, whichever surface asked for it.",
  },
  {
    title: "One set of caps",
    copy: "A daily cap per niche and a global daily cap over everything, checked before a call and re-checked after it. Work that would cross a cap is refused, not billed.",
  },
  {
    title: "One balance",
    copy: "Prepaid credit from $5, no subscription and no seats. Credits don't expire, and every feature works on every pack.",
  },
];

export function SharedSpine() {
  return (
    <Section label="What every surface shares">
      <div className="os-split">
        <SectionHead
          eyebrow="One system"
          heading="Fourteen surfaces. One spine."
          highlight="One spine."
          lede="These aren't twenty products stitched together. They share a ledger, a set of caps, an approval gate, and a queue — so turning on another one doesn't mean another bill to watch."
        />
        <MediaCard
          kind="illustration"
          label="System diagram — surfaces over one ledger and cap layer"
        />
      </div>
      <CardGrid className="os-mt-48">
        {SHARED.map((s) => (
          <Card key={s.title}>
            <Title size="sm">{s.title}</Title>
            <Body className="os-mt-8">{s.copy}</Body>
          </Card>
        ))}
      </CardGrid>
      <Frame className="os-qa os-mt-24">
        <Title level={3} size="sm">
          And one gate
        </Title>
        <Body className="os-mt-8 os-measure">
          Nothing has to publish itself. Turn on review for a niche and finished
          work waits for you; leave it off and QA still runs before anything goes
          out.
        </Body>
      </Frame>
    </Section>
  );
}

export function HubStats() {
  return (
    <Section label="The platform by the numbers" size="tight">
      <Stats
        items={[
          { value: "20", label: "features, one login" },
          { value: "$5", label: "smallest prepaid pack, no subscription" },
          { value: "$0", label: "allowed past a tripped cap" },
        ]}
      />
    </Section>
  );
}
