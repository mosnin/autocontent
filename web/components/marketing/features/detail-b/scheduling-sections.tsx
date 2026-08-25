import * as React from "react";

import {
  Band,
  Body,
  Card,
  CardGrid,
  Chip,
  Frame,
  MediaCard,
  Section,
  SectionHead,
  Stats,
  Title,
} from "@/components/site/sections";
import { VignetteCard } from "@/components/marketing/system";

import { StageMedia } from "../stage-media";

/* ------------------------------------------------------------------ */
/* Posting windows                                                     */
/* ------------------------------------------------------------------ */

export function WindowsBand() {
  return (
    <Band
      bullets={[
        "A window is an hour, a minute, and a named timezone - not an offset.",
        "The scheduler polls every 30 minutes and spawns the runs whose window is about to open.",
        "A niche that already has a live run is skipped, so a delayed tick can't double-enqueue it.",
      ]}
      eyebrow="Posting windows"
      heading="Say when. It produces to meet the slot."
      highlight="to meet the slot."
      label="Posting windows"
      lede="Each niche carries its own posting window and its own platforms. When the slot is close, the pipeline starts a run for it - nobody has to be at the keyboard, and nothing sits waiting on a person."
      media={
        <MediaCard
          kind="illustration"
          label="Posting windows - per-niche slots across a week"
        />
      }
    >
      <div className="os-actions os-mt-8">
        {["Hour", "Minute", "IANA timezone"].map((c) => (
          <Chip key={c}>{c}</Chip>
        ))}
      </div>
    </Band>
  );
}

/* ------------------------------------------------------------------ */
/* Calendar                                                            */
/* ------------------------------------------------------------------ */

export function CalendarBand() {
  return (
    <Band
      bullets={[
        "Videos, articles, and ads in one list - the three things that actually go out.",
        "Look ahead 7, 30, or 90 days. Search, sort, and filter the agenda.",
        "Every row links to the thing itself: the job, the article, the ad campaign.",
      ]}
      eyebrow="The calendar"
      flip
      heading="Everything that is going to happen, on one page."
      highlight="on one page."
      label="The calendar"
      lede="The calendar is the agenda across all three pipelines, resolved to real titles and real niches, refreshed while you watch it. It is the answer to what ships this week."
      media={
        <MediaCard
          kind="image"
          label="Calendar agenda - upcoming videos, articles, and ads"
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Hand-authored posts                                                 */
/* ------------------------------------------------------------------ */

const COMPOSER = [
  {
    title: "Eleven destinations",
    description:
      "Bluesky, Facebook, Instagram, LinkedIn, Pinterest, Reddit, Telegram, Threads, TikTok, X, and YouTube - pick any set for one post.",
    scene: "sky" as const,
    label: "Post composer - platform picker",
  },
  {
    title: "Per-platform copy",
    description:
      "One post, one schedule, and an optional override of the text for any platform that needs its own voice. Up to 5,000 characters and 10 media URLs.",
    scene: "pearl" as const,
    label: "Post composer - per-platform variant override",
  },
  {
    title: "Weekly slots",
    description:
      "Recurring templates like Monday 09:00 in a named zone. Stored as local wall-clock time, so 09:00 stays 09:00 through a daylight-saving change.",
    scene: "mist" as const,
    label: "Recurring slots - weekly posting templates",
  },
];

export function ComposerSection() {
  return (
    <Section label="Hand-authored posts">
      <SectionHead
        eyebrow="Scheduled posts"
        heading="Not everything comes out of a pipeline."
        highlight="out of a pipeline."
        lede="Announcements, one-offs, a link you want out on Thursday. Write it once, choose the platforms, and schedule it in the timezone you are actually thinking in."
      />
      <CardGrid className="os-mt-48">
        {COMPOSER.map((c) => (
          <VignetteCard
            description={c.description}
            key={c.title}
            scene={c.scene}
            title={c.title}
            vignette={<StageMedia kind="image" label={c.label} />}
          />
        ))}
      </CardGrid>
      <div className="os-callout">
        <Body bright>
          Have a backlog? Bulk import from CSV. The import is all or nothing -
          one bad row creates nothing, and the response names the row and the
          reason, so you fix line 7 and upload again instead of hunting for
          duplicates.
        </Body>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Exactly once                                                        */
/* ------------------------------------------------------------------ */

const GUARDS = [
  {
    title: "Claim the post",
    copy: "Selection and claim are a single atomic statement that moves a due post from scheduled to dispatching. Two dispatchers on the same tick cannot both take it; the loser gets nothing.",
  },
  {
    title: "Claim each platform",
    copy: "The same trick per destination. A post that half-landed can be re-dispatched, and only the platforms that never posted are sent again.",
  },
  {
    title: "Hold a durable key",
    copy: "A cross-process key made of post, platform, and scheduled time. It survives restarts and catches the case where the cron loop and the publish-now button arrive at the same instant.",
  },
];

export function ExactlyOnceSection() {
  return (
    <Section label="Publishing safety">
      <div className="os-split">
        <SectionHead
          eyebrow="Publish exactly once"
          heading="Running it twice must not post twice."
          highlight="must not post twice."
          lede="The dispatcher runs every minute, so a due post leaves within a minute of its slot. It is also the only thing here that touches your real accounts, so it is built around one requirement, enforced by three independent guards."
        />
        <MediaCard
          kind="illustration"
          label="Dispatch guards - claim, claim, key"
        />
      </div>
      <ol className="os-steps os-mt-48">
        {GUARDS.map((g, i) => (
          <li className="os-step" key={g.title}>
            <span className="os-step__n">{i + 1}</span>
            <Title className="os-mt-20" size="sm">
              {g.title}
            </Title>
            <Body className="os-mt-8 os-measure">{g.copy}</Body>
          </li>
        ))}
      </ol>
      <Body className="os-mt-32 os-measure">
        Statuses are honest about partial delivery: scheduled, dispatching,
        posted, partial, failed, with a state per platform underneath. A post
        that is already live can&apos;t be edited or deleted here, because we
        can&apos;t recall it there.
      </Body>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Queue + failures                                                    */
/* ------------------------------------------------------------------ */

const QUEUE = [
  {
    title: "The queue",
    copy: "Every pipeline run with its live stage, searchable and filterable by status. Retry a run, approve a finished cut, or reject it, from the row.",
  },
  {
    title: "The failures inbox",
    copy: "Everything that terminally failed across jobs, image posts, and articles, grouped by cause: spend cap, render QA, content QA, provider error, timeout, other. Replay any of them in place.",
  },
  {
    title: "Connected accounts",
    copy: "Publishing runs through an Ayrshare posting profile you create once. Which individual accounts are linked is managed in Ayrshare's own hosted chooser.",
  },
];

export function QueueSection() {
  return (
    <Section label="Queue and failures">
      <SectionHead
        eyebrow="When something goes wrong"
        heading="One place to see it. One button to replay it."
        highlight="One button"
        lede="Scheduling is only as good as its recovery. Failures are collected across every surface and categorized, instead of hiding on the detail page of whatever broke."
      />
      <CardGrid className="os-mt-48">
        {QUEUE.map((q) => (
          <Card key={q.title}>
            <Title size="sm">{q.title}</Title>
            <Body className="os-mt-8">{q.copy}</Body>
          </Card>
        ))}
      </CardGrid>
      <Frame className="os-qa os-mt-24">
        <Title level={3} size="sm">
          The approval gate still applies
        </Title>
        <Body className="os-mt-8 os-measure">
          Turn on review for a niche and its finished cuts wait in the queue for
          you instead of posting on schedule. Turn it off and QA still gates
          every cut before it can go out.
        </Body>
      </Frame>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export function SchedulingStats() {
  return (
    <Section label="Scheduling by the numbers" size="tight">
      <Stats
        items={[
          { value: "11", label: "platforms in the post composer" },
          { value: "3", label: "guards against posting twice" },
          { value: "7/30/90", label: "day look-ahead on the calendar" },
        ]}
      />
    </Section>
  );
}
