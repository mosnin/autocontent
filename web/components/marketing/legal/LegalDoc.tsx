import * as React from "react";

import { Heading } from "@/components/site/sections";

import { LEGAL_EFFECTIVE } from "./legal-docs";

// A sober, text-first legal document in the site's language: mono effective
// date, the display heading, then hairline-ruled prose. Content stays plain
// h2/h3/p/ul/ol/a — `.os-prose` in sections.css carries all the typography,
// so the document pages stay pure content.
export function LegalDoc({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article className="os-legal">
      <header className="os-legal__header">
        <p className="os-meta">Effective {LEGAL_EFFECTIVE}</p>
        <Heading className="os-mt-16" level={1} size="lg">
          {title}
        </Heading>
        {intro ? <p className="os-lede os-mt-20">{intro}</p> : null}
      </header>

      <div className="os-prose">{children}</div>

      <p className="os-legal__foot">
        Questions about this document? Email{" "}
        <a className="os-link" href="mailto:legal@marketer.sh">
          legal@marketer.sh
        </a>
        .
      </p>
    </article>
  );
}
