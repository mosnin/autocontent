import type { Metadata } from "next";

import {
  ServicePage,
  serviceMetadata,
} from "@/components/marketing/service-page";

export const metadata: Metadata = serviceMetadata("ad-studio");

export default function AdStudioPage() {
  return <ServicePage slug="ad-studio" />;
}
