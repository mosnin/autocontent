import Link from "next/link";
import type { Metadata } from "next";

import { LEGAL_DOCS, LEGAL_EFFECTIVE } from "@/components/marketing/legal/legal-docs";

export const metadata: Metadata = {
  title: "Legal · marketer.sh",
  description: "Terms, privacy, and the policies that govern marketer.sh.",
};

export default function LegalIndexPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Legal</h1>
      <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
        The agreements and policies that govern marketer.sh. Everything here was
        last revised {LEGAL_EFFECTIVE}.
      </p>

      <ul className="mt-12 divide-y divide-border/60 border-t border-border/60">
        {LEGAL_DOCS.map((doc) => (
          <li key={doc.slug}>
            <Link
              href={`/legal/${doc.slug}`}
              className="group flex flex-col gap-1 py-5 transition-colors"
            >
              <span className="font-medium underline-offset-4 group-hover:underline">
                {doc.title}
              </span>
              <span className="text-sm text-muted-foreground">{doc.blurb}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
