"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import useSWR from "swr";

import {
  archiveNicheAction,
  enqueueJobAction,
  EMPTY_STATE,
  type ActionState,
} from "../../lib/actions";
import { clientFetch } from "../../lib/client-fetcher";
import { formatUsd } from "../../lib/format";
import type { Niche, TodaySpend } from "../../lib/types";

interface InitialData {
  niches: Niche[];
  spend: TodaySpend;
  ayrshareConnected: boolean | null;
}

const POLL_MS = 5000;

export function DashboardClient({ initial }: { initial: InitialData }) {
  const { data: niches, error: nichesError } = useSWR<Niche[]>(
    "/api/v1/niches",
    clientFetch,
    { refreshInterval: POLL_MS, fallbackData: initial.niches },
  );
  const { data: spend, error: spendError } = useSWR<TodaySpend>(
    "/api/v1/spend/today",
    clientFetch,
    { refreshInterval: POLL_MS, fallbackData: initial.spend },
  );

  // Ayrshare status: poll only if the route exists; if it 404s, stop.
  const { data: ayrshare } = useSWR<{ connected: boolean }>(
    initial.ayrshareConnected === null ? null : "/api/v1/connect/ayrshare/status",
    clientFetch,
    {
      refreshInterval: POLL_MS,
      fallbackData:
        initial.ayrshareConnected === null
          ? undefined
          : { connected: initial.ayrshareConnected },
      shouldRetryOnError: false,
    },
  );

  const nichesList = niches ?? [];
  const spendData = spend ?? { by_niche: {}, total_usd: "0" };

  const showNoNichesBanner = nichesList.length === 0;
  const showAyrshareBanner =
    ayrshare !== undefined && ayrshare.connected === false;

  return (
    <section>
      <header style={headerStyle}>
        <h1>Niches</h1>
        <a href="/onboarding" style={addLink}>
          + Add niche
        </a>
      </header>

      {(showNoNichesBanner || showAyrshareBanner) && (
        <div style={bannerStyle}>
          {showNoNichesBanner && (
            <div>
              No niches yet. <a href="/onboarding">Create your first one</a>.
            </div>
          )}
          {showAyrshareBanner && (
            <div>
              Your Ayrshare profile isn&apos;t connected — posts won&apos;t actually
              ship until you finish that setup.
            </div>
          )}
        </div>
      )}

      {(nichesError || spendError) && (
        <div style={errorBannerStyle}>
          Live updates paused: {(nichesError ?? spendError)?.message ?? "fetch failed"}
        </div>
      )}

      <div style={{ margin: "12px 0", color: "#666" }}>
        Today&apos;s total spend: <strong>{formatUsd(spendData.total_usd)}</strong>
      </div>

      {nichesList.length > 0 && (
        <ul style={{ display: "flex", flexDirection: "column", gap: 12, padding: 0 }}>
          {nichesList.map((n) => (
            <NicheCard
              key={n.id}
              niche={n}
              spentToday={spendData.by_niche[n.id] ?? "0"}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function NicheCard({ niche, spentToday }: { niche: Niche; spentToday: string }) {
  const cap = Number(niche.daily_spend_cap_usd);
  const spent = Number(spentToday);
  const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0;
  return (
    <li style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>{niche.title}</h3>
        <span style={{ color: "#666", fontSize: 13 }}>
          {formatUsd(spent)} / {formatUsd(cap)} today
        </span>
      </div>
      <p style={{ color: "#444", margin: "4px 0" }}>{niche.description}</p>
      <div style={{ display: "flex", gap: 12, color: "#666", fontSize: 13, flexWrap: "wrap" }}>
        <span>image: {niche.image_quality}</span>
        <span>video: {niche.video_resolution}</span>
        <span>scenes: {niche.scene_count}</span>
        <span>platforms: {niche.platforms.join(", ")}</span>
      </div>
      <div style={progressBarStyle}>
        <div style={{ ...progressFillStyle, width: `${pct}%` }} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
        {niche.platforms.map((platform) => (
          <EnqueueForm key={platform} nicheId={niche.id} platform={platform} />
        ))}
        <ArchiveForm nicheId={niche.id} title={niche.title} />
      </div>
    </li>
  );
}

function EnqueueForm({ nicheId, platform }: { nicheId: string; platform: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    enqueueJobAction,
    EMPTY_STATE,
  );
  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <input type="hidden" name="niche_id" value={nicheId} />
      <input type="hidden" name="platform" value={platform} />
      <EnqueueSubmit platform={platform} />
      {state.error && <span style={inlineErrorStyle}>{state.error}</span>}
    </form>
  );
}

function EnqueueSubmit({ platform }: { platform: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} style={enqueueButtonStyle}>
      {pending ? "Working…" : `Run now (${platform})`}
    </button>
  );
}

function ArchiveForm({ nicheId, title }: { nicheId: string; title: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    archiveNicheAction,
    EMPTY_STATE,
  );
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`Archive niche "${title}"? This will stop new posts.`)) {
          e.preventDefault();
        }
      }}
      style={{ display: "flex", flexDirection: "column", gap: 4 }}
    >
      <input type="hidden" name="niche_id" value={nicheId} />
      <ArchiveSubmit />
      {state.error && <span style={inlineErrorStyle}>{state.error}</span>}
    </form>
  );
}

function ArchiveSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} style={archiveButtonStyle}>
      {pending ? "Archiving…" : "Archive"}
    </button>
  );
}

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};
const addLink: React.CSSProperties = {
  background: "#111",
  color: "white",
  padding: "8px 14px",
  borderRadius: 6,
  textDecoration: "none",
  fontWeight: 600,
};
const cardStyle: React.CSSProperties = {
  listStyle: "none",
  border: "1px solid #e5e5e5",
  borderRadius: 8,
  padding: 14,
  background: "white",
};
const progressBarStyle: React.CSSProperties = {
  width: "100%",
  height: 6,
  background: "#f0f0f0",
  borderRadius: 3,
  marginTop: 8,
  overflow: "hidden",
};
const progressFillStyle: React.CSSProperties = {
  height: "100%",
  background: "#0a7",
  transition: "width 200ms",
};
const enqueueButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "#0a7",
  color: "white",
  border: 0,
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};
const archiveButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "white",
  color: "#933",
  border: "1px solid #c33",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};
const bannerStyle: React.CSSProperties = {
  background: "#fff8e1",
  border: "1px solid #f0c36d",
  color: "#7a5800",
  padding: 12,
  borderRadius: 8,
  margin: "12px 0",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};
const errorBannerStyle: React.CSSProperties = {
  background: "#fdecec",
  border: "1px solid #f4b6b6",
  color: "#933",
  padding: 8,
  borderRadius: 6,
  margin: "8px 0",
  fontSize: 13,
};
const inlineErrorStyle: React.CSSProperties = {
  color: "#933",
  fontSize: 12,
  maxWidth: 220,
};
