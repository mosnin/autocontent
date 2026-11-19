"use client";

import { Clapperboard, FileText, GalleryHorizontal, Megaphone, Pause, Play, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useRef, useState } from "react";
import { AskPill, Button, Card, Column, CommitWave, ConfirmModal, EmptyLine, Facts, Field, IconButton, IconTile, Input, KpiCard, List, ListRow, Meter, Notice, PageHeader, Section, Select, StatusBadge, Switch, useAllowed } from "@/design-system";
import { TOOL_ICON } from "@/components/shell/sidebar";
import type { PlaybookRef } from "@/lib/business";
import { formatDate, formatUsd } from "@/lib/format";
import { proxyFetch } from "@/lib/proxy-fetch";
import type { CampaignItem, CampaignOverview } from "@/lib/types";
import { CampaignStatus } from "./campaigns";

type LaneKind = CampaignItem["kind"];
const LANE: Record<string, { label: string; icon: ReactNode }> = {
  video: { label: "Videos", icon: <Clapperboard /> },
  image: { label: "Carousels", icon: <GalleryHorizontal /> },
  article: { label: "SEO articles", icon: <FileText /> },
  ad: { label: "Ad campaign", icon: <Megaphone /> },
};

/** One distribution campaign (README §5 Detail): start/pause, budget, facts, lanes. */
export function DistributionCampaignView({ overview, playbooks, adCampaigns }: { overview: CampaignOverview; playbooks: PlaybookRef[]; adCampaigns: { id: string; name: string }[] }) {
  const router = useRouter();
  const c = overview.campaign;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CampaignItem | null>(null);
  // A draft starting for the first time is a launch (WAVE.md). Resuming a paused campaign is not.
  const [launched, setLaunched] = useState(false);
  const launchBtn = useRef<HTMLButtonElement>(null);
  const isDraft = c.status === "draft";

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      if (key === "launch") setLaunched(true);
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
  const lanesOn = overview.items.filter((i) => i.enabled).length;
  const ask = `How is the "${c.name}" campaign going, and what should it add next?`;
  const canLaunch = useAllowed("campaign:launch");
  const canPause = useAllowed("campaign:pause");

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Distribution", href: "/distribution" }, { label: c.name }]}
        actions={
          <>
            {canLaunch && c.status !== "running" && c.status !== "completed" && !isDraft && !launched && (
              <Button variant="primary" loading={busy === "start"} disabled={busy !== null} onClick={() => void act("start", () => proxyFetch(`/api/v1/campaigns/${c.id}/start`, "POST"))}>
                <Play /> Start
              </Button>
            )}
            {canPause && c.status === "running" && (
              <Button loading={busy === "pause"} disabled={busy !== null} onClick={() => void act("pause", () => proxyFetch(`/api/v1/campaigns/${c.id}/pause`, "POST"))}>
                <Pause /> Pause
              </Button>
            )}
          </>
        }
      />
      <Column
        width="md"
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {c.name} <CampaignStatus status={c.status} />
          </span>
        }
        description={c.objective || "No objective yet"}
      >
        {error && <Notice error={error} />}

        {(isDraft || launched) && (
          <CommitWave
            moment="launch"
            tone={TOOL_ICON.distribution.tone}
            committed={launched}
            source={launchBtn}
            className="border border-hairline"
            action={
              launched ? undefined : (
                <div className="pointer-events-none flex h-full items-end justify-end p-4">
                  <Button ref={launchBtn} variant="primary" loading={busy === "launch"} disabled={!canLaunch || busy !== null || lanesOn === 0} title={canLaunch ? undefined : "Your role can't launch campaigns."} onClick={() => void act("launch", () => proxyFetch(`/api/v1/campaigns/${c.id}/start`, "POST"))}>
                    <Play /> Launch campaign
                  </Button>
                </div>
              )
            }
            receipt={
              <div className="min-h-[236px] p-5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-[15px] font-medium">{c.name} is running</h2>
                  <StatusBadge tone="positive">Running</StatusBadge>
                </div>
                <p className="mt-2 max-w-[46ch] text-[13px] text-fg-muted">
                  Marketer now works the {lanesOn === 1 ? "lane" : `${lanesOn} lanes`} below until it reaches {formatUsd(budget)} in credits{c.ends_at ? ` or ${formatDate(c.ends_at)}` : ""}. Pause it any time.
                </p>
              </div>
            }
          >
            <div className="min-h-[236px] p-5 pb-16">
              <h2 className="text-[15px] font-medium">Ready to launch</h2>
              <p className="mt-1 max-w-[52ch] text-[13px] text-fg-muted">{lanesOn === 0 ? "Add a lane below first. A campaign needs at least one thing to make." : "Nothing has run yet. Launching starts every lane that is on."}</p>
              <div className="mt-4">
                <Facts
                  items={[
                    { label: "Lanes on", value: `${lanesOn} of ${overview.items.length}` },
                    { label: "Credit budget", value: formatUsd(budget) },
                    { label: "Runs", value: `${formatDate(c.starts_at)} to ${c.ends_at ? formatDate(c.ends_at) : "no end date"}` },
                  ]}
                />
              </div>
            </div>
          </CommitWave>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <KpiCard label="Credits spent" value={formatUsd(spent)} />
            <KpiCard label="Videos made" value={overview.videos_total} />
            <KpiCard label="Articles made" value={overview.articles_total} />
          </div>
          <Card className="px-3.5 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
              <span className="tabular">
                {formatUsd(spent)} <span className="text-fg-muted">of {formatUsd(budget)} credit budget</span>
              </span>
              <span className="text-[12px] text-fg-muted tabular">{Math.round(pct)}%</span>
            </div>
            <div className="mt-2.5">
              <Meter value={pct} tone={pct >= 90 ? "attention" : "accent"} label="Budget spent" />
            </div>
            <p className="mt-2.5 text-[12px] text-fg-muted">Stops at the budget or the end date. Ad spend stays under Paid media's caps.</p>
          </Card>
        </div>

        <Section title="Details">
          <Facts
            items={[
              { label: "Status", value: <CampaignStatus status={c.status} /> },
              { label: "Starts", value: formatDate(c.starts_at) },
              { label: "Ends", value: c.ends_at ? formatDate(c.ends_at) : "No end date" },
              { label: "Credit budget", value: formatUsd(budget) },
              { label: "Lanes on", value: `${lanesOn} of ${overview.items.length}` },
            ]}
          />
        </Section>

        <Section title="Lanes">
          {overview.items.length === 0 ? (
            <EmptyLine>No lanes yet. Add one below.</EmptyLine>
          ) : (
            <List>
              {overview.items.map((item) => {
                const meta = LANE[item.kind] ?? { label: item.kind, icon: null };
                return (
                  <ListRow key={item.id}>
                    <IconTile>{meta.icon}</IconTile>
                    <div className={item.enabled ? "min-w-0 flex-1" : "min-w-0 flex-1 opacity-60"}>
                      <div className="truncate text-[13px]">{meta.label}</div>
                      <div className="truncate text-[12px] text-fg-muted">{item.kind === "ad" ? adName(item.ref_id) : `${pbName(item.ref_id)} · ${item.cadence_per_week} a week`}</div>
                    </div>
                    <Switch
                      checked={item.enabled}
                      disabled={busy !== null}
                      label={`${item.enabled ? "Turn off" : "Turn on"} ${meta.label}`}
                      onChange={(v) => void act(`lane-${item.id}`, () => proxyFetch(`/api/v1/campaigns/${c.id}/items/${item.id}`, "PATCH", { enabled: v }))}
                    />
                    <IconButton label={`Remove ${meta.label} lane`} onClick={() => setRemoving(item)}>
                      <Trash2 />
                    </IconButton>
                  </ListRow>
                );
              })}
            </List>
          )}
        </Section>

        <AddLane campaignId={c.id} playbooks={playbooks} adCampaigns={adCampaigns} onAdded={() => router.refresh()} />

        <AskPill label="Ask about this campaign" href={`/sessions/new?dept=distribution&q=${encodeURIComponent(ask)}`} />
      </Column>

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
    <Section title="Add a lane">
      <Card className="p-4">
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
        <p className="mt-3 text-[12px] text-fg-muted">Ad lanes link a campaign from Paid media; its caps and approvals still apply.</p>
        <div className="mt-4 flex items-center justify-end gap-3">
          <Notice error={error} />
          <Button variant="primary" onClick={() => void add()} loading={busy}>
            Add lane
          </Button>
        </div>
      </Card>
    </Section>
  );
}
