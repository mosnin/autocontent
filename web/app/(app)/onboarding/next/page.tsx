import Link from "next/link";

import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

async function connected(): Promise<boolean | null> {
  try {
    const res = await api<{ connected: boolean }>("/api/v1/connect/ayrshare/status");
    return Boolean(res?.connected);
  } catch {
    return null;
  }
}

async function billing(): Promise<{ enabled: boolean; balance: string } | null> {
  try {
    const res = await api<{ billing_enabled: boolean; balance_usd: string }>(
      "/api/v1/billing/balance",
    );
    return { enabled: Boolean(res.billing_enabled), balance: res.balance_usd };
  } catch {
    return null;
  }
}

export default async function OnboardingNext() {
  const [social, bill] = await Promise.all([connected(), billing()]);
  return (
    <div className="mx-auto max-w-xl space-y-8 py-10">
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.28em] text-muted-foreground">
          Channel created
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Two more steps before the first run
        </h1>
        <p className="mt-3 text-muted-foreground">
          Generation spends prepaid credit. Publishing needs a connected
          social profile. Do both now so the first video can actually ship.
        </p>
      </div>

      <ol className="space-y-4">
        <li className="rounded-xl border border-border/70 bg-card p-5">
          <p className="text-sm font-medium">1. Add credits</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {bill?.enabled
              ? `Current balance $${bill.balance}. Buy a $5 pack to generate.`
              : "Billing is off on this deploy — skip if you run on operator keys."}
          </p>
          <Link
            className="mt-3 inline-flex text-sm font-medium underline underline-offset-4"
            href="/settings/billing"
          >
            Open billing
          </Link>
        </li>
        <li className="rounded-xl border border-border/70 bg-card p-5">
          <p className="text-sm font-medium">2. Connect a social</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {social
              ? "Ayrshare profile is already created. Finish linking TikTok or Reels in the popup if you have not."
              : "Create an Ayrshare profile and link TikTok or Instagram Reels."}
          </p>
          <Link
            className="mt-3 inline-flex text-sm font-medium underline underline-offset-4"
            href="/connect"
          >
            Connect socials
          </Link>
        </li>
      </ol>

      <p className="text-sm text-muted-foreground">
        Ready?{" "}
        <Link className="font-medium text-foreground underline underline-offset-4" href="/dashboard">
          Go to the dashboard
        </Link>
        .
      </p>
    </div>
  );
}
