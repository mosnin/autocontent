import * as React from "react";

import { Body, Chip, Title } from "@/components/site/sections";

export type ChangelogEntry = {
  date: string;
  title: string;
  body: string;
  tags: string[];
};

/**
 * Vertical changelog: the hairline rail with a node per release, a mono
 * date chip, then one surface card per entry. Newest first.
 */
export function ChangelogTimeline({ entries }: { entries: ChangelogEntry[] }) {
  return (
    <div className="os-timeline">
      {entries.map((entry) => (
        <div className="os-rail" key={entry.title}>
          <span aria-hidden className="os-rail__node" />
          <p className="os-meta">{entry.date}</p>
          <div className="os-card os-mt-12">
            <Title level={2}>{entry.title}</Title>
            <Body className="os-mt-8 os-measure">{entry.body}</Body>
            <div className="os-actions os-mt-20">
              {entry.tags.map((tag) => (
                <Chip key={tag}>{tag}</Chip>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
