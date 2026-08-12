import type { Metadata } from "next";

import { Note } from "@/components/marketing/features/detail-a/note";
import { SpecCards } from "@/components/marketing/features/detail-a/spec-cards";
import { FeatureHero } from "@/components/marketing/features/feature-hero";
import { SectionCta } from "@/components/marketing/system";
import {
  Band,
  MediaCard,
  Section,
  SectionHead,
  Stats,
} from "@/components/site/sections";

const DESCRIPTION =
  "Write the script, attach the product shots it references, pick a model, and get a vertical spokesperson ad. Every control comes from the model's own capability list, and the price is shown before the render runs.";

export const metadata: Metadata = {
  title: "UGC studio — marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "UGC studio — marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/features/ugc" },
};

/** Straight from the studio's model catalog — capabilities as declared. */
const MODELS = [
  {
    name: "Grok Video",
    chips: ["xAI", "6–30s", "480p / 720p"],
    copy: "Content modes (fun, normal, spicy) make it strong for high-CTR hooks.",
  },
  {
    name: "Veo 3.1",
    chips: ["Google", "8s fixed", "720p–4K"],
    copy: "High-fidelity motion and lighting. The premium option, and it renders a fixed eight seconds.",
  },
  {
    name: "Happy Horse 1",
    chips: ["3–15s", "no res knob"],
    copy: "Fast, lifelike animation — the cheap option for batch iteration. Its output size is fixed by the endpoint.",
  },
  {
    name: "Seedance 2",
    chips: ["ByteDance", "4–15s"],
    copy: "Character-reference support and multi-shot generation, the best fit for multi-image scripts.",
  },
  {
    name: "Seedance 2.5 · text",
    chips: ["prompt only"],
    copy: "Prompt-only clips with strong camera-direction adherence.",
  },
  {
    name: "Seedance 2.5 · image",
    chips: ["1 image"],
    copy: "Animates one keyframe while holding its subject and style.",
  },
  {
    name: "Seedance 2.5 · frames",
    chips: ["2 images"],
    copy: "Interpolates a transition between exactly two frames.",
  },
  {
    name: "Seedance 2.5 · omni",
    chips: ["references"],
    copy: "Character and style references for shots that have to match something you already have.",
  },
];

export default function UgcFeaturePage() {
  return (
    <main>
      <FeatureHero
        highlight="one vertical ad."
        illustration={
          <MediaCard
            kind="video"
            label="UGC studio — script and product shots to spokesperson ad"
            ratio="16/9"
          />
        }
        kicker="UGC studio"
        lede="Write what the person says, attach the product shots the script points at, pick a model. What comes back is a vertical spokesperson ad, priced before it runs and metered after it lands."
        magneticPrimary
        titleText="A script, a product shot, one vertical ad."
        variant="mist"
      />

      {/* 1 — capability-driven composer */}
      <Band
        bullets={[
          "Durations render as a slider or a fixed set, depending on what the model actually accepts.",
          "Resolution and content mode disappear entirely for models that have no such knob.",
          "Switch models and the studio re-clamps your settings, then says out loud what it changed.",
        ]}
        eyebrow="The composer"
        extraCopy="One registry drives both the controls you see and the validation that runs server-side, so the form can never hold a combination the backend would reject."
        heading="Every control is the model's own capability, not a guess."
        highlight="not a guess."
        label="The composer"
        lede="Each model declares which aspect ratios, durations, resolutions and content modes it takes. The composer is built from that declaration, and the API refuses anything outside it before a cent is spent."
        media={
          <MediaCard
            kind="image"
            label="Composer — model capabilities as controls"
          />
        }
      />

      {/* 2 — model catalog */}
      <Section label="The model catalog">
        <SectionHead
          eyebrow="The catalog"
          heading="Eight routes, two providers, one order of operations."
          highlight="one order of operations."
          lede="Whichever route you pick, the flow is identical: validate what you supplied, check it against your caps and your credit, submit, then write the ledger only once the gateway has accepted the job."
        />
        <SpecCards className="os-mt-48" cols={4} items={MODELS} />
        <Note title="Vertical by default, on purpose.">
          Every model in the studio defaults to 9:16 because this lane exists
          to produce vertical TikTok, Reels and Shorts ads. The wider ratios
          each model allows are still there if you want them.
        </Note>
      </Section>

      {/* 3 — reference images */}
      <Band
        bullets={[
          "Attach up to seven reference images; a route that takes exactly one keyframe accepts exactly one.",
          "Point at them inline as @image1, @image2 — one-based, in upload order.",
          "A token that points at an image you haven't attached is caught in the composer, not in the render.",
        ]}
        eyebrow="Reference images"
        flip
        heading="Say @image1 and mean it."
        highlight="@image1"
        label="Reference images"
        lede="Attaching any image switches the render to image-to-video. With none attached it is text-to-video and the script is mandatory — which is exactly the rule the server enforces too."
        media={
          <MediaCard
            kind="image"
            label="Script with @image tokens and attached product shots"
          />
        }
      />

      {/* 4 — money */}
      <Band
        bullets={[
          "The estimate is the model's per-second rate times the duration you chose — shown before you submit.",
          "Checked against the niche's daily cap, your global daily cap, and your prepaid credit.",
          "The ledger is written after the provider accepts the job, so a render you never got is a render you never bought.",
        ]}
        eyebrow="Metering"
        heading="You see the price before the render, and the ledger after."
        highlight="before the render"
        label="Metering"
        lede="There is no second currency here. Renders draw down the same prepaid balance as everything else in the product, against the same caps, on the same ledger."
        media={
          <MediaCard
            kind="illustration"
            label="Cost estimate, caps, and the spend ledger"
          />
        }
      />

      {/* 5 — the shelf */}
      <Section label="The render shelf">
        <SectionHead
          eyebrow="The render shelf"
          heading="Queued, rendering, done — and nothing polling a finished page."
          highlight="nothing polling"
          lede="Finished renders play inline at their own aspect, with the model, the parameters and the exact cost on the card. The shelf refreshes only while something is actually in flight; a failed render can be retried, and anything can be deleted."
        />
        <div className="os-mt-48">
          <MediaCard
            kind="image"
            label="Render shelf — statuses, parameters, and cost per render"
            ratio="16/8"
          />
        </div>
      </Section>

      <Section label="UGC by the numbers" size="tight">
        <Stats
          items={[
            { value: "8", label: "models and routes in the catalog" },
            { value: "7", label: "reference images per render" },
            { value: "9:16", label: "default aspect on every model" },
          ]}
        />
      </Section>

      <SectionCta
        headline="Write one script. See what it looks like said out loud."
        highlight="said out loud."
        kicker="Get started"
        sub="Pick the cheap model first, iterate on the script, then re-render the winner on the premium one."
      />
    </main>
  );
}
