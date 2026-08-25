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

/* ------------------------------------------------------------------ */
/* What a campaign is                                                  */
/* ------------------------------------------------------------------ */

export function CampaignAnatomy() {
  return (
    <Band
      bullets={[
        "A name, an optional objective, and a credit budget in dollars.",
        "An optional end date. Leave it off and the budget is the only limit.",
        "Draft, running, paused, completed. You start it and you can pause it.",
      ]}
      eyebrow="Anatomy"
      heading="A budget, a window, and the lanes it runs."
      highlight="the lanes it runs."
      label="What a campaign is"
      lede="A campaign is the object that holds a push together. You give it a budget of generation credits and a window; it holds the lanes that spend them and rolls up everything they produce."
      media={
        <MediaCard
          kind="image"
          label="Campaign detail - budget progress and lane list"
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Lanes                                                               */
/* ------------------------------------------------------------------ */

const LANES = [
  {
    kicker: "Video content",
    title: "A niche, on cadence",
    copy: "Points at one of your niches and spawns pipeline runs against it. Each run inherits that niche's platforms, and the runner rotates through them so every social gets coverage instead of one taking all of it.",
  },
  {
    kicker: "SEO articles",
    title: "Long-form, same brief",
    copy: "Points at a niche and spawns articles at the cadence you set. Same research-and-QA pipeline as a standalone article, just attributed to this campaign.",
  },
  {
    kicker: "Linked ad campaign",
    title: "Reporting, not control",
    copy: "Paste an ad campaign id and it joins the view, so one screen shows the whole push. Its lifecycle stays in the governed ads layer - nothing in a campaign can move ad money.",
  },
];

export function LaneCards() {
  return (
    <Section label="Campaign lanes">
      <div className="os-split">
        <SectionHead
          eyebrow="Lanes"
          heading="Three kinds of lane. One push."
          highlight="One push."
          lede="A lane is a piece of work the campaign keeps doing: which niche, which kind of output, how many per week. Add as many as the push needs."
        />
        <MediaCard
          kind="illustration"
          label="Lane diagram - video, article, and linked ad lanes"
        />
      </div>
      <CardGrid className="os-mt-48">
        {LANES.map((lane) => (
          <Card key={lane.kicker}>
            <p className="os-meta">{lane.kicker}</p>
            <Title className="os-mt-12" size="sm">
              {lane.title}
            </Title>
            <Body className="os-mt-8">{lane.copy}</Body>
          </Card>
        ))}
      </CardGrid>
      <div className="os-actions os-mt-32">
        {["1–56 per week", "Turn a lane off", "Remove a lane"].map((c) => (
          <Chip key={c}>{c}</Chip>
        ))}
      </div>
      <Body className="os-mt-16 os-measure">
        Turning a lane off leaves it in place and stops its work. Removing it
        deletes the lane, not the pieces it already produced.
      </Body>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* The hourly tick                                                     */
/* ------------------------------------------------------------------ */

const TICK = [
  {
    title: "Check the window and the budget",
    copy: "Past the end date, or with spend at or over the budget, the campaign flips to completed and stops spawning. A campaign scheduled to start later simply waits.",
  },
  {
    title: "Pace each lane",
    copy: "A lane targets so many pieces per week, and the work is spread across the week rather than front-loaded - a gap of 168 hours divided by the cadence between spawns. The weekly count is a hard stop.",
  },
  {
    title: "Attribute everything",
    copy: "Every job and article the runner spawns carries the campaign id, so cost and output roll up on their own. No tagging, no spreadsheet.",
  },
];

export function TickBand() {
  return (
    <Section label="The campaign runner">
      <SectionHead
        eyebrow="The runner"
        heading="It wakes up every hour and does the arithmetic."
        highlight="every hour"
        lede="You don't schedule the individual pieces. An hourly pass looks at every running campaign, decides what is due, and spawns only that."
      />
      <ol className="os-steps os-mt-48">
        {TICK.map((step, i) => (
          <li className="os-step" key={step.title}>
            <span className="os-step__n">{i + 1}</span>
            <Title className="os-mt-20" size="sm">
              {step.title}
            </Title>
            <Body className="os-mt-8 os-measure">{step.copy}</Body>
          </li>
        ))}
      </ol>
      <div className="os-callout">
        <Body bright>
          One broken campaign can&apos;t stall the fleet: a failure inside one
          campaign&apos;s tick is contained and logged, and the pass moves on to
          the next.
        </Body>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Budget                                                              */
/* ------------------------------------------------------------------ */

export function BudgetBand() {
  return (
    <Band
      bullets={[
        "The budget covers generation credits - the videos and articles this campaign makes.",
        "Ad platform spend is governed separately, by the ads layer's own fail-closed guard.",
        "Completion is automatic: the budget or the end date, whichever lands first.",
      ]}
      eyebrow="Budget"
      extraCopy="Spend that hasn't reached the ledger yet is still counted. Before spawning, the runner adds an estimate for every piece already in flight, so lanes can't collectively overshoot while the meter catches up."
      flip
      heading="It stops at the number you wrote down."
      highlight="the number you wrote down."
      label="Campaign budget"
      lede="Progress against the budget is on the campaign screen: dollars spent, dollars allowed, videos and articles produced. When spend reaches the budget the campaign completes itself."
      media={
        <MediaCard
          kind="image"
          label="Budget progress - spent against campaign budget"
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Where it sits                                                       */
/* ------------------------------------------------------------------ */

export function CampaignContext() {
  return (
    <Section label="How campaigns relate to the rest">
      <Frame className="os-qa">
        <SectionHead
          eyebrow="On top of everything else"
          heading="A campaign doesn't replace your caps. It sits inside them."
          highlight="inside them."
          lede="Every piece a campaign spawns is an ordinary pipeline run: the niche's daily cap applies, your global daily cap applies, your prepaid balance applies, and an approval gate - if that niche has one - still holds the post."
          size="md"
        />
        <Body className="os-mt-24 os-measure">
          So the budget is a ceiling on this push, not a way around the ceilings
          you already set.
        </Body>
      </Frame>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export function CampaignStats() {
  return (
    <Section label="Campaigns by the numbers" size="tight">
      <Stats
        items={[
          { value: "Hourly", label: "pass over every running campaign" },
          { value: "3", label: "lane types: video, articles, linked ads" },
          { value: "1–56", label: "pieces per week, per lane" },
        ]}
      />
    </Section>
  );
}
