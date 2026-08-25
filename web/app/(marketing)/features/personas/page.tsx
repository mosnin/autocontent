import type { Metadata } from "next";

import {
  ServicePage,
  serviceMetadata,
} from "@/components/marketing/service-page";

export const metadata: Metadata = serviceMetadata("personas");

export default function PersonasPage() {
  return <ServicePage slug="personas" />;
}
