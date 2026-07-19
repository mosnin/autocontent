import type { Metadata } from "next";

import { AutopilotPanel } from "@/components/marketing/home/autopilot-panel";
import { ClosingCta } from "@/components/marketing/home/closing-cta";
import { Converged } from "@/components/marketing/home/converged";
import { Enterprise } from "@/components/marketing/home/enterprise";
import { Hero } from "@/components/marketing/home/hero";
import { LogoBand } from "@/components/marketing/home/logo-band";
import { Loved } from "@/components/marketing/home/loved";
import { Roi } from "@/components/marketing/home/roi";
import { Sprawl } from "@/components/marketing/home/sprawl";
import { SuperAgents } from "@/components/marketing/home/super-agents";
import { Teams } from "@/components/marketing/home/teams";

const DESCRIPTION =
  "The autonomous marketing platform. One brief in, video and SEO articles ideated, produced, published, and improved, with hard caps on every dollar spent.";

export const metadata: Metadata = {
  title: "marketer.sh — Marketing that runs itself",
  description: DESCRIPTION,
  openGraph: {
    title: "marketer.sh — Marketing that runs itself",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/" },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "marketer.sh",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: "https://marketer.sh",
  description: DESCRIPTION,
  offers: {
    "@type": "Offer",
    price: "5.00",
    priceCurrency: "USD",
    description: "Prepaid credit packs from $5. No subscription.",
  },
};

export default function HomePage() {
  return (
    <main>
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        type="application/ld+json"
      />
      <Hero />
      <LogoBand />
      <Sprawl />
      <Converged />
      <SuperAgents />
      <AutopilotPanel />
      <Teams />
      <Roi />
      <Loved />
      <Enterprise />
      <ClosingCta />
    </main>
  );
}
