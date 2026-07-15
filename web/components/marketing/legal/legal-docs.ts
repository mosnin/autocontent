// One source of truth for the legal document set — consumed by the legal
// sidebar nav, the footer, and the sitemap. Text-first; no icons anywhere in
// the legal surface.

export interface LegalDoc {
  slug: string;
  title: string;
  /** Short description for the legal index. */
  blurb: string;
}

export const LEGAL_DOCS: LegalDoc[] = [
  {
    slug: "terms",
    title: "Terms of Service",
    blurb: "The agreement that governs your use of marketer.sh.",
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    blurb: "What we collect, why, and the rights you have over your data.",
  },
  {
    slug: "acceptable-use",
    title: "Acceptable Use Policy",
    blurb: "What you may and may not do with the platform and its agents.",
  },
  {
    slug: "cookies",
    title: "Cookie Policy",
    blurb: "The cookies and local storage we use, and how to control them.",
  },
  {
    slug: "subprocessors",
    title: "Subprocessors",
    blurb: "The third parties that process data on our behalf.",
  },
  {
    slug: "dpa",
    title: "Data Processing Addendum",
    blurb: "Our processor commitments for business customers (GDPR Art. 28).",
  },
  {
    slug: "refund",
    title: "Refund Policy",
    blurb: "How prepaid credits, billing, and refunds work.",
  },
];

/** Last substantive revision — one date across the set keeps them coherent. */
export const LEGAL_EFFECTIVE = "July 15, 2026";
