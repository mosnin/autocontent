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
/* What a niche holds                                                  */
/* ------------------------------------------------------------------ */

export function NicheAnatomy() {
  return (
    <Band
      bullets={[
        "Identity: a title, a description, who it is for, and the hashtags it posts under.",
        "Shape: target length between 15 and 90 seconds, split across 2 to 12 scenes.",
        "Look and voice: a visual style you can write or pick from presets, and a narrator.",
      ]}
      eyebrow="Anatomy"
      heading="A niche is the brief the machine keeps."
      highlight="the machine keeps."
      label="What a niche holds"
      lede="Everything the pipeline needs to make something that sounds like you lives on the niche: who it is for, what it looks like, how long it runs, what it costs, and when it posts."
      media={
        <MediaCard
          kind="image"
          label="Niche editor - identity, creative, and schedule"
        />
      }
    >
      <div className="os-actions os-mt-8">
        {["15–90s", "2–12 scenes", "Image quality", "Video resolution"].map(
          (c) => (
            <Chip key={c}>{c}</Chip>
          ),
        )}
      </div>
    </Band>
  );
}

/* ------------------------------------------------------------------ */
/* Creative DNA                                                        */
/* ------------------------------------------------------------------ */

const DNA = [
  {
    kicker: "Hooks",
    title: "How it opens",
    copy: "Pick the hook mechanisms you like and paste up to ten hooks you admire. They steer the voice; they are never copied.",
  },
  {
    kicker: "Narrative",
    title: "How it talks",
    copy: "Language, pacing, point of view, and your call-to-action policy - including 'never'. Plus a hard list of topics to avoid.",
  },
  {
    kicker: "Visual",
    title: "How it looks",
    copy: "Camera language, lighting, colour palette, and a never-show list. The visual director gets them on every scene.",
  },
  {
    kicker: "Audio & captions",
    title: "How it sounds and reads",
    copy: "Music on or off with a mood, and caption font, size, colour, position, and whether it shouts in all caps.",
  },
];

export function CreativeDna() {
  return (
    <Section label="Creative DNA">
      <div className="os-split">
        <SectionHead
          eyebrow="Creative DNA"
          heading="Steer it precisely, or leave it alone."
          highlight="or leave it alone."
          lede="Every field here is a lever on the model. Fill in the ones you have an opinion about; the rest fall back to platform defaults, and you can come back and tighten them later."
        />
        <MediaCard
          kind="image"
          label="Creative DNA panel - hooks, narrative, visual, audio"
        />
      </div>
      <CardGrid className="os-mt-48" cols={2}>
        {DNA.map((d) => (
          <Card key={d.kicker}>
            <p className="os-meta">{d.kicker}</p>
            <Title className="os-mt-12" size="sm">
              {d.title}
            </Title>
            <Body className="os-mt-8">{d.copy}</Body>
          </Card>
        ))}
      </CardGrid>
      <Body className="os-mt-32 os-measure">
        There is also a recurring cast: describe your characters once and the
        reference sheet is regenerated on the next run, so the same face fronts
        every video.
      </Body>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Engine room                                                         */
/* ------------------------------------------------------------------ */

const ENGINE = [
  {
    title: "Video model",
    copy: "Choose the renderer. Each option shows its price per rendered second, and anything without a configured key is visibly unavailable rather than silently swapped.",
  },
  {
    title: "Scriptwriter model",
    copy: "Choose who writes. Prices are shown per million tokens in and out, so the trade-off is on screen while you pick.",
  },
  {
    title: "Voice and music",
    copy: "OpenAI TTS or ElevenLabs for narration, with optional style directions passed through verbatim. Music can be library, generated per video, or off.",
  },
  {
    title: "Kits",
    copy: "Attach a design kit and a writing kit so this niche's videos and its articles inherit the same direction system.",
  },
];

export function EngineRoom() {
  return (
    <Section label="Models and kits">
      <SectionHead
        eyebrow="Engine room"
        heading="Pick the models. See the price while you pick."
        highlight="while you pick."
        lede="A niche isn't just taste, it's a bill of materials. The editor shows a live estimated cost per video as you change scenes, quality, resolution, and length."
      />
      <CardGrid className="os-mt-48" cols={2}>
        {ENGINE.map((e) => (
          <Card key={e.title}>
            <Title size="sm">{e.title}</Title>
            <Body className="os-mt-8">{e.copy}</Body>
          </Card>
        ))}
      </CardGrid>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Caps                                                                */
/* ------------------------------------------------------------------ */

export function CapsBand() {
  return (
    <Band
      bullets={[
        "A daily cap per niche, from $0.50 up. One channel can't eat the whole budget.",
        "A global daily cap across every niche, checked the same way.",
        "Prepaid credit is the final gate. No balance, no call - and no invoice to argue with.",
      ]}
      eyebrow="Spend caps"
      extraCopy="It fails closed. A job that trips a cap stops mid-pipeline rather than finishing on money you didn't agree to spend."
      flip
      heading="The cap is checked before the call and again after it."
      highlight="and again after it."
      label="Per-niche spend caps"
      lede="Every provider call asks permission first, and every logged cost is followed by a fresh read of the day's spend from the ledger. That second read is what makes concurrent jobs safe: parallel work for the same niche can't slip past a snapshot taken before any of it landed."
      media={
        <MediaCard
          kind="image"
          label="Niche spend - today against the daily cap"
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* The niche screen                                                    */
/* ------------------------------------------------------------------ */

export function NicheScreen() {
  return (
    <Section label="The niche screen">
      <SectionHead
        eyebrow="What you see per niche"
        heading="Today's spend, the cap, and what it bought."
        highlight="and what it bought."
        lede="Open a niche and the numbers are the headline: spend today against the cap, spend over thirty days, average cost per finished video, and the daily curve underneath."
      />
      <div className="os-mt-48">
        <MediaCard
          kind="image"
          label="Niche detail - spend, character sheet, recent runs"
          ratio="16/8"
        />
      </div>
      <CardGrid className="os-mt-24">
        <Card>
          <Title size="sm">Channel identity</Title>
          <Body className="os-mt-8">
            The generated character sheet every scene is kept consistent with,
            once the first run has produced it.
          </Body>
        </Card>
        <Card>
          <Title size="sm">Recent runs</Title>
          <Body className="os-mt-8">
            The last runs for this niche with their live stage, so a stall is
            obvious without hunting through the global queue.
          </Body>
        </Card>
        <Card>
          <Title size="sm">Performance</Title>
          <Body className="os-mt-8">
            Cost against views per run, so the question &ldquo;is this channel
            worth it&rdquo; has an answer on the same screen as the spend.
          </Body>
        </Card>
      </CardGrid>
      <Frame className="os-qa os-mt-24">
        <Title level={3} size="sm">
          Run as many as you like
        </Title>
        <Body className="os-mt-8 os-measure">
          Each niche is its own self-driving pipeline under its own cap, and
          niches you are done with can be archived rather than deleted. Whether
          finished videos post on schedule or wait for your approval is a
          per-niche switch you can flip any time.
        </Body>
      </Frame>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export function NicheStats() {
  return (
    <Section label="Niches by the numbers" size="tight">
      <Stats
        items={[
          { value: "$0.50", label: "smallest daily cap you can set" },
          { value: "2–12", label: "scenes per video" },
          { value: "15–90s", label: "target length per video" },
        ]}
      />
    </Section>
  );
}
