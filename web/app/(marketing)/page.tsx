import type { Metadata } from "next";

import { HomeBody } from "@/components/site";


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
      <HomeBody />
    </>
  );
}
