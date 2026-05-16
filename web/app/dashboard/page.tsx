import { api } from "../../lib/api";
import { enqueueJobAction } from "../../lib/actions";
import type { Niche, TodaySpend } from "../../lib/types";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [niches, spend] = await Promise.all([
    api<Niche[]>("/api/v1/niches"),
    api<TodaySpend>("/api/v1/spend/today"),
  ]);

  return (
    <section>
      <header style={headerStyle}>
        <h1>Niches</h1>
        <a href="/onboarding" style={addLink}>
          + Add niche
        </a>
      </header>

      <div style={{ margin: "12px 0", color: "#666" }}>
        Today&apos;s total spend: <strong>${spend.total_usd}</strong>
      </div>

      {niches.length === 0 ? (
        <p>
          No niches yet. <a href="/onboarding">Create your first one</a>.
        </p>
      ) : (
        <ul style={{ display: "flex", flexDirection: "column", gap: 12, padding: 0 }}>
          {niches.map((n) => (
            <NicheCard key={n.id} niche={n} spentToday={spend.by_niche[n.id] ?? "0"} />
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
          ${spent.toFixed(2)} / ${cap.toFixed(2)} today
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
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {niche.platforms.map((platform) => (
          <form key={platform} action={enqueueJobAction}>
            <input type="hidden" name="niche_id" value={niche.id} />
            <input type="hidden" name="platform" value={platform} />
            <button type="submit" style={enqueueButtonStyle}>
              Run now ({platform})
            </button>
          </form>
        ))}
      </div>
    </li>
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
