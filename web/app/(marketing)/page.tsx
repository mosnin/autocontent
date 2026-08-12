import type { Metadata } from "next";

import { HomeBodyNoHero } from "@/components/site";
import { SiteHero } from "@/components/site/hero";
import { HomeShowcase } from "@/components/site/media";


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
    <>
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        type="application/ld+json"
      />
      {/* The Framer export's own first <section data-framer-name="Hero"> is
          dropped by the extractor (`HomeBodyNoHero`) and this stands in its
          place, so the two replace rather than stack. Everything below the
          fold is still the generated transcription, unchanged. */}
      <SiteHero />
      <HomeBodyNoHero />
      {/* The generated body can't be hand-edited, so the showcase band is
          appended here. It is built from the shared section primitives and
          reads as another band of the same page. Its contents come from
          `components/site/media/showcase.config.ts`. */}
      <HomeShowcase />
    </>
  );
}
