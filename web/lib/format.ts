export function formatUsd(value: string | number | null | undefined, opts: { cents?: boolean } = {}): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  if (!Number.isFinite(n)) return "$0";
  const cents = opts.cents ?? true;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
}

export function formatCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.round((now.getTime() - t) / 1000);
  const future = s < 0;
  const a = Math.abs(s);
  const fmt = (v: number, u: string) => (future ? `in ${v} ${u}${v === 1 ? "" : "s"}` : `${v} ${u}${v === 1 ? "" : "s"} ago`);
  if (a < 45) return future ? "in a moment" : "just now";
  if (a < 3600) return fmt(Math.round(a / 60), "minute");
  if (a < 86400) return fmt(Math.round(a / 3600), "hour");
  if (a < 86400 * 7) return fmt(Math.round(a / 86400), "day");
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
