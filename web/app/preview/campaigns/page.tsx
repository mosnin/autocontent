"use client";

// Unauthenticated visual preview of the Campaigns landing (mock data),
// for design review screenshots only.

import * as React from "react";

import { CampaignsClient } from "@/app/(app)/campaigns/CampaignsClient";
import { SiteShell } from "@/components/site-shell";
import type { Campaign } from "@/lib/types";

const MOCK: Campaign[] = [
  {
    id: "c1",
    name: "Spring launch",
    status: "running",
    budget_usd: "50.00",
    objective: "Drive signups for the summer launch",
    ends_at: "2026-08-01T00:00:00Z",
  },
  {
    id: "c2",
    name: "Evergreen SEO",
    status: "running",
    budget_usd: "120.00",
    objective: "Own the buying-guide keywords",
    ends_at: null,
  },
  {
    id: "c3",
    name: "UGC push",
    status: "completed",
    budget_usd: "25.00",
    objective: "",
    ends_at: null,
  },
] as unknown as Campaign[];

function AvatarStub() {
  return (
    <span className="flex size-8 items-center justify-center rounded-full bg-zinc-900 text-[12px] font-semibold text-white">
      M
    </span>
  );
}

export default function PreviewCampaignsPage() {
  return (
    <SiteShell account={<AvatarStub />}>
      <CampaignsClient initial={MOCK} niches={[]} />
    </SiteShell>
  );
}
