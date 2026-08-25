import type { Metadata } from "next";
import Link from "next/link";

const DESCRIPTION =
  "marketer.sh is an agentic marketing platform. Your AI agent creates videos, SEO articles, and ads for you, on its own.";

export const metadata: Metadata = {
  title: "About · marketer.sh",
  description: DESCRIPTION,
  openGraph: {
    title: "About · marketer.sh",
    description: DESCRIPTION,
    type: "website",
  },
  alternates: { canonical: "https://marketer.sh/about" },
};

const SERVICES = [
  {
    name: "Content",
    href: "/features/content",
    copy: "Short videos for TikTok, Reels, and Shorts. Tell it what you sell. It makes the clips.",
  },
  {
    name: "SEO",
    href: "/features/seo",
    copy: "Articles for your site, written from what people already search. Plus a check-up for pages you already published.",
  },
  {
    name: "Ads",
    href: "/features/ads",
    copy: "Paid ads on Google and Meta. You pick a budget. The agent drafts the work.",
  },
];

const STEPS = [
  {
    title: "Say what you sell",
    copy: "One sentence is enough. Who it is for, and what you want them to do.",
  },
  {
    title: "Set a budget",
    copy: "Buy credits once. Set a daily cap. If a job would go over, it stops. You are not billed extra.",
  },
  {
    title: "Review, then let it run",
    copy: "Look at the first drafts. When you like them, let the agent keep going on its own.",
  },
];

export default function AboutPage() {
  return (
    <main>
      <section className="mx-auto grid max-w-[1440px] gap-12 px-5 pt-28 pb-20 sm:px-8 sm:pt-36 lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:gap-20 lg:px-10">
        <div>
          <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
            About
          </p>
          <h1 className="text-foreground mt-5 max-w-xl text-[clamp(40px,6vw,76px)] leading-[1.02] font-medium tracking-tight">
            Marketing that just gets made.
          </h1>
        </div>
        <p className="text-muted-foreground max-w-md text-lg leading-relaxed">
          marketer.sh is an agentic marketing platform. That means your AI
          agent can create marketing for you on its own: videos, articles, and
          ads. You stay in charge of the budget and what goes live.
        </p>
      </section>

      <section className="border-border border-y">
        <div className="mx-auto grid max-w-[1440px] gap-10 px-5 py-16 sm:px-8 lg:grid-cols-3 lg:px-10">
          <div>
            <p className="text-foreground text-2xl font-medium tracking-tight">
              We are not a tool pile.
            </p>
            <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
              Most marketing software asks you to learn five products and still
              do the work yourself. We built one place where an agent does the
              work, and you decide if it ships.
            </p>
          </div>
          <div>
            <p className="text-foreground text-2xl font-medium tracking-tight">
              Plain jobs. Real output.
            </p>
            <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
              Content, SEO, and ads. That is the business. Not a dozen extra
              products with fancy names. If it is not one of those three, it is
              just a setting inside the app.
            </p>
          </div>
          <div>
            <p className="text-foreground text-2xl font-medium tracking-tight">
              Pay for what you use.
            </p>
            <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
              No monthly plan. Buy credits from five dollars. They do not
              expire. Raise or lower your daily cap whenever you want.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-5 py-24 sm:px-8 sm:py-32 lg:px-10">
        <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
          What we sell
        </p>
        <h2 className="text-foreground mt-4 max-w-xl text-3xl font-medium tracking-tight sm:text-4xl">
          Three services. Same login.
        </h2>
        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {SERVICES.map((service, index) => (
            <Link
              key={service.href}
              href={service.href}
              className="border-border hover:bg-muted focus-ring rounded-3xl border p-8 transition-colors"
            >
              <p className="text-muted-foreground font-mono text-xs">
                0{index + 1}
              </p>
              <h3 className="text-foreground mt-6 text-2xl font-medium tracking-tight">
                {service.name}
              </h3>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                {service.copy}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section
        className="mx-auto max-w-[1440px] px-5 pb-24 sm:px-8 sm:pb-32 lg:px-10"
        style={{
          color: "var(--surface-foreground)",
        }}
      >
        <div
          className="rounded-[40px] px-6 py-16 sm:px-12 sm:py-20"
          style={{ backgroundColor: "var(--surface)" }}
        >
          <p className="text-[11px] font-medium tracking-wider uppercase opacity-60">
            How it works
          </p>
          <h2 className="mt-4 max-w-lg text-3xl font-medium tracking-tight sm:text-4xl">
            You do not need to become a marketer.
          </h2>
          <ol className="mt-12 grid gap-8 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <p className="font-mono text-xs opacity-55">0{index + 1}</p>
                <h3 className="mt-4 text-xl font-medium tracking-tight">
                  {step.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed opacity-70">
                  {step.copy}
                </p>
              </li>
            ))}
          </ol>
          <div className="mt-12 flex flex-wrap gap-3">
            <Link
              href="/sign-up"
              className="focus-ring inline-flex h-12 items-center rounded-full px-7 text-sm font-medium"
              style={{
                backgroundColor: "var(--surface-foreground)",
                color: "var(--surface)",
              }}
            >
              Start creating
            </Link>
            <Link
              href="/contact"
              className="focus-ring inline-flex h-12 items-center rounded-full border border-current/25 px-7 text-sm font-medium"
            >
              Contact us
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
