import type { Metadata } from "next";

import {
  ServicePage,
  serviceMetadata,
} from "@/components/marketing/service-page";

export const metadata: Metadata = serviceMetadata("queue");

export default function QueuePage() {
  return <ServicePage slug="queue" />;
}
