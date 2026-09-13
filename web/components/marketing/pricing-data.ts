/** Existing USD credit catalog. Keep amounts aligned with billing/packs.py. */
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
    blurb: "Explore with a small balance",
    points: [
      "$5 in generation credit",
      "No recurring payment",
      "Review before publishing",
    ],
  },
  {
    label: "Creator",
    amount: 20,
    blurb: "Make room to try a few ideas",
    points: [
      "$20 in generation credit",
      "Same feature access",
      "Top up when you need to",
    ],
    featured: true,
  },
  {
    label: "Scale",
    amount: 50,
    blurb: "Keep more credit available",
    points: [
      "$50 in generation credit",
      "Same feature access",
      "Track usage across channels",
    ],
  },
];

/** Commercial proposal only. No Stripe products or entitlements use this array. */
export const PROPOSED_PLANS = [
  {
    name: "Launch",
    price: 49,
    credit: 20,
    channels: 1,
    audience: "Build a publishing routine for one brand.",
    features: [
      "Video and article creation",
      "All supported creative formats",
      "Review queue and manual scheduling",
      "Content library and basic analytics",
    ],
  },
  {
    name: "Grow",
    price: 149,
    credit: 75,
    channels: 5,
    audience: "Keep several content streams moving.",
    features: [
      "Everything in Launch",
      "Recurring production schedules",
      "Search audits and campaign planning",
      "Google and Meta ad draft workflows",
    ],
  },
  {
    name: "Scale",
    price: 399,
    credit: 200,
    channels: 20,
    audience: "Operate a larger content program.",
    features: [
      "Everything in Grow",
      "API, SDK, CLI, and MCP workflows",
      "Webhook-driven production handoffs",
      "Channel-level budgets and reporting",
    ],
  },
] as const;
