"use client";

// Unauthenticated visual preview of the logged-in shell + home hub, used
// for design review screenshots only (no Clerk, no data). Not linked from
// anywhere in the product.

import * as React from "react";

import { HomeHub } from "@/components/hub/home-hub";
import { SiteShell } from "@/components/site-shell";

function AvatarStub() {
  return (
    <span className="flex size-8 items-center justify-center rounded-full bg-zinc-900 text-[12px] font-semibold text-white">
      M
    </span>
  );
}

export default function PreviewDashPage() {
  return (
    <SiteShell account={<AvatarStub />}>
      <HomeHub />
    </SiteShell>
  );
}
