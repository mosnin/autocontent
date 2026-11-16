"use client";

import { Megaphone } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { adsErrorMessage, createCampaign, type AdAccount } from "@/lib/ads-client";
import { Crumbs, PageBody, PageHeader, PageIntro, Panel } from "../page";
import { Button, ButtonLink, Empty, ErrorText, Field, Input, Select } from "../ui";
import { MoneyInput } from "../settings/primitives";
import { accountName, platformLabel } from "./shared";

const OBJECTIVES = ["conversions", "traffic", "awareness", "leads", "app_installs", "sales"];

export function NewCampaignView({ accounts }: { accounts: AdAccount[] }) {
  const router = useRouter();
  const active = accounts.filter((a) => a.status === "active");
  const [accountId, setAccountId] = useState(active[0]?.id ?? "");
  const [name, setName] = useState("");
  const [objective, setObjective] = useState(OBJECTIVES[0]!);
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accountId || !name.trim()) {
      setError("Pick an account and name the campaign.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const camp = await createCampaign({ ad_account_id: accountId, name: name.trim(), objective, daily_budget_usd: budget.trim() || null });
      router.push(`/paid/campaigns/${camp.id}`);
    } catch (err) {
      setError(adsErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader icon={<Megaphone />} title={<Crumbs items={[<Link key="p" href="/paid" className="hover:text-foreground">Paid media</Link>, "New campaign"]} />} />
      <PageBody width="3xl">
        <PageIntro title="Draft a campaign">This creates a draft. Nothing spends until you set a budget and activate it, and both pass the spend guard.</PageIntro>
        {active.length === 0 ? (
          <Empty art="apps" title="Connect an account first" action={<ButtonLink href="/paid/connect" variant="primary">Connect an account</ButtonLink>}>
            Link Google Ads or Meta Ads before creating campaigns.
          </Empty>
        ) : (
          <Panel label="Campaign">
            <form onSubmit={onSubmit} className="space-y-5">
              <Field label="Ad account">
                <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {active.map((a) => (
                    <option key={a.id} value={a.id}>
                      {platformLabel(a.platform)} · {accountName(a)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Campaign name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring launch, prospecting" required />
              </Field>
              <Field label="Objective">
                <Select value={objective} onChange={(e) => setObjective(e.target.value)} className="capitalize">
                  {OBJECTIVES.map((o) => (
                    <option key={o} value={o}>
                      {o.replace("_", " ")}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Intended daily budget (optional)" hint="Stored on the draft. It only takes effect, and only within your account caps, when you activate.">
                <div className="w-40">
                  <MoneyInput value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="20.00" />
                </div>
              </Field>
              <ErrorText error={error} />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => router.push("/paid")} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={busy}>
                  Create draft
                </Button>
              </div>
            </form>
          </Panel>
        )}
      </PageBody>
    </>
  );
}
