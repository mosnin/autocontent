"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button, ButtonLink, Card, Column, EmptyLine, Field, Input, MoneyInput, Notice, PageHeader, Select } from "@/design-system";
import { adsErrorMessage, createCampaign, type AdAccount } from "@/lib/ads-client";
import { accountName, platformLabel } from "./shared";

const OBJECTIVES = ["conversions", "traffic", "awareness", "leads", "app_installs", "sales"];

/** Draft a campaign (README §5 form, Column md). Drafts never spend. */
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
      <PageHeader crumbs={[{ label: "Paid media", href: "/paid" }, { label: "New campaign" }]} />
      <Column width="md" title="New campaign" description="Creates a draft. Nothing spends until you activate it, and activation passes your caps and approvals.">
        {active.length === 0 ? (
          <EmptyLine
            action={
              <ButtonLink href="/paid/connect" variant="primary">
                Connect an account
              </ButtonLink>
            }
          >
            Connect Google Ads or Meta Ads first.
          </EmptyLine>
        ) : (
          <Card className="p-4 sm:p-5">
            <form onSubmit={onSubmit} className="space-y-4">
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
              <Field label="Daily budget (optional)" hint="Saved on the draft. It applies only when you activate, and only within your account caps.">
                <div className="w-40">
                  <MoneyInput value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="20.00" />
                </div>
              </Field>
              <Notice error={error} />
              <div className="flex justify-end gap-1.5 border-t border-hairline pt-4">
                <Button variant="ghost" onClick={() => router.push("/paid")} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={busy}>
                  Create draft
                </Button>
              </div>
            </form>
          </Card>
        )}
      </Column>
    </>
  );
}
