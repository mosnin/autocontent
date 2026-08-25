import * as React from "react";

import {
  Chip,
  MediaCard,
  Section,
  SectionHead,
} from "@/components/site/sections";

export interface Stage {
  label: string;
  copy: string;
  /** Optional mono chip naming the tool or the state the stage produces. */
  tag?: string;
}

/**
 * The numbered production-line list the video page uses, generalised so every
 * pipeline page (dramas, motion, ads governance) states its real stages in
 * the same rhythm: split head with a staged still, then a two-column
 * numbered grid.
 *
 * Same markup vocabulary as `features/video-walkthrough`: `os-stagegrid` +
 * `os-stagecell` + the mono `os-num`. Server component, no JS.
 */
export function StageGrid({
  eyebrow,
  heading,
  highlight,
  lede,
  media,
  stages,
  label,
  id,
}: {
  eyebrow: string;
  heading: string;
  highlight?: string;
  lede?: React.ReactNode;
  /** Media slot label; omit to run the head full width. */
  media?: { kind: "video" | "image" | "illustration"; label: string };
  stages: Stage[];
  label?: string;
  id?: string;
}) {
  const head = (
    <SectionHead
      eyebrow={eyebrow}
      heading={heading}
      highlight={highlight}
      lede={lede}
    />
  );

  return (
    <Section id={id} label={label ?? eyebrow}>
      {media ? (
        <div className="os-split">
          {head}
          <MediaCard kind={media.kind} label={media.label} />
        </div>
      ) : (
        head
      )}
      <ol className="os-stagegrid os-mt-48">
        {stages.map((s, i) => (
          <li className="os-stagecell" key={s.label}>
            <span className="os-num">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <div className="os-stagecell__head">
                <p className="os-title os-title--sm">{s.label}</p>
                {s.tag ? <Chip>{s.tag}</Chip> : null}
              </div>
              <p className="os-body os-mt-8">{s.copy}</p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
