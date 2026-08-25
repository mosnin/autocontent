import type { Metadata } from "next";

import {
  ServicePage,
  serviceMetadata,
} from "@/components/marketing/service-page";

export const metadata: Metadata = serviceMetadata("headshots");

export default function HeadshotsPage() {
  return <ServicePage slug="headshots" />;
}
