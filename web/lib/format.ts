// Shared formatters. Lives in lib/ so both server and client components
// can import without dragging react in.

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatUsd(amount: number | string): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return USD_FORMATTER.format(0);
  return USD_FORMATTER.format(n);
}

/**
 * Like formatUsd, but sub-cent magnitudes render at four decimals instead
 * of a lying "$0.00" — the display for per-call debits and receipts.
 */
export function formatUsdPrecise(amount: number | string): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return USD_FORMATTER.format(0);
  const abs = Math.abs(n);
  if (abs > 0 && abs < 0.01) {
    return `${n < 0 ? "-" : ""}$${abs.toFixed(4)}`;
  }
  return USD_FORMATTER.format(n);
}
