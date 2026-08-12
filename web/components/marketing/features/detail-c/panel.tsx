import * as React from "react";

import {
  Body,
  Bullets,
  Frame,
  Section,
  SectionHead,
} from "@/components/site/sections";

/**
 * A corner-ticked panel used to state one limit plainly, on its own, at
 * the end of a run of bands — the shape `detail-b/campaigns-sections`
 * introduced for "a campaign doesn't replace your caps", generalised so
 * the other pipeline pages can make the same kind of statement without
 * copying the markup.
 *
 * Deliberately not a `Band`: there is no media column, and the heading
 * runs one size down so the panel reads as a footnote to the section
 * above it rather than a new chapter.
 */
export function Panel({
  eyebrow,
  heading,
  highlight,
  lede,
  body,
  bullets,
  label,
}: {
  eyebrow?: string;
  heading: string;
  highlight?: string;
  lede?: React.ReactNode;
  body?: React.ReactNode;
  bullets?: React.ReactNode[];
  label?: string;
}) {
  return (
    <Section label={label ?? eyebrow ?? heading} size="tight">
      <Frame className="os-qa">
        <SectionHead
          eyebrow={eyebrow}
          heading={heading}
          highlight={highlight}
          lede={lede}
          size="md"
        />
        {body ? <Body className="os-mt-24 os-measure">{body}</Body> : null}
        {bullets && bullets.length > 0 ? (
          <Bullets className="os-mt-24" items={bullets} />
        ) : null}
      </Frame>
    </Section>
  );
}
