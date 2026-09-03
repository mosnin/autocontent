import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Paid Ads is a governance shell until MARKETER_ADS_ENABLED is on and
 * apply_fn is real. Hide the product surface rather than selling a no-op.
 */
export default async function AdsLayout({
  children,
}: {
  children: ReactNode;
}) {
  try {
    const ov = await api<{ enabled?: boolean }>("/api/v1/ads/overview");
    if (!ov?.enabled) redirect("/home");
  } catch {
    redirect("/home");
  }
  return children;
}
