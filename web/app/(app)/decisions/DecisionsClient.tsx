"use client";

import * as React from "react";

import { DashHeading, DashPanel } from "@/components/hub/dashboard-kit";
import { Button } from "@/components/square/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/square/ui/card";
import { clientFetch, clientPost } from "@/lib/client-fetcher";
import type { JevStatus, RouteResult } from "@/lib/jev-types";

export function DecisionsClient({ initial }: { initial: JevStatus | null }) {
  const [status, setStatus] = React.useState<JevStatus | null>(initial);
  const [brief, setBrief] = React.useState(
    "Need a 30-second TikTok for our SaaS niche about a contrarian onboarding mistake. Budget is tight this week."
  );
  const [result, setResult] = React.useState<RouteResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    clientFetch<JevStatus>("/api/v1/jev/status")
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        /* keep server snapshot */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runRoute() {
    setBusy(true);
    setError(null);
    try {
      const next = await clientPost<RouteResult>("/api/v1/jev/route", {
        state: { request: brief },
      });
      setResult(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Routing failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-10">
      <DashHeading
        as="h1"
        sub="Jev answers typed questions. Qwen generates. Code composes the policy."
      >
        Decision harness
      </DashHeading>

      <DashPanel delay={0.06} title="Backends">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Jev"
            value={
              status?.typesafe_configured
                ? status.jev_model
                : "not configured"
            }
            ok={Boolean(status?.typesafe_configured)}
          />
          <Stat
            label="Qwen fallback"
            value={
              status?.qwen_fallback_configured
                ? status.fallback_model
                : "not configured"
            }
            ok={Boolean(status?.qwen_fallback_configured)}
          />
          <Stat
            label="Generation"
            value={status?.default_generation_model ?? "—"}
            ok={Boolean(status?.available)}
          />
        </div>
      </DashPanel>

      <DashPanel delay={0.1} title="Route a request">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              Intent + model + company OS
            </CardTitle>
            <CardDescription>
              One Jev pass classifies the work, picks a Qwen tier, and
              routes it onto a product surface. Uncertain answers escalate
              instead of guessing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <textarea
              className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              aria-label="Work brief"
            />
            <Button onClick={runRoute} disabled={busy || !brief.trim()}>
              {busy ? "Judging…" : "Ask Jev"}
            </Button>
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            {result ? (
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <Row k="Kind" v={result.intent.kind} />
                <Row k="Skill" v={result.intent.skill} />
                <Row k="Gate" v={result.intent.gate} />
                <Row
                  k="Urgency"
                  v={result.intent.urgency.toFixed(2)}
                />
                <Row k="Model tier" v={result.model.tier} />
                <Row k="Model" v={result.model.model_id} />
                <Row k="Company surface" v={result.company.surface} />
                <Row k="Task" v={result.company.task} />
                <Row
                  k="Knowledge write"
                  v={result.company.knowledge_write ? "yes" : "no"}
                />
                <Row k="Backend" v={result.intent.backend} />
              </dl>
            ) : null}
            {result?.knowledge && result.knowledge.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {result.knowledge.map((row) => (
                  <li
                    key={row.id || row.span}
                    className="rounded-md bg-muted/40 px-3 py-2"
                  >
                    <span className="text-muted-foreground">[{row.kind}]</span>{" "}
                    {row.span}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </DashPanel>
    </div>
  );
}

function Stat({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {ok ? "ready" : "dark"}
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
