import * as React from "react";

import {
  Band,
  Body,
  Card,
  CardGrid,
  Frame,
  MediaCard,
  Section,
  SectionHead,
  Stats,
  Title,
} from "@/components/site/sections";

/* ------------------------------------------------------------------ */
/* What a template is                                                  */
/* ------------------------------------------------------------------ */

export function TemplateAnatomy() {
  return (
    <Band
      bullets={[
        "A reference image, so you can see the look before you spend anything.",
        "The exact prompt that produces it - shown, not hidden behind a preset name.",
        "A kind: image, carousel, or video. Each is used a little differently.",
      ]}
      eyebrow="Anatomy"
      heading="A look you can borrow, prompt included."
      highlight="prompt included."
      label="What a template is"
      lede="Templates are curated and published for everyone - a shelf of finished aesthetics rather than a blank prompt box. Each one carries the reference it was made from and the words that made it."
      media={
        <MediaCard
          kind="image"
          label="Template card - reference image, name, and kind"
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Remix                                                               */
/* ------------------------------------------------------------------ */

const REMIX = [
  {
    title: "Pick the look",
    copy: "Choose a template from the shelf. Its reference image is the aesthetic you are asking for: the lighting, the composition, the type treatment.",
  },
  {
    title: "Add your product",
    copy: "Attach a photo of the thing you actually sell. Optional - without one you get the template's own subject, with one you get yours.",
  },
  {
    title: "Both references, one prompt",
    copy: "The image model receives the template shot and your product together with the template's prompt, instructed to swap the featured subject for yours and keep the aesthetic, lighting, composition, and typography identical.",
  },
];

export function RemixSection() {
  return (
    <Section label="How a remix works">
      <div className="os-split">
        <SectionHead
          eyebrow="Remix"
          heading="Their aesthetic. Your product."
          highlight="Your product."
          lede="Remix is the whole feature: one upload, one click, and a couple of images that look like the reference but sell the thing you make."
        />
        <MediaCard
          kind="illustration"
          label="Remix diagram - template plus product to output"
        />
      </div>
      <ol className="os-steps os-mt-48">
        {REMIX.map((r, i) => (
          <li className="os-step" key={r.title}>
            <span className="os-step__n">{i + 1}</span>
            <Title className="os-mt-20" size="sm">
              {r.title}
            </Title>
            <Body className="os-mt-8 os-measure">{r.copy}</Body>
          </li>
        ))}
      </ol>
      <div className="os-callout">
        <Body bright>
          If your upload can&apos;t be read, the run fails and says so. It will
          not quietly hand you template-only images and charge you for them.
        </Body>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Where the output goes                                               */
/* ------------------------------------------------------------------ */

export function OutputBand() {
  return (
    <Band
      bullets={[
        "Two images per remix by default, four at most in one run.",
        "Each lands in the library titled after the template it came from.",
        "From there they behave like any other asset you've produced.",
      ]}
      eyebrow="Where it lands"
      flip
      heading="Straight into your library."
      highlight="your library."
      label="Remix output"
      lede="Remixes are queued, not blocking. Start one, keep working, and check the Images shelf of the library a minute later."
      media={
        <MediaCard kind="image" label="Library images - remix results" />
      }
      cta={{ label: "See the library", href: "/features/library" }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Video templates + honesty                                           */
/* ------------------------------------------------------------------ */

export function TemplateNotes() {
  return (
    <Section label="Templates in practice">
      <SectionHead
        eyebrow="Two ways to use one"
        heading="Remix it, or read it and steal the direction."
        highlight="steal the direction."
        lede="Image and carousel templates remix in place. Video templates work differently: the prompt is the deliverable, and it goes into a niche's visual style so every future video in that niche wears the look."
      />
      <CardGrid className="os-mt-48">
        <Card>
          <Title size="sm">Image and carousel</Title>
          <Body className="os-mt-8">
            Upload, remix, done. The output is a still you can post, hand to an
            ad, or drop into a carousel.
          </Body>
        </Card>
        <Card>
          <Title size="sm">Video</Title>
          <Body className="os-mt-8">
            Copy the prompt into a niche&apos;s visual style. The whole pipeline
            then renders in that look, scene after scene.
          </Body>
        </Card>
        <Card>
          <Title size="sm">Curated, not crowdsourced</Title>
          <Body className="os-mt-8">
            The shelf is published deliberately. If it is empty on your
            deployment, nothing has been published yet - not a broken screen.
          </Body>
        </Card>
      </CardGrid>
      <Frame className="os-qa os-mt-24">
        <Title level={3} size="sm">
          What a remix costs
        </Title>
        <Body className="os-mt-8 os-measure">
          Every generated image is metered to the same ledger as everything
          else. A remix belongs to no niche, so a per-niche daily cap does not
          govern it - your global daily cap and your prepaid balance do.
        </Body>
      </Frame>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export function TemplateStats() {
  return (
    <Section label="Templates by the numbers" size="tight">
      <Stats
        items={[
          { value: "2", label: "images per remix by default" },
          { value: "4", label: "images in one run, maximum" },
          { value: "3", label: "kinds: image, carousel, video" },
        ]}
      />
    </Section>
  );
}
