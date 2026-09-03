/**
 * The prepaid credit packs. Single source shared by the marketing pricing
 * teaser and the /pricing page. Video estimates are derived from the real
 * cost model (web/lib/cost-estimator.ts defaults × the billing margin):
 * a default-settings short is ≈ $3 all-in; leaner settings stretch
 * a pack further. Packs differ only in how much credit you load —
 * never in features.
 */
export type Pack = {
  label: string;
  amount: number;
  blurb: string;
  points: string[];
  featured?: boolean;
};

export const PACKS: Pack[] = [
  {
    label: "Starter",
    amount: 5,
    blurb: "Try the machine",
    points: ["≈ 1–2 videos", "Every feature included", "No subscription"],
  },
  {
    label: "Creator",
    amount: 20,
    blurb: "A daily channel",
    points: [
      "≈ 5–8 videos",
      "About a week of daily shorts",
      "Top up any time",
    ],
    featured: true,
  },
  {
    label: "Scale",
    amount: 50,
    blurb: "Several channels at once",
    points: ["≈ 12–20 videos", "Sized for several channels", "Same features as every pack"],
  },
];
