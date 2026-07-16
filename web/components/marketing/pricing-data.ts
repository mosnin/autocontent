/**
 * The prepaid credit packs. Single source shared by the marketing pricing
 * teaser and the /pricing page (mirrors the packs in
 * components/marketing/pricing.tsx, the legacy landing section).
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
    points: ["≈ 8-12 videos", "Every feature included", "No subscription"],
  },
  {
    label: "Creator",
    amount: 20,
    blurb: "A daily channel",
    points: [
      "≈ 35-50 videos",
      "Closed-loop optimization",
      "Review-before-post",
    ],
    featured: true,
  },
  {
    label: "Studio",
    amount: 50,
    blurb: "Several niches at once",
    points: ["≈ 90-125 videos", "Per-niche spend caps", "API + MCP access"],
  },
];
