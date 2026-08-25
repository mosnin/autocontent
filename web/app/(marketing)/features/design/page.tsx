import type { Metadata } from "next";

import {
  ServicePage,
  serviceMetadata,
} from "@/components/marketing/service-page";

export const metadata: Metadata = serviceMetadata("design");

export default function DesignAgentPage() {
  return <ServicePage slug="design" />;
}
