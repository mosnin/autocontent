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
