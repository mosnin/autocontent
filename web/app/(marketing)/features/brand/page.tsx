import type { Metadata } from "next";

import {
  ServicePage,
  serviceMetadata,
} from "@/components/marketing/service-page";

export const metadata: Metadata = serviceMetadata("brand");

export default function BrandKitPage() {
  return <ServicePage slug="brand" />;
}
