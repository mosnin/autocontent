import type { Metadata } from "next";

import { AppShowcase } from "@/components/marketing/home/app-showcase";
import { Faq } from "@/components/marketing/home/faq";
import { Features } from "@/components/marketing/home/features";
import { FinalCta } from "@/components/marketing/home/final-cta";
import { Gallery } from "@/components/marketing/home/gallery";
import { Hero } from "@/components/marketing/home/hero";
import { Integrations } from "@/components/marketing/home/integrations";
import { Manifesto } from "@/components/marketing/home/manifesto";
import { Pricing } from "@/components/marketing/home/pricing";
import { Testimonials } from "@/components/marketing/home/testimonials";
import { VideoShowcase } from "@/components/marketing/home/video-showcase";

const DESCRIPTION =
  "An agentic marketing platform. Your AI agent creates videos, SEO articles, and ads for you. You set a budget and review what ships.";

export const metadata: Metadata = {
  title: "marketer.sh · Marketing that just gets made",
  description: DESCRIPTION,
  openGraph: {
    title: "marketer.sh · Marketing that just gets made",
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
      <span id="top" className="sr-only" />
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        type="application/ld+json"
      />
      <main className="flex-1 overflow-x-clip">
        <Hero />
        <VideoShowcase />
        <Manifesto />
        <Features />
        <AppShowcase />
        <Gallery />
        <Integrations />
        <Testimonials />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
    </>
  );
}
