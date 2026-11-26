import { type CalendarRow, type PlanItem, parseMode, parseOffset, planWindow } from "@/components/app/plan/plan-data";
import { PlanView } from "@/components/app/plan/plan-view";
import type { Campaign, ImagePost, Niche } from "@/lib/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Plan · Marketer" };

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ view?: string; offset?: string }> }) {
  const sp = await searchParams;
  const mode = parseMode(sp.view);
  const offset = parseOffset(sp.offset);
  const win = planWindow(mode, offset, new Date().toISOString().slice(0, 10));
  // Pad a day each side so viewers east or west of UTC still see their edges.
  const start = new Date(`${win.start}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(`${win.start}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + win.days + 1);
  const inWindow = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= start.getTime() && t < end.getTime();
  };

  const [calendar, niches, campaigns, imagePosts] = await Promise.all([
    safe<CalendarRow[]>(`/api/v1/calendar?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`),
    safe<Niche[]>("/api/v1/niches"),
    safe<Campaign[]>("/api/v1/campaigns"),
    safe<ImagePost[]>("/api/v1/image-posts?limit=100"),
  ]);
  const playbook = new Map((niches ?? []).map((n) => [n.id, n.title]));

  const items: PlanItem[] = [
    ...(calendar ?? []).map((r) => ({ kind: r.kind, id: r.id, title: r.title, status: r.status, platform: r.platform, playbook: playbook.get(r.niche_id) ?? null, at: r.at, movable: Boolean(r.movable) })),
    ...(imagePosts ?? [])
      .filter((p) => inWindow(p.created_at))
      .map((p) => ({ kind: "carousel" as const, id: p.id, title: p.topic || (p.kind === "carousel" ? "Carousel" : "Image post"), status: p.status, platform: null, playbook: playbook.get(p.niche_id) ?? null, at: p.created_at })),
    ...(campaigns ?? [])
      .filter((c) => c.status !== "draft" && inWindow(c.starts_at))
      .map((c) => ({ kind: "campaign" as const, id: c.id, title: `${c.name} starts`, status: c.status, platform: null, playbook: null, at: c.starts_at })),
  ];

  return <PlanView items={items} mode={mode} offset={offset} start={win.start} days={win.days} anchor={win.anchor} loadError={calendar === null} />;
}
