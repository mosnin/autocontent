/**
 * The /resources/faq questions. Plain strings so the FAQPage JSON-LD in the
 * page and the visible accordion always match exactly.
 */
export type FaqItem = { q: string; a: string };

export const FAQ_ITEMS: FaqItem[] = [
  {
    q: "How do spend caps work?",
    a: "You set a daily budget for each channel, and a max for the whole account. Before any job starts, we check the price. If it fits, it runs and the cost comes out of your prepaid credits.",
  },
  {
    q: "What happens when a cap is hit?",
    a: "The job stops before any money moves. Nothing is billed. The screen shows which budget stopped it. Work starts again the next day, or when you raise the cap.",
  },
  {
    q: "Do I have to approve every post?",
    a: "Only if you want to. New channels start in review mode: drafts wait until you say yes. When you like the work, you can let that channel post on its own. You can switch back to review any time.",
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
    a: "You buy credits through Stripe and they go down as work runs. Credits do not expire. If you have unused credit and want out, write support and we refund what is left from your last purchase.",
  },
  {
    q: "How is my data handled?",
    a: "Your briefs and files stay yours. We do not use them to train models. Every job and every dollar spent is written to a log you can read.",
  },
  {
    q: "Can I bring my own topics?",
    a: "Yes. The agent can suggest topics, and you can add your own any time. Your topics go through the same checks and budget as the suggested ones.",
  },
  {
    q: "How many videos does a pack make?",
    a: "The $5 pack makes about 8 to 12 videos, the $20 pack about 35 to 50, and the $50 pack about 90 to 125. Length and voice change the count. Articles cost less than videos.",
  },
  {
    q: "Can I run several channels at once?",
    a: "Yes. Each channel can have its own voice, style, posting times, and daily budget. The account cap covers all of them together.",
  },
];
