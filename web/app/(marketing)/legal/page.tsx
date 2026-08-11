import Link from "next/link";
import type { Metadata } from "next";

import { Body, Heading, Lede } from "@/components/site/sections";
import {
  LEGAL_DOCS,
  LEGAL_EFFECTIVE,
} from "@/components/marketing/legal/legal-docs";

export const metadata: Metadata = {
  title: "Legal · marketer.sh",
  description: "Terms, privacy, and the policies that govern marketer.sh.",
};

export default function LegalIndexPage() {
  return (
    <div className="os-legal">
      <Heading level={1} size="lg">
        Legal
      </Heading>
      <Lede className="os-mt-20">
        The agreements and policies that govern marketer.sh. Everything here
        was last revised {LEGAL_EFFECTIVE}.
      </Lede>

      <ul className="os-list os-mt-48">
        {LEGAL_DOCS.map((doc) => (
          <li key={doc.slug}>
            <Link className="os-list__link" href={`/legal/${doc.slug}`}>
              <span className="os-list__title">{doc.title}</span>
              <Body>{doc.blurb}</Body>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
