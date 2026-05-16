import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { ArrowRight, ShieldCheck, Sparkles, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// `/` uses Clerk's <SignedIn>/<SignedOut> which can't be statically
// prerendered without a real Clerk key — opt out so the build can
// still ship in CI.
export const dynamic = "force-dynamic";

const REPO_URL = "https://github.com/mosnin/autocontent";

export default function Home() {
  return (
    <main className="relative isolate flex min-h-screen flex-col">
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 0%, hsl(var(--primary) / 0.10), transparent 60%)",
        }}
      />

      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Sparkles className="h-5 w-5 text-primary" />
          autocontent
        </Link>
        <nav className="flex items-center gap-2">
          <SignedIn>
            <Button asChild variant="ghost">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          </SignedIn>
          <SignedOut>
            <Button asChild variant="ghost">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </SignedOut>
        </nav>
      </header>

      <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border bg-card/50 px-3 py-1 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          Autonomous short-form content
        </div>
        <h1 className="text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
          Niche-driven video pipelines that ship themselves.
        </h1>
        <p className="mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
          Describe a channel once. autocontent ideates, writes, animates, voices,
          renders, and posts daily — under a spend cap you control.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <SignedIn>
            <Button asChild size="lg">
              <Link href="/dashboard">
                Get started
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </SignedIn>
          <SignedOut>
            <Button asChild size="lg">
              <Link href="/sign-in">
                Get started
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </SignedOut>
          <Button asChild size="lg" variant="outline">
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              Read the docs
            </a>
          </Button>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-4 px-6 pb-16 sm:grid-cols-2 lg:grid-cols-3">
        <FeatureCard
          icon={Sparkles}
          title="Autonomous niches"
          body="Each niche is a self-contained pipeline: ideation, scripting, image and motion, TTS, captions, scheduling. No timeline you have to babysit."
        />
        <FeatureCard
          icon={ShieldCheck}
          title="Spend-capped runs"
          body="Per-niche daily caps with real-time tracking. We refuse to enqueue jobs that would blow the budget, so a runaway never costs you dinner."
        />
        <FeatureCard
          icon={Terminal}
          title="MCP + CLI for agents"
          body="Personal access tokens, an MCP server, and a typed SDK let any agent or shell script drive the same pipeline the dashboard does."
        />
      </section>
    </main>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <Card className="bg-card/50">
      <CardHeader>
        <Icon className="h-5 w-5 text-primary" />
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{body}</CardContent>
    </Card>
  );
}
