"use client";

import { Clapperboard, FileText, GalleryHorizontal, Megaphone, Pause, Play, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { formatDate, formatUsd } from "@/lib/format";
import type { PlaybookRef } from "@/lib/business";
import type { CampaignItem, CampaignOverview } from "@/lib/types";
import { Crumbs, PageBody, PageHeader, PageIntro, Panel, SectionTitle } from "../page";
import { Button, ErrorText, Field, IconTile, Input, Select, Switch } from "../ui";
import { ConfirmModal, Meter, proxyFetch } from "../settings/primitives";
import { CampaignStatus } from "./campaigns";

type LaneKind = CampaignItem["kind"] | "image";
const LANE: Record<string, { label: string; icon: ReactNode }> = {
  video: { label: "Videos", icon: <Clapperboard /> },
  image: { label: "Carousels", icon: <GalleryHorizontal /> },
  article: { label: "SEO articles", icon: <FileText /> },
  ad: { label: "Ad campaign", icon: <Megaphone /> },
};

export function DistributionCampaignView({ overview, playbooks, adCampaigns }: { overview: CampaignOverview; playbooks: PlaybookRef[]; adCampaigns: { id: string; name: string }[] }) {
  const router = useRouter();
  const c = overview.campaign;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CampaignItem | null>(null);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      setRemoving(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const spent = Number(overview.spent_usd);
  const budget = Number(c.budget_usd);
  const pct = budget > 0 ? (spent / budget) * 100 : 0;
  const pbName = (id: string) => playbooks.find((n) => n.id === id)?.title ?? id.slice(0, 8);
  const adName = (id: string) => adCampaigns.find((a) => a.id === id)?.name ?? `Ad campaign ${id.slice(0, 8)}`;

  return (
    <>
      <PageHeader icon={<Send />} title={<Crumbs items={[<Link key="d" href="/distribution" className="hover:text-foreground">Distribution</Link>, c.name]} />}>
        {c.status !== "running" && c.status !== "completed" && (
          <Button size="sm" variant="primary" loading={busy === "start"} disabled={busy !== null} onClick={() => void act("start", () => proxyFetch(`/api/v1/campaigns/${c.id}/start`, "POST"))}>
            <Play /> Start
          </Button>
        )}
        {c.status === "running" && (
          <Button size="sm" loading={busy === "pause"} disabled={busy !== null} onClick={() => void act("pause", () => proxyFetch(`/api/v1/campaigns/${c.id}/pause`, "POST"))}>
            <Pause /> Pause
          </Button>
        )}
      </PageHeader>
      <PageBody width="4xl">
        <PageIntro
          title={
            <span className="inline-flex flex-wrap items-center gap-2.5">
              {c.name} <CampaignStatus status={c.status} />
            </span>
          }
        >
          {c.objective || "No objective yet."}
        </PageIntro>

        <div className="t-stagger space-y-6">
          <ErrorText error={error} />
          <Panel label="Budget">
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[22px] font-medium tracking-[-0.02em] tabular">
                  {formatUsd(spent)} <span className="text-[14px] font-normal text-muted-foreground">of {formatUsd(budget)}</span>
                </span>
                <span className="text-[13px] text-muted-foreground">{c.ends_at ? `Ends ${formatDate(c.ends_at)}` : "No end date"}</span>
              </div>
              <Meter value={pct} tone={pct >= 90 ? "warn" : "accent"} label="Budget spent" />
              <p className="text-[13px] text-muted-foreground tabular">
                {overview.videos_total} videos · {overview.articles_total} articles made. Generation credits only; it completes on its own at the budget or the end date.
              </p>
            </div>
          </Panel>

          <section>
            <SectionTitle>Lanes · what this campaign runs</SectionTitle>
            <div className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card">
              {overview.items.length === 0 && <p className="px-4 py-5 text-[13px] text-muted-foreground">No lanes yet. Add one below.</p>}
              {overview.items.map((item) => {
                const meta = LANE[item.kind] ?? { label: item.kind, icon: null };
                return (
                  <div key={item.id} className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
                    <IconTile tone={item.enabled && c.status === "running" ? "live" : "muted"}>{meta.icon}</IconTile>
                    <div className={`min-w-0 flex-1 ${item.enabled ? "" : "opacity-60"}`}>
                      <div className="truncate text-[14px] font-medium">{meta.label}</div>
                      <div className="truncate text-[13px] text-muted-foreground">
                        {item.kind === "ad" ? adName(item.ref_id) : `${pbName(item.ref_id)} · ${item.cadence_per_week} a week`}
                      </div>
                    </div>
                    <Switch
                      checked={item.enabled}
                      label={`${item.enabled ? "Turn off" : "Turn on"} ${meta.label}`}
                      onChange={(v) => void act(`lane-${item.id}`, () => proxyFetch(`/api/v1/campaigns/${c.id}/items/${item.id}`, "PATCH", { enabled: v }))}
                    />
                    <Button size="icon" variant="ghost" className="size-8" aria-label={`Remove ${meta.label} lane`} title="Remove" onClick={() => setRemoving(item)}>
                      <Trash2 />
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>

          <AddLane campaignId={c.id} playbooks={playbooks} adCampaigns={adCampaigns} onAdded={() => router.refresh()} />
        </div>
      </PageBody>

      <ConfirmModal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this lane?"
        confirmLabel="Remove"
        danger
        busy={busy === "remove"}
        onConfirm={() => removing && void act("remove", () => proxyFetch(`/api/v1/campaigns/${c.id}/items/${removing.id}`, "DELETE"))}
      >
        <p>The campaign stops making {removing ? (LANE[removing.kind]?.label ?? removing.kind).toLowerCase() : "this"} for it. What's already made stays in your library.</p>
      </ConfirmModal>
    </>
  );
}

function AddLane({ campaignId, playbooks, adCampaigns, onAdded }: { campaignId: string; playbooks: PlaybookRef[]; adCampaigns: { id: string; name: string }[]; onAdded: () => void }) {
  const [kind, setKind] = useState<LaneKind>("video");
  const [refId, setRefId] = useState("");
  const [cadence, setCadence] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!refId) {
      setError(kind === "ad" ? "Pick an ad campaign." : "Pick a playbook.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await proxyFetch(`/api/v1/campaigns/${campaignId}/items`, "POST", { kind, ref_id: refId, cadence_per_week: cadence });
      setRefId("");
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel label="Add a lane">
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr_6rem]">
        <Field label="Lane">
          <Select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as LaneKind);
              setRefId("");
            }}
          >
            <option value="video">Videos</option>
            <option value="image">Carousels</option>
            <option value="article">SEO articles</option>
            <option value="ad">Link an ad campaign</option>
          </Select>
        </Field>
        <Field label={kind === "ad" ? "Ad campaign" : "Playbook"}>
          {kind === "ad" ? (
            adCampaigns.length > 0 ? (
              <Select value={refId} onChange={(e) => setRefId(e.target.value)}>
                <option value="">Pick an ad campaign…</option>
                {adCampaigns.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Input value={refId} onChange={(e) => setRefId(e.target.value.trim())} placeholder="Ad campaign id from Paid media" />
            )
          ) : (
            <Select value={refId} onChange={(e) => setRefId(e.target.value)}>
              <option value="">Pick a playbook…</option>
              {playbooks.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Per week">
          <Input type="number" min={1} max={56} value={cadence} disabled={kind === "ad"} onChange={(e) => setCadence(Number(e.target.value))} className="tabular" />
        </Field>
      </div>
      <p className="mt-3 text-[12.5px] text-muted-foreground">Video and carousel lanes make and post to the playbook's channels; article lanes publish SEO pieces; ad lanes link a governed ad campaign so the push reads as one.</p>
      <ErrorText error={error} />
      <div className="mt-4 flex justify-end">
        <Button variant="primary" onClick={() => void add()} loading={busy}>
          Add lane
        </Button>
      </div>
    </Panel>
  );
}
