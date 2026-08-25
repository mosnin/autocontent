import Link from "next/link";
import type { Metadata } from "next";

import { LEGAL_DOCS, LEGAL_EFFECTIVE } from "@/components/marketing/legal/legal-docs";

export const metadata: Metadata = {
  title: "Legal · marketer.sh",
  description: "Terms, privacy, cookies, refunds, and the other marketer.sh policies.",
};

export default function LegalIndexPage() {
  return (
    <div className="max-w-2xl">
      <h2 className="text-3xl font-medium tracking-tight sm:text-4xl">
        All legal pages
      </h2>
      <p className="text-muted-foreground mt-4 text-lg leading-relaxed">
        Last updated {LEGAL_EFFECTIVE}. Each document is its own page. If you
        need something signed, write{" "}
        <a
          href="mailto:legal@marketer.sh"
          className="text-foreground underline underline-offset-4"
        >
          legal@marketer.sh
        </a>
        .
      </p>

      <ol className="mt-12">
        {LEGAL_DOCS.map((doc, index) => (
          <li key={doc.slug} className="border-border border-t last:border-b">
            <Link
              href={`/legal/${doc.slug}`}
              className="group flex items-baseline gap-6 py-6"
            >
              <span className="text-muted-foreground w-8 shrink-0 font-mono text-xs">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>
                <span className="text-foreground block text-xl font-medium tracking-tight underline-offset-4 group-hover:underline">
                  {doc.title}
                </span>
                <span className="text-muted-foreground mt-2 block text-sm leading-relaxed">
                  {doc.blurb}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
