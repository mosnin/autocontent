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
  Title,
} from "@/components/site/sections";
import { VignetteCard } from "@/components/marketing/system";

import { StageMedia } from "../stage-media";

/* ------------------------------------------------------------------ */
/* Four shelves                                                        */
/* ------------------------------------------------------------------ */

const SHELVES = [
  {
    title: "Final videos",
    description:
      "Every publish-grade render the pipeline has finished, newest first, playable in place.",
    scene: "sky" as const,
    kind: "video" as const,
    label: "Final videos shelf — finished renders",
  },
  {
    title: "Clips",
    description:
      "Each individual scene, saved automatically as it renders. The raw material for a recut.",
    scene: "pearl" as const,
    kind: "video" as const,
    label: "Clips shelf — individual scene renders",
  },
  {
    title: "Images",
    description:
      "Keyframes, carousel slides, and template remixes — every still the platform has made for you.",
    scene: "mist" as const,
    kind: "image" as const,
    label: "Images shelf — keyframes and remixes",
  },
  {
    title: "Remixes",
    description:
      "Recuts you assembled from clips, with their render status and an inline preview when they finish.",
    scene: "dusk" as const,
    kind: "video" as const,
    label: "Remixes shelf — composition status list",
  },
];

export function ShelvesSection() {
  return (
    <Section label="The four shelves">
      <div className="os-split">
        <SectionHead
          eyebrow="One place"
          heading="Everything it has ever made for you."
          highlight="ever made for you."
          lede="Nothing lives only inside the job that produced it. Finished videos, the scenes they were cut from, every still, and every recut sit on four shelves you can filter by niche."
        />
        <MediaCard kind="image" label="Library — shelves and niche filter" />
      </div>
      <CardGrid className="os-mt-48" cols={2}>
        {SHELVES.map((s) => (
          <VignetteCard
            description={s.description}
            key={s.title}
            scene={s.scene}
            title={s.title}
            vignette={<StageMedia kind={s.kind} label={s.label} />}
          />
        ))}
      </CardGrid>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Recut                                                               */
/* ------------------------------------------------------------------ */

export function RecutBand() {
  return (
    <Band
      bullets={[
        "Select clips in the order you want them. The number on each one is its place in the cut.",
        "Name it if you like, then queue it — the stitch happens server-side, not in your browser.",
        "Queued, rendering, done. Finished recuts play inline and join the shelves.",
      ]}
      eyebrow="Recut"
      flip
      heading="Reassemble scenes into something new."
      highlight="into something new."
      label="Clip recuts"
      lede="A scene that worked in one video can carry another. Pick any set of clips across your runs and stitch them into a fresh video — a straight concatenation, so nothing is regenerated and no model is called."
      media={
        <MediaCard
          kind="image"
          label="Clip selection — building a recut in order"
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Image posts                                                         */
/* ------------------------------------------------------------------ */

export function ImageOpsSection() {
  return (
    <Section label="Image runs">
      <SectionHead
        eyebrow="Work in progress"
        heading="The runs that aren't finished show up too."
        highlight="show up too."
        lede="Carousels and stills being produced appear above the grid with their live status, so the shelf doubles as the control surface for the work still in flight."
      />
      <CardGrid className="os-mt-48">
        <Card>
          <Title size="sm">Approve and post</Title>
          <Body className="os-mt-8">
            An image run waiting on review is approved right here, and goes out
            from the same row.
          </Body>
        </Card>
        <Card>
          <Title size="sm">Retry a failure</Title>
          <Body className="os-mt-8">
            A failed run shows its error and offers a retry, instead of
            disappearing without explanation.
          </Body>
        </Card>
        <Card>
          <Title size="sm">Then it steps aside</Title>
          <Body className="os-mt-8">
            Once a run is done it drops out of the strip and its output is just
            another asset on the shelf.
          </Body>
        </Card>
      </CardGrid>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Storage and tenancy                                                 */
/* ------------------------------------------------------------------ */

export function StorageSection() {
  return (
    <Section label="Storage and access">
      <SectionHead
        eyebrow="Underneath"
        heading="Yours, and only listed once."
        highlight="only listed once."
        lede="The library is strictly per-tenant: every query is scoped to your account, and playback is streamed through the platform rather than by handing out a permanent public link."
      />
      <CardGrid className="os-mt-48">
        <Card>
          <Title size="sm">No duplicate rows</Title>
          <Body className="os-mt-8">
            An asset is keyed by where it is stored, so a pipeline stage that
            resumes after a restart updates its entry instead of adding a second
            copy of the same file.
          </Body>
        </Card>
        <Card>
          <Title size="sm">No double renders</Title>
          <Body className="os-mt-8">
            A recut is claimed atomically before it renders, so a
            double-spawned worker can&apos;t produce the same composition twice.
          </Body>
        </Card>
        <Card>
          <Title size="sm">Filter by niche</Title>
          <Body className="os-mt-8">
            Every shelf narrows to one niche, which is how you find the three
            clips from that channel instead of scrolling everything.
          </Body>
        </Card>
      </CardGrid>
      <Frame className="os-qa os-mt-24">
        <Title level={3} size="sm">
          There is no seat to lose access from
        </Title>
        <Body className="os-mt-8 os-measure">
          Credit is prepaid and doesn&apos;t expire, and there is no
          subscription to lapse. Buy five dollars of credit in January, render
          in June, and the library is still yours to browse.
        </Body>
      </Frame>
    </Section>
  );
}
