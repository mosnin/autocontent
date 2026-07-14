/**
 * The /resources/faq questions. Plain strings so the FAQPage JSON-LD in the
 * page and the visible accordion always match exactly.
 */
export type FaqItem = { q: string; a: string };

export const FAQ_ITEMS: FaqItem[] = [
  {
    q: "How do spend caps work?",
    a: "Every niche has a daily budget you set, and your account has a global daily cap on top. Before any render starts, the system estimates its cost and checks both caps. If the estimate fits, the job runs and the actual metered cost is drawn from your prepaid balance.",
  },
  {
    q: "What happens when a cap is hit?",
    a: "The system fails closed. A job that would push a niche past its daily cap, or your account past the global cap, is refused before any money moves. Nothing is billed, nothing renders, and the job shows exactly which cap stopped it. Work resumes when the cap resets or you raise it.",
  },
  {
    q: "Do I have to approve every post?",
    a: "Only if you want to. Each niche starts in review-before-post mode: drafts wait in a queue until you approve them. Once you trust the output, you can widen autonomy per niche and let approved formats publish on schedule. You can tighten back to full review at any time.",
  },
  {
    q: "Which platforms can it publish to?",
    a: "Short-form video publishes to TikTok, Instagram Reels, and YouTube Shorts on the posting windows you set. SEO articles ship as complete drafts with metadata, JSON-LD, and a hero image, ready for your site or CMS.",
  },
  {
    q: "Who owns the content?",
    a: "You do. Every video, script, article, and image generated in your workspace belongs to you, including after you stop using marketer.sh. We claim no license beyond what is needed to render and deliver your content.",
  },
  {
    q: "How do agents connect?",
    a: "Four surfaces cover the same platform: a REST API, a Python SDK (MarketerClient), a CLI (marketer niches, jobs, articles), and an MCP server (marketer-mcp) for agent frameworks. All of them authenticate with personal access tokens you create in Settings.",
  },
  {
    q: "What AI models power the pipelines?",
    a: "We route each pipeline stage to frontier model partners chosen for that job: research, writing, image, animation, and speech each use the model that currently performs best for the stage. Routing improves over time without you changing anything.",
  },
  {
    q: "How do credits and refunds work?",
    a: "Credit is prepaid through Stripe and drawn down as work renders, at provider cost plus a flat margin. Credits don't expire. If you have unused balance and want out, contact support and we refund the remainder of your last purchase.",
  },
  {
    q: "How is my data handled?",
    a: "Your briefs, niches, and generated assets stay yours and are not used to train models. Access tokens are hashed at rest and shown only once at creation. Every render, publish, and dollar spent is written to an audit log you can read.",
  },
  {
    q: "Can I bring my own topics?",
    a: "Yes. Ideation proposes topics from your niche and past performance, but you can enqueue your own at any time, from the dashboard, the API, the CLI, or an agent. Your topics run through the same pipeline, QA, and caps as generated ones.",
  },
  {
    q: "How many videos does a pack make?",
    a: "The $5 Starter pack renders roughly 8 to 12 videos, the $20 Creator pack roughly 35 to 50, and the $50 Studio pack roughly 90 to 125. The range depends on length, style, and voice; articles cost less than videos.",
  },
  {
    q: "Can I run several niches at once?",
    a: "Yes. Each niche gets its own voice, style, posting windows, and daily cap, and the global cap bounds the total across all of them. The Studio pack is sized for people running several niches in parallel.",
  },
];
