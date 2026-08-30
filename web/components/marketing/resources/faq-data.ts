/**
 * The /resources/faq questions. Plain strings so the FAQPage JSON-LD in the
 * page and the visible accordion always match exactly.
 */
export type FaqItem = { q: string; a: string };

export const FAQ_ITEMS: FaqItem[] = [
  {
    q: "How do spend caps work?",
    a: "Every channel has a daily budget you set, and your account has a global daily cap on top. Before any render starts, the system estimates its cost and checks both caps. If the estimate fits, the job runs and the actual metered cost is drawn from your prepaid balance.",
  },
  {
    q: "What happens when a cap is hit?",
    a: "The system fails closed. A job that would push a channel past its daily cap, or your account past the global cap, is refused before any money moves. Nothing is billed, nothing renders, and the job shows exactly which cap stopped it. Work resumes when the cap resets or you raise it.",
  },
  {
    q: "Do I have to approve every post?",
    a: "Only if you want to. Each channel starts in review-before-post mode: drafts wait in a queue until you approve them. Once you trust the output, you can widen autonomy per channel and let approved formats publish on schedule. You can tighten back to full review at any time.",
  },
  {
    q: "Which platforms can it publish to?",
    a: "Short videos go to TikTok, Instagram Reels, and YouTube Shorts on the times you pick. SEO articles come as ready drafts for your site. Ads draft on Google and Meta.",
  },
  {
    q: "Who owns the content?",
    a: "You do. Every video, script, article, and image made in your account is yours, even after you stop using marketer.sh.",
  },
  {
    q: "How do agents connect?",
    a: "You can use the dashboard, the API, a Python kit, a command line tool, or an MCP server. All of them use a token you create in Settings. Same rules, same budget.",
  },
  {
    q: "What AI models power the work?",
    a: "We pick the model that is best for each step: research, writing, pictures, motion, and voice. That can change over time without you doing anything.",
  },
  {
    q: "How do credits and refunds work?",
    a: "Credit is prepaid through Stripe and drawn down as work renders, at provider cost plus a flat margin. Credits don't expire. If you have unused balance and want out, contact support within 30 days of purchase and we refund the remainder of your last purchase.",
  },
  {
    q: "How is my data handled?",
    a: "Your briefs, channels, and generated assets stay yours and are not used to train models. Access tokens are hashed at rest and shown only once at creation. Every render, publish, and dollar spent is written to an audit log you can read.",
  },
  {
    q: "Can I bring my own topics?",
    a: "Yes. Ideation proposes topics from your channel and past performance, but you can add your own at any time, from the dashboard, the API, the CLI, or an agent. Your topics run through the same production, quality checks, and caps as generated ones.",
  },
  {
    q: "How many videos does a pack make?",
    a: "A default-settings short costs about $3 all-in (metered provider cost plus our flat margin - a touch more with generated music on), so the $5 Starter pack renders 1–2 videos, the $20 Creator pack roughly 5–8, and the $50 Scale pack roughly 12–20. Shorter scenes and standard image quality stretch each pack further, and articles cost far less than videos.",
  },
  {
    q: "Can I run several channels at once?",
    a: "Yes. Each channel gets its own voice, style, posting windows, and daily cap, and the global cap bounds the total across all of them. The Scale pack is sized for people running several channels in parallel.",
  },
];
