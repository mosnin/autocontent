import type { Metadata } from "next";

import { HomeBody } from "@/components/site";
import { HomeShowcase } from "@/components/site/media";


const DESCRIPTION =
  "Prepaid credits, a niche, and a daily cap. marketer.sh generates short-form video and SEO articles, parks them for approval, then schedules to the socials you connected."

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
      <HomeBody />
      {/* The generated body can't be hand-edited, so the showcase band is
          appended here. It is built from the shared section primitives and
          reads as another band of the same page. Its contents come from
          `components/site/media/showcase.config.ts`. */}
      <HomeShowcase />
    </>
  );
}
