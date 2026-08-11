import * as React from "react";

import { LEGAL_EFFECTIVE } from "./legal-docs";

// A sober, text-first legal document. Generous measure + rhythm, hairline
// section rules, zero decorative icons. Content is plain h2/h3/p/ul/ol/a; the
// child selectors here carry all the typography so pages stay pure content.
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
    <article className="max-w-2xl">
      <header className="mb-10">
        <p className="text-sm text-muted-foreground">
          Effective {LEGAL_EFFECTIVE}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
        {intro ? (
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            {intro}
          </p>
        ) : null}
      </header>

      <div
        className={[
          "text-[15px] leading-7 text-foreground/90",
          "[&>h2]:mt-12 [&>h2]:mb-3 [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:tracking-tight [&>h2]:text-foreground",
          "[&>h3]:mt-8 [&>h3]:mb-2 [&>h3]:text-base [&>h3]:font-semibold [&>h3]:text-foreground",
          "[&>p]:mt-4",
          "[&>ul]:mt-4 [&>ul]:space-y-2 [&>ul]:pl-5 [&>ul]:list-disc [&>ul]:marker:text-muted-foreground",
          "[&>ol]:mt-4 [&>ol]:space-y-2 [&>ol]:pl-5 [&>ol]:list-decimal [&>ol]:marker:text-muted-foreground",
          "[&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_a]:decoration-border hover:[&_a]:decoration-foreground",
          "[&_strong]:font-semibold [&_strong]:text-foreground",
          "[&>h2:first-child]:mt-0",
        ].join(" ")}
      >
        {children}
      </div>

      <p className="mt-14 border-t border-border/60 pt-6 text-sm text-muted-foreground">
        Questions about this document? Email{" "}
        <a
          href="mailto:legal@marketer.sh"
          className="font-medium text-foreground underline underline-offset-4"
        >
          legal@marketer.sh
        </a>
        .
      </p>
    </article>
  );
}
