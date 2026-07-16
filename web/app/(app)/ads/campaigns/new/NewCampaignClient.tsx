"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCampaign, type AdAccount } from "@/lib/ads-client";
import {
  AD_OBJECTIVES,
  adPlatformLabel,
  objectiveLabel,
} from "@/lib/ads-format";

const OBJECTIVES = [...AD_OBJECTIVES];

export function NewCampaignClient({ accounts }: { accounts: AdAccount[] }) {
  const router = useRouter();
  const active = accounts.filter((a) => a.status === "active");
  const [accountId, setAccountId] = React.useState(active[0]?.id ?? "");
  const [name, setName] = React.useState("");
  const [objective, setObjective] = React.useState<string>(OBJECTIVES[0]);
  const [budget, setBudget] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId || !name.trim()) {
      toast.error("Pick an account and name the campaign.");
      return;
    }
    setBusy(true);
    try {
      const camp = await createCampaign({
        ad_account_id: accountId,
        name: name.trim(),
        objective,
        daily_budget_usd: budget.trim() || null,
      });
      toast.success("Draft campaign created");
      router.push(`/ads/campaigns/${camp.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New campaign</h1>
        <p className="text-sm text-muted-foreground">
          This creates a <strong>draft</strong>. Nothing spends until you set a
          budget and activate it. Both pass the spend guard.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="account">Ad account</Label>
              <Select
                value={accountId}
                onValueChange={setAccountId}
                disabled={active.length === 0}
              >
                <SelectTrigger id="account" className="w-full">
                  <SelectValue
                    placeholder={
                      active.length === 0 ? "No active accounts" : "Select an account"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {active.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {adPlatformLabel(a.platform)}:{" "}
                      {a.name || a.external_account_id || a.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="name">Campaign name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Spring launch: prospecting"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="objective">Objective</Label>
              <Select value={objective} onValueChange={setObjective}>
                <SelectTrigger id="objective" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OBJECTIVES.map((o) => (
                    <SelectItem key={o} value={o}>
                      {objectiveLabel(o)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="budget">Intended daily budget (optional)</Label>
              <div className="relative w-40">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="budget"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  className="pl-6 font-mono tabular-nums"
                  placeholder="20.00"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Stored on the draft. It only takes effect, and only within your
                account caps, when you activate.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.push("/ads/campaigns")}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy || active.length === 0}
                isLoading={busy}
              >
                Create draft
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
